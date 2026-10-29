#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\OpenCode\PowerBI-Accelerator",
    [string]$ProjectPath = (Get-Location).Path,
    [switch]$PrepareCopy,
    [string]$CopyDestination,
    [switch]$PrepareDemo,
    [string]$DemoDestination,
    [switch]$TestBridge,
    [int]$BridgeTimeoutSeconds = 5,
    [int]$BridgeAttempts = 2,
    [string]$BridgeCommand
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Resolve-SafeRelativePath([string]$Root, [string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) { throw "Caminho gerenciado invalido: $RelativePath" }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Caminho gerenciado escapa da instalacao: $RelativePath" }
    $current = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    foreach ($segment in $RelativePath -split '[\\/]') {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Caminho gerenciado contem junction ou link simbolico: $RelativePath"
        }
    }
    return $full
}

function Get-RelativePath([string]$Root, [string]$Path) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    return [IO.Path]::GetFullPath($Path).Substring($prefix.Length)
}

function Assert-PowerShellSyntax([string]$Path) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "PowerShell invalido em '$Path': $($errors[0].Message)" }
    Write-Host "arquivo validado: $Path"
}

function Read-JsonDictionary([string]$Path) {
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    return $serializer.DeserializeObject((Get-Content -LiteralPath $Path -Raw))
}

function Assert-MarkdownDependencies([string]$SkillsRoot) {
    $installPrefix = $InstallRoot.TrimEnd('\') + '\'
    foreach ($markdown in @(Get-ChildItem -LiteralPath $SkillsRoot -Filter "*.md" -File -Recurse)) {
        $content = Get-Content -LiteralPath $markdown.FullName -Raw
        foreach ($match in [regex]::Matches($content, '(?<!!)\[[^\]]*\]\((?<target>[^)]+)\)')) {
            $target = $match.Groups["target"].Value.Trim()
            if ($target.StartsWith("<") -and $target.EndsWith(">")) { $target = $target.Substring(1, $target.Length - 2) }
            if ($target -match '^(?i)(https?:|mailto:|data:|#)') { continue }
            if ($target -match '^(.+?\.md)(?:\s+["''].*)?$') { $target = $Matches[1] } else { continue }
            $target = [Uri]::UnescapeDataString(($target -split '#', 2)[0]).Replace('/', '\')
            $resolved = [IO.Path]::GetFullPath((Join-Path $markdown.DirectoryName $target))
            if (-not $resolved.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                throw "Dependencia Markdown invalida '$target' em '$($markdown.FullName)'."
            }
        }
    }
    Write-Host "arquivo validado: dependencias Markdown locais"
}

function Get-FileSnapshot([string]$Root) {
    $result = @{}
    foreach ($file in @(Get-RegularFiles $Root)) {
        $relative = Get-RelativePath $Root $file.FullName
        $result[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return $result
}

function Get-RegularFiles([string]$Root) {
    $pending = New-Object 'Collections.Generic.Queue[string]'
    $pending.Enqueue([IO.Path]::GetFullPath($Root))
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) }
            else { Write-Output $item }
        }
    }
}

function Copy-RegularTree([string]$Source, [string]$Destination) {
    Ensure-Directory $Destination
    foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Write-Host "junction/link ignorado na copia: $($item.FullName)" -ForegroundColor Yellow
            continue
        }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-RegularTree $item.FullName $target }
        else { Copy-Item -LiteralPath $item.FullName -Destination $target }
    }
}

function Assert-NoReparseInExistingPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $current = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    $remaining = $full.Substring([IO.Path]::GetPathRoot($full).Length)
    foreach ($segment in $remaining -split '[\\/]') {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $current = Join-Path ($current + '\') $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "O destino da copia contem junction ou link simbolico: $current"
        }
    }
}

function Test-ContainsPrivatePath([string]$Content) {
    return $Content -match '(?i)(?:[A-Z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/)|file:(?:/{2,4}|\\{2,4})[A-Z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/))'
}

function Assert-PortableDemoTree([string]$Root) {
    $forbiddenDirectories = @('.pbi', '.opencode', 'node_modules')
    $textExtensions = @('.json', '.md', '.pbip', '.pbir', '.pbism', '.ps1', '.tmdl')
    $pending = New-Object 'Collections.Generic.Queue[string]'
    $pending.Enqueue([IO.Path]::GetFullPath($Root))
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "A demo distribuida contem junction ou link simbolico: $($item.FullName)"
            }
            if ($item.PSIsContainer) {
                if ($forbiddenDirectories -contains $item.Name) {
                    throw "A demo distribuida contem diretorio local proibido: $($item.FullName)"
                }
                $pending.Enqueue($item.FullName)
                continue
            }
            if ($textExtensions -contains $item.Extension -or $item.Name -in @('.gitignore', '.platform')) {
                $content = Get-Content -LiteralPath $item.FullName -Raw
                if (Test-ContainsPrivatePath $content) {
                    throw "A demo distribuida contem caminho privado: $($item.FullName)"
                }
            }
        }
    }
}

function Get-DemoSourceFiles([string]$Root) {
    $inventoryPath = Join-Path $InstallRoot "managed-inventory.json"
    if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) {
        throw "Inventario ausente para preparar a demo. Instale o acelerador e abra o OpenCode pelo launcher gerado: $inventoryPath"
    }
    try { $managedInventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json }
    catch { throw "Inventario JSON invalido ao preparar demo: $($_.Exception.Message)" }
    $managedPrefix = "examples\VendasDemo\"
    $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $result = @()
    foreach ($managedRelative in @($managedInventory.managedFiles | ForEach-Object { [string]$_ })) {
        if (-not $managedRelative.StartsWith($managedPrefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $demoRelative = $managedRelative.Substring($managedPrefix.Length)
        $segments = @($demoRelative -split '[\\/]')
        if ([string]::IsNullOrWhiteSpace($demoRelative) -or [IO.Path]::IsPathRooted($demoRelative) -or $segments -contains '..' -or $segments -contains '.') {
            throw "Caminho gerenciado invalido na demo: $managedRelative"
        }
        $source = Resolve-SafeRelativePath $InstallRoot $managedRelative
        if (-not $source.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Arquivo gerenciado escapa da raiz da demo: $managedRelative"
        }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Arquivo gerenciado da demo ausente: $managedRelative" }
        $result += [pscustomobject]@{ FullName = $source; RelativePath = $demoRelative }
    }
    if ($result.Count -eq 0) { throw "Inventario nao contem arquivos gerenciados da VendasDemo." }
    return $result
}

function Assert-PortableDemoFiles([object[]]$Files) {
    foreach ($file in $Files) {
        $segments = @([string]$file.RelativePath -split '[\\/]')
        if (@($segments | Where-Object { $_ -in @('.pbi', '.opencode', 'node_modules') }).Count -gt 0) {
            throw "Arquivo local proibido no inventario da demo: $($file.RelativePath)"
        }
        $item = Get-Item -LiteralPath $file.FullName -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Arquivo gerenciado da demo e junction ou link: $($file.FullName)"
        }
        if ($item.Extension -in @('.json', '.md', '.pbip', '.pbir', '.pbism', '.ps1', '.tmdl') -or $item.Name -in @('.gitignore', '.platform')) {
            $content = Get-Content -LiteralPath $item.FullName -Raw
            if (Test-ContainsPrivatePath $content) {
                throw "A demo distribuida contem caminho privado: $($item.FullName)"
            }
        }
    }
}

function Copy-DemoFiles([object[]]$Files, [string]$Destination) {
    Ensure-Directory $Destination
    $destinationPrefix = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    foreach ($file in $Files) {
        $target = [IO.Path]::GetFullPath((Join-Path $Destination ([string]$file.RelativePath)))
        if (-not $target.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Arquivo da demo escapa do destino: $($file.RelativePath)"
        }
        Ensure-Directory (Split-Path -Parent $target)
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

function Invoke-ReportValidation([string]$CommandPath, [string]$PbipPath, [int]$TimeoutSeconds) {
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $commandExtension = [IO.Path]::GetExtension($CommandPath)
    if ($commandExtension -in @('.cmd', '.bat')) {
        $startInfo.FileName = $env:ComSpec
        $escapedCommand = $CommandPath.Replace('"', '""')
        $escapedPbip = $PbipPath.Replace('"', '""')
        $startInfo.Arguments = "/d /s /c `"`"$escapedCommand`" validate `"$escapedPbip`" --no-schema`""
    }
    elseif ($commandExtension -ieq '.ps1') {
        $startInfo.FileName = (Get-Command powershell.exe -ErrorAction Stop).Source
        $startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$CommandPath`" validate `"$PbipPath`" --no-schema"
    }
    else {
        $startInfo.FileName = $CommandPath
        $startInfo.Arguments = "validate `"$PbipPath`" --no-schema"
    }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Nao foi possivel iniciar a validacao PBIR." }
    $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
    $standardErrorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        & taskkill.exe /PID $process.Id /T /F *> $null
        if (-not $process.HasExited) { $process.Kill() }
        $process.WaitForExit()
        throw "Validacao PBIR excedeu o timeout de $TimeoutSeconds segundo(s)."
    }
    $output = ($standardOutputTask.Result + "`n" + $standardErrorTask.Result).Trim()
    if ($process.ExitCode -ne 0) { throw "Validacao PBIR falhou com codigo $($process.ExitCode): $output" }
    return $output
}

function Invoke-BridgeStatus([string]$CommandPath, [int]$TimeoutSeconds) {
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    if ([IO.Path]::GetExtension($CommandPath) -ieq ".cmd" -or [IO.Path]::GetExtension($CommandPath) -ieq ".bat") {
        $startInfo.FileName = $env:ComSpec
        $escaped = $CommandPath.Replace('"', '""')
        $startInfo.Arguments = "/d /s /c `"`"$escaped`" status`""
    }
    else {
        $startInfo.FileName = $CommandPath
        $startInfo.Arguments = "status"
    }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Nao foi possivel iniciar o diagnostico da bridge." }
    $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
    $standardErrorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        & taskkill.exe /PID $process.Id /T /F *> $null
        if (-not $process.HasExited) { $process.Kill() }
        $process.WaitForExit()
        return [ordered]@{ connected = $false; detail = "timeout apos $TimeoutSeconds segundo(s)" }
    }
    $output = (($standardOutputTask.Result + " " + $standardErrorTask.Result).Trim())
    $connected = $false
    if ($process.ExitCode -eq 0) {
        try {
            $statusResult = $output | ConvertFrom-Json
            $connected = ($statusResult.status -eq "ready") -or
                (@($statusResult.instances | Where-Object { $_.bridgeStatus -eq "connected" }).Count -gt 0)
        }
        catch {
            $connected = ($output -match '(?i)\b(ready|connected)\b') -and ($output -notmatch '(?i)(not_connected|disconnected)')
        }
    }
    return [ordered]@{ connected = $connected; detail = "codigo $($process.ExitCode): $output" }
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw "Projeto nao encontrado: $ProjectPath" }
if ($PrepareCopy -and $PrepareDemo) { throw "Use somente um modo de copia por execucao." }
if ($PrepareDemo) {
    if (-not [string]::IsNullOrWhiteSpace($CopyDestination)) { throw "Use -DemoDestination com -PrepareDemo." }
    $demoSource = Join-Path $InstallRoot "examples\VendasDemo"
    if (-not (Test-Path -LiteralPath $demoSource -PathType Container)) { throw "Demo VendasDemo nao encontrada: $demoSource" }
    if ([string]::IsNullOrWhiteSpace($DemoDestination)) { $DemoDestination = Join-Path $ProjectPath "VendasDemo-Demo" }
    $DemoDestination = [IO.Path]::GetFullPath($DemoDestination)
    if (Test-Path -LiteralPath $DemoDestination) { throw "O destino da demo deve ser novo: $DemoDestination" }
    $destinationParent = Split-Path -Parent $DemoDestination
    Assert-NoReparseInExistingPath $destinationParent
    Ensure-Directory $destinationParent
    Assert-NoReparseInExistingPath $destinationParent
    $sourcePrefix = [IO.Path]::GetFullPath($demoSource).TrimEnd('\') + '\'
    if (($DemoDestination.TrimEnd('\') + '\').StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "O destino da demo nao pode ficar dentro do exemplo original."
    }

    Write-Host "[ETAPA 1/4] Auditando a demo distribuida"
    $demoFiles = @(Get-DemoSourceFiles $demoSource)
    Assert-PortableDemoFiles $demoFiles
    $sourceSnapshot = @{}
    foreach ($file in $demoFiles) { $sourceSnapshot[[string]$file.RelativePath] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
    $stagingDestination = Join-Path $destinationParent (".VendasDemo-stage-" + [Guid]::NewGuid().ToString("N"))
    $stagingCreated = $false
    try {
        Write-Host "[ETAPA 2/4] Criando copia independente em: $DemoDestination"
        New-Item -ItemType Directory -Path $stagingDestination -ErrorAction Stop | Out-Null
        $stagingCreated = $true
        Assert-NoReparseInExistingPath $stagingDestination
        Copy-DemoFiles $demoFiles $stagingDestination
        $copySnapshot = Get-FileSnapshot $stagingDestination
        if ($sourceSnapshot.Count -ne $copySnapshot.Count) { throw "A copia da demo possui quantidade inesperada de arquivos." }
        foreach ($relative in $sourceSnapshot.Keys) {
            if (-not $copySnapshot.ContainsKey($relative) -or $copySnapshot[$relative] -ne $sourceSnapshot[$relative]) {
                throw "A copia da demo diverge da origem: $relative"
            }
        }
        Assert-PortableDemoTree $stagingDestination

        Write-Host "[ETAPA 3/4] Validando estrutura e referencias relativas"
        $pbipPath = Join-Path $stagingDestination "VendasDemo.pbip"
        $pbip = Get-Content -LiteralPath $pbipPath -Raw | ConvertFrom-Json
        $reportRelative = [string]$pbip.artifacts[0].report.path
        if ([string]::IsNullOrWhiteSpace($reportRelative) -or [IO.Path]::IsPathRooted($reportRelative)) { throw "Referencia de relatorio invalida no PBIP." }
        $reportPath = [IO.Path]::GetFullPath((Join-Path $stagingDestination $reportRelative))
        $demoPrefix = $stagingDestination.TrimEnd('\') + '\'
        if (-not ($reportPath + '\').StartsWith($demoPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $reportPath -PathType Container)) {
            throw "O PBIP referencia um relatorio fora da demo."
        }
        $pbirPath = Join-Path $reportPath "definition.pbir"
        $pbir = Get-Content -LiteralPath $pbirPath -Raw | ConvertFrom-Json
        $modelRelative = [string]$pbir.datasetReference.byPath.path
        if ([string]::IsNullOrWhiteSpace($modelRelative) -or [IO.Path]::IsPathRooted($modelRelative)) { throw "Referencia de modelo invalida no PBIR." }
        $modelPath = [IO.Path]::GetFullPath((Join-Path $reportPath $modelRelative))
        if (-not ($modelPath + '\').StartsWith($demoPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $modelPath -PathType Container)) {
            throw "O PBIR referencia um modelo fora da demo."
        }
        Write-Host "[OK] PBIP e PBIR usam referencias relativas validas" -ForegroundColor Green

        Write-Host "[ETAPA 4/4] Validando totais e PBIR quando a CLI estiver disponivel"
        & (Join-Path $stagingDestination "Test-VendasDemo.ps1")
        $reportAuthor = @(
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-report-author.cmd"),
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-report-author.exe"),
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-report-author")
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($reportAuthor)) {
            $pathCommand = Get-Command powerbi-report-author -ErrorAction SilentlyContinue
            if ($null -ne $pathCommand) { $reportAuthor = $pathCommand.Source }
        }
        if ([string]::IsNullOrWhiteSpace($reportAuthor)) {
            Write-Host "[AVISO] CLI PBIR indisponivel; validacao JSON, referencias e totais concluida." -ForegroundColor Yellow
        }
        else {
            [void](Invoke-ReportValidation $reportAuthor $pbipPath 30)
            Write-Host "[OK] PBIR validado pela CLI" -ForegroundColor Green
        }
        if (Test-Path -LiteralPath $DemoDestination) { throw "O destino da demo passou a existir durante a preparacao: $DemoDestination" }
        [IO.Directory]::Move($stagingDestination, $DemoDestination)
        $stagingCreated = $false
        $pbipPath = Join-Path $DemoDestination "VendasDemo.pbip"
        Write-Host "[OK] Copia independente criada sem caches ou junctions" -ForegroundColor Green
        Write-Host "[AVISO] Bridge e MCP sao opcionais e nao foram executados; validacao visual nao executada." -ForegroundColor Yellow
        Write-Host "[PROXIMO] PBIP para abrir: $pbipPath" -ForegroundColor Cyan
        return
    }
    catch {
        if ($stagingCreated -and (Test-Path -LiteralPath $stagingDestination -PathType Container)) {
            Remove-Item -LiteralPath $stagingDestination -Recurse -Force -ErrorAction SilentlyContinue
        }
        throw
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($DemoDestination)) {
    throw "Use -PrepareDemo ao informar -DemoDestination."
}
if ($PrepareCopy) {
    if ([string]::IsNullOrWhiteSpace($CopyDestination)) { throw "-CopyDestination e obrigatorio com -PrepareCopy." }
    $CopyDestination = [IO.Path]::GetFullPath($CopyDestination)
    if (Test-Path -LiteralPath $CopyDestination) { throw "O destino da copia deve ser novo: $CopyDestination" }
    Assert-NoReparseInExistingPath (Split-Path -Parent $CopyDestination)
    $sourcePrefix = $ProjectPath.TrimEnd('\') + '\'
    if (($CopyDestination + '\').StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "O destino da copia nao pode ficar dentro do projeto original."
    }
    $originalSnapshot = Get-FileSnapshot $ProjectPath
    Copy-RegularTree $ProjectPath $CopyDestination
    $starter = Join-Path $InstallRoot "bin\Start-PowerBI-OpenCode.ps1"
    & $starter -ProjectPath $CopyDestination -InstallRoot $InstallRoot -InitializeOnly -Force
    foreach ($relative in $originalSnapshot.Keys) {
        $original = Resolve-SafeRelativePath $ProjectPath $relative
        $copy = Resolve-SafeRelativePath $CopyDestination $relative
        if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne $originalSnapshot[$relative]) {
            throw "O projeto original foi alterado durante PrepareCopy: $relative"
        }
        if (-not (Test-Path -LiteralPath $copy -PathType Leaf) -or (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -ne $originalSnapshot[$relative]) {
            throw "Conteudo original nao foi preservado na copia: $relative"
        }
    }
    $ProjectPath = $CopyDestination
}
elseif (-not [string]::IsNullOrWhiteSpace($CopyDestination)) {
    throw "Use -PrepareCopy ao informar -CopyDestination."
}

$inventoryPath = Join-Path $InstallRoot "managed-inventory.json"
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw "Inventario ausente: $inventoryPath" }
try { $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json }
catch { throw "Inventario JSON invalido: $($_.Exception.Message)" }
if ($inventory.schemaVersion -ne 1 -or $null -eq $inventory.managedFiles) { throw "Inventario gerenciado invalido." }
foreach ($relative in @($inventory.managedFiles)) {
    $managed = Resolve-SafeRelativePath $InstallRoot ([string]$relative)
    if (-not (Test-Path -LiteralPath $managed -PathType Leaf)) { throw "Arquivo gerenciado ausente: $relative" }
}
Write-Host "arquivo validado: $inventoryPath"

$skillsRoot = Join-Path $InstallRoot "skills"
$skillDirectories = @(Get-ChildItem -LiteralPath $skillsRoot -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") -PathType Leaf
})
foreach ($requiredSkill in @("powerbi-report-cli", "semantic-model-authoring", "rode-o-bpa", "check-updates", "powerbi-desktop-safe")) {
    if ($skillDirectories.Name -notcontains $requiredSkill) { throw "Skill nao descoberta: $requiredSkill" }
}
Assert-MarkdownDependencies $skillsRoot

$package = Get-Content -LiteralPath (Join-Path $InstallRoot "node\package.json") -Raw | ConvertFrom-Json
$lock = Read-JsonDictionary (Join-Path $InstallRoot "node\package-lock.json")
$expected = [ordered]@{
    "@microsoft/powerbi-report-authoring-cli" = "0.5.0"
    "@microsoft/powerbi-desktop-bridge-cli" = "1.0.0"
    "@microsoft/powerbi-modeling-mcp" = "1.0.0"
}
foreach ($name in $expected.Keys) {
    if ($package.dependencies.$name -ne $expected[$name] -or $lock["packages"][""]["dependencies"][$name] -ne $expected[$name]) {
        throw "Versao npm incorreta: $name"
    }
}
Write-Host "arquivo validado: package.json/package-lock.json"
$installedPackageCount = 0
foreach ($name in $expected.Keys) {
    $installedManifest = Join-Path $InstallRoot ("node\node_modules\" + $name + "\package.json")
    if (-not (Test-Path -LiteralPath $installedManifest -PathType Leaf)) {
        Write-Host "CLI/MCP nao instalado para diagnostico: $name" -ForegroundColor Yellow
        continue
    }
    $installedPackage = Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json
    if ($installedPackage.version -ne $expected[$name]) { throw "Pacote npm instalado em versao incorreta: $name" }
    $installedPackageCount++
}
if ($installedPackageCount -eq $expected.Count) { Write-Host "arquivo validado: pacotes npm instalados" }

foreach ($script in @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot "bin") -Filter "*.ps1" -File)) {
    Assert-PowerShellSyntax $script.FullName
}
$rootRestore = Join-Path $InstallRoot "Restore-PowerBI-OpenCodeAccelerator.ps1"
Assert-PowerShellSyntax $rootRestore
$generatedShortcut = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.ps1"
if (Test-Path -LiteralPath $generatedShortcut -PathType Leaf) { Assert-PowerShellSyntax $generatedShortcut }

foreach ($file in @(Get-RegularFiles $ProjectPath | Where-Object { $_.Extension -in @(".pbip", ".pbir", ".tmdl") })) {
    if ($file.Extension -in @(".pbip", ".pbir")) {
        try { [void](Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json) }
        catch { throw "Arquivo Power BI JSON invalido: $($file.FullName)" }
    }
    elseif ($file.Length -eq 0) { throw "Arquivo TMDL vazio: $($file.FullName)" }
    Write-Host "arquivo validado: $($file.FullName)"
}

if ($TestBridge) {
    if ([string]::IsNullOrWhiteSpace($BridgeCommand)) {
        $BridgeCommand = @(
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-desktop.cmd"),
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-desktop.exe"),
            (Join-Path $InstallRoot "node\node_modules\.bin\powerbi-desktop")
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if ([string]::IsNullOrWhiteSpace($BridgeCommand) -or -not (Test-Path -LiteralPath $BridgeCommand -PathType Leaf)) {
        Write-Host "bridge unavailable: executavel local nao encontrado" -ForegroundColor Yellow
    }
    else {
        $bridgeConnected = $false
        $lastResult = $null
        for ($attempt = 1; $attempt -le [Math]::Max(1, $BridgeAttempts); $attempt++) {
            $lastResult = Invoke-BridgeStatus $BridgeCommand ([Math]::Max(1, $BridgeTimeoutSeconds))
            if ($lastResult.connected) { $bridgeConnected = $true; break }
        }
        if ($bridgeConnected) { Write-Host "bridge conectada" -ForegroundColor Green }
        else { Write-Host "bridge unavailable: $($lastResult.detail)" -ForegroundColor Yellow }
    }
}
else {
    Write-Host "bridge unavailable: diagnostico nao solicitado"
}
Write-Host "validacao visual not executed"
