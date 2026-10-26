#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\OpenCode\PowerBI-Accelerator",
    [switch]$Force,
    [switch]$SkipNpmInstall,
    [string]$SkillsSourcePath,
    [string]$RepositoryUrl = "https://github.com/microsoft/skills-for-fabric.git",
    [switch]$TestOnlyAllowUnverifiedSkillsSource,
    [switch]$TestOnlySkipPrerequisiteChecks,
    [int]$TestOnlyFailAfterApplyCount = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PinnedCommit = "bc42aaf734771bf752c1d7082dd91e5a6ca72b9f"
$PluginVersion = "0.3.19"
$PluginRelativePath = "plugins\powerbi-authoring"
$ExpectedMicrosoftSkills = @("powerbi-report-cli", "semantic-model-authoring")
$BundledCustomSkills = @("rode-o-bpa", "check-updates")
$BundledCommands = @("demo-powerbi")
$RequiredCommonFiles = @("COMMON-CORE.md", "COMMON-CLI.md", "ITEM-DEFINITIONS-CORE.md")
$BundleRoot = $PSScriptRoot
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$InventoryPath = Join-Path $InstallRoot "managed-inventory.json"
$StageRoot = Join-Path ([IO.Path]::GetTempPath()) ("powerbi-opencode-stage-" + [Guid]::NewGuid().ToString("N"))
$PayloadRoot = Join-Path $StageRoot "payload"
$commitStarted = $false
$backupRoot = $null
$newManagedFiles = @()
$backupManifest = $null

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-WarnMessage([string]$Text) { Write-Host "    AVISO  $Text" -ForegroundColor Yellow }

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    Ensure-Directory (Split-Path -Parent $Path)
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Assert-Command([string]$Name, [string]$Hint) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) { throw "Comando '$Name' nao encontrado. $Hint" }
    & $command.Source --version *> $null
    if ($LASTEXITCODE -ne 0) { throw "'$Name --version' falhou com codigo $LASTEXITCODE." }
    Write-Ok "$Name encontrado."
}

function Assert-Prerequisites {
    if ($TestOnlySkipPrerequisiteChecks) {
        Write-WarnMessage "Verificacoes de disponibilidade ignoradas por switch exclusivo de teste."
        return
    }

    Assert-Command "git" "Instale Git for Windows."
    Assert-Command "node" "Instale Node.js 20 ou superior."
    $nodeVersion = (& node --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') {
        throw "Nao foi possivel determinar a versao do Node.js: $nodeVersion"
    }
    if ([int]$Matches[1] -lt 20) { throw "Node.js 20+ e obrigatorio. Detectado: $nodeVersion" }
    Assert-Command "npm" "npm deve ser instalado com o Node.js."
    Assert-Command "opencode" "Instale o OpenCode antes de executar o instalador."
}

function Invoke-Git([string[]]$Arguments, [string]$FailureMessage) {
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FailureMessage (codigo $LASTEXITCODE)." }
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    Ensure-Directory $Destination
    foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
    }
}

function Get-RelativePath([string]$Root, [string]$Path) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho fora da raiz permitida: $Path"
    }
    return $pathFull.Substring($rootFull.Length)
}

function Resolve-SafeRelativePath([string]$Root, [string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
        throw "Caminho relativo invalido no manifesto: '$RelativePath'."
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
    if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho escapa da raiz permitida: '$RelativePath'."
    }
    $current = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    foreach ($segment in $RelativePath -split '[\\/]') {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Caminho gerenciado contem junction ou link simbolico: '$RelativePath'."
        }
    }
    return $full
}

function Assert-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSON obrigatorio ausente: $Path" }
    try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
    catch { throw "JSON invalido em '$Path': $($_.Exception.Message)" }
}

function Read-JsonDictionary([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSON obrigatorio ausente: $Path" }
    try {
        Add-Type -AssemblyName System.Web.Extensions
        $serializer = New-Object Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        return $serializer.DeserializeObject((Get-Content -LiteralPath $Path -Raw))
    }
    catch { throw "JSON invalido em '$Path': $($_.Exception.Message)" }
}

function Assert-PowerShellSyntax([string]$Path) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "PowerShell invalido em '$Path': $($errors[0].Message)" }
}

function Assert-MarkdownDependencies([string]$SkillsRoot, [string]$PayloadRootPath) {
    $payloadPrefix = [IO.Path]::GetFullPath($PayloadRootPath).TrimEnd('\') + '\'
    foreach ($markdown in @(Get-ChildItem -LiteralPath $SkillsRoot -Filter "*.md" -File -Recurse)) {
        $content = Get-Content -LiteralPath $markdown.FullName -Raw
        $matches = [regex]::Matches($content, '(?<!!)\[[^\]]*\]\((?<target>[^)]+)\)')
        foreach ($match in $matches) {
            $target = $match.Groups["target"].Value.Trim()
            if ($target.StartsWith("<") -and $target.EndsWith(">")) { $target = $target.Substring(1, $target.Length - 2) }
            if ($target -match '^(?i)(https?:|mailto:|data:|#)') { continue }
            if ($target -match '^(.+?\.md)(?:\s+["''].*)?$') { $target = $Matches[1] } else { continue }
            $target = [Uri]::UnescapeDataString(($target -split '#', 2)[0]).Replace('/', '\')
            $resolved = [IO.Path]::GetFullPath((Join-Path $markdown.DirectoryName $target))
            if (-not $resolved.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Dependencia Markdown escapa do payload: '$target' em '$($markdown.FullName)'."
            }
            if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                throw "Dependencia Markdown ausente: '$target' referenciada por '$($markdown.FullName)'."
            }
        }
    }
}

function Assert-SkillMetadata([string]$SkillRoot, [string]$ExpectedName) {
    $skillFile = Join-Path $SkillRoot "SKILL.md"
    $content = Get-Content -LiteralPath $skillFile -Raw
    if ($content -notmatch '(?s)^---\s*\r?\n(?<frontmatter>.*?)\r?\n---') {
        throw "Frontmatter ausente em: $skillFile"
    }
    $frontmatter = $Matches["frontmatter"]
    if ($frontmatter -notmatch '(?m)^name:\s*(?<name>[^\r\n#]+?)\s*$' -or $Matches["name"].Trim() -ne $ExpectedName) {
        throw "Nome da skill nao corresponde ao diretorio '$ExpectedName': $skillFile"
    }
    if ($frontmatter -notmatch '(?m)^description:\s*(?:>|\|)?\s*(?:\r?\n|\S)') {
        throw "Description ausente no frontmatter: $skillFile"
    }
}

function Assert-OpenCodeCommand([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Comando OpenCode ausente: $Path" }
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content -notmatch '(?s)^---\s*\r?\n(?<frontmatter>.*?)\r?\n---\s*\r?\n(?<body>.+)$') {
        throw "Frontmatter ou corpo ausente no comando OpenCode: $Path"
    }
    $frontmatter = $Matches['frontmatter']
    $body = $Matches['body']
    if ($frontmatter -notmatch '(?m)^description:\s*\S.+$') {
        throw "Description ausente no comando OpenCode: $Path"
    }
    if ([string]::IsNullOrWhiteSpace($body)) { throw "Prompt vazio no comando OpenCode: $Path" }
}

function Assert-PortableDemoSource([string]$Root) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root "VendasDemo.pbip") -PathType Leaf)) {
        throw "Exemplo VendasDemo invalido: VendasDemo.pbip ausente."
    }
    $pending = New-Object 'Collections.Generic.Queue[string]'
    $pending.Enqueue([IO.Path]::GetFullPath($Root))
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Exemplo VendasDemo contem junction ou link simbolico: $($item.FullName)"
            }
            if ($item.PSIsContainer) {
                if ($item.Name -in @('.pbi', '.opencode', 'node_modules')) {
                    throw "Exemplo VendasDemo contem diretorio local proibido: $($item.FullName)"
                }
                $pending.Enqueue($item.FullName)
            }
        }
    }
}

function Test-IsUnderRelativeRoot([string]$RelativePath, [string[]]$Roots) {
    $normalized = $RelativePath.TrimStart('\')
    foreach ($root in $Roots) {
        $normalizedRoot = $root.TrimEnd('\')
        if ($normalized -ieq $normalizedRoot -or $normalized.StartsWith($normalizedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Get-Inventory {
    if (-not (Test-Path -LiteralPath $InventoryPath -PathType Leaf)) { return $null }
    $inventory = Assert-JsonFile $InventoryPath
    if ($inventory.schemaVersion -ne 1 -or $null -eq $inventory.managedFiles) {
        throw "Inventario gerenciado invalido: $InventoryPath"
    }
    return $inventory
}

function Add-ExistingFiles([Collections.Generic.HashSet[string]]$Set, [string]$RelativePath) {
    $full = Resolve-SafeRelativePath $InstallRoot $RelativePath
    if (Test-Path -LiteralPath $full -PathType Leaf) {
        [void]$Set.Add($RelativePath)
    }
    elseif (Test-Path -LiteralPath $full -PathType Container) {
        foreach ($file in @(Get-ChildItem -LiteralPath $full -File -Recurse -Force)) {
            [void]$Set.Add((Get-RelativePath $InstallRoot $file.FullName))
        }
    }
}

function Restore-BackupInProcess($Manifest, [string]$BackupDirectory) {
    foreach ($relative in @($Manifest.installedFiles)) {
        $target = Resolve-SafeRelativePath $InstallRoot ([string]$relative)
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    foreach ($entry in @($Manifest.previousFiles)) {
        $source = Resolve-SafeRelativePath $BackupDirectory ([string]$entry.backupPath)
        $target = Resolve-SafeRelativePath $InstallRoot ([string]$entry.path)
        Ensure-Directory (Split-Path -Parent $target)
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
}

try {
    Write-Step "Validando pre-requisitos"
    Assert-Prerequisites

    Ensure-Directory $StageRoot
    Ensure-Directory $PayloadRoot

    Write-Step "Preparando e validando a fonte Microsoft fixada"
    $sourceWasCloned = [string]::IsNullOrWhiteSpace($SkillsSourcePath)
    $sourceGitRoot = $null
    if ($sourceWasCloned) {
        $sourceRoot = Join-Path $StageRoot "skills-for-fabric"
        Invoke-Git @("clone", "--no-checkout", $RepositoryUrl, $sourceRoot) "Falha ao clonar $RepositoryUrl"
        Invoke-Git @("-C", $sourceRoot, "checkout", "--detach", $PinnedCommit) "Falha ao obter o commit fixado $PinnedCommit"
        $sourceHead = (& git -C $sourceRoot rev-parse HEAD 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Falha ao ler o HEAD da fonte clonada." }
        if ($sourceHead -ne $PinnedCommit) { throw "HEAD invalido. Esperado: $PinnedCommit; obtido: $sourceHead" }
        $pluginRoot = Join-Path $sourceRoot $PluginRelativePath
    }
    else {
        $sourceRoot = [IO.Path]::GetFullPath($SkillsSourcePath)
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            throw "Fonte de skills nao encontrada: $sourceRoot"
        }
        $candidate = Join-Path $sourceRoot $PluginRelativePath
        if (Test-Path -LiteralPath $candidate -PathType Container) { $pluginRoot = $candidate }
        else { $pluginRoot = $sourceRoot }
        $sourceGitRoot = if (Test-Path -LiteralPath (Join-Path $sourceRoot ".git")) { $sourceRoot } else { $null }
        if ($null -ne $sourceGitRoot) {
            $sourceHead = (& git -C $sourceGitRoot rev-parse HEAD 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or $sourceHead -ne $PinnedCommit) {
                throw "A fonte local nao corresponde ao commit fixado $PinnedCommit."
            }
            $sourceStatus = (& git -C $sourceGitRoot status --porcelain --untracked-files=all 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($sourceStatus)) {
                throw "A fonte Git local deve estar limpa para representar o commit oficial fixado."
            }
        }
        elseif (-not $TestOnlyAllowUnverifiedSkillsSource) {
            throw "A fonte local nao e um clone Git verificavel. O uso de fixtures exige -TestOnlyAllowUnverifiedSkillsSource."
        }
    }

    if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
        throw "Plugin powerbi-authoring nao encontrado em: $pluginRoot"
    }
    $claudeManifest = Assert-JsonFile (Join-Path $pluginRoot ".claude-plugin\plugin.json")
    $githubManifest = Assert-JsonFile (Join-Path $pluginRoot ".github\plugin\plugin.json")
    foreach ($manifest in @($claudeManifest, $githubManifest)) {
        if ($manifest.name -ne "powerbi-authoring" -or $manifest.version -ne $PluginVersion) {
            throw "Manifesto powerbi-authoring inesperado. Nome/version esperados: powerbi-authoring/$PluginVersion."
        }
        $manifestSkills = @($manifest.skills | ForEach-Object { ([string]$_).Replace('/', '\').TrimEnd('\') } | Sort-Object)
        $expectedManifestSkills = @($ExpectedMicrosoftSkills | ForEach-Object { ".\skills\$_" } | Sort-Object)
        if (($manifestSkills -join '|') -ne ($expectedManifestSkills -join '|')) {
            throw "Manifesto powerbi-authoring nao declara exatamente as skills esperadas."
        }
    }
    $officialMcpManifest = Assert-JsonFile (Join-Path $pluginRoot ".mcp.json")
    $officialMcp = $officialMcpManifest.mcpServers.'powerbi-modeling-mcp'
    if ($null -eq $officialMcp -or $officialMcp.command -ne "npx" -or
        (@($officialMcp.args) -notcontains "@microsoft/powerbi-modeling-mcp@latest")) {
        throw "Manifesto MCP oficial powerbi-authoring tem formato inesperado."
    }

    $sourceSkills = Join-Path $pluginRoot "skills"
    foreach ($skillName in $ExpectedMicrosoftSkills) {
        $skillRoot = Join-Path $sourceSkills $skillName
        if (-not (Test-Path -LiteralPath (Join-Path $skillRoot "SKILL.md") -PathType Leaf)) {
            throw "Skill Microsoft obrigatoria ausente ou invalida: $skillName"
        }
        Assert-SkillMetadata $skillRoot $skillName
    }
    $actualSkills = @(Get-ChildItem -LiteralPath $sourceSkills -Directory | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") -PathType Leaf
    } | Select-Object -ExpandProperty Name)
    foreach ($skillName in $actualSkills) {
        if ($ExpectedMicrosoftSkills -notcontains $skillName) {
            throw "Skill inesperada no plugin powerbi-authoring fixado: $skillName"
        }
    }
    $sourceCommon = Join-Path $pluginRoot "common"
    foreach ($commonFile in $RequiredCommonFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceCommon $commonFile) -PathType Leaf)) {
            throw "Arquivo common obrigatorio ausente: $commonFile"
        }
    }

    Write-Step "Montando payload transacional"
    $payloadSkills = Join-Path $PayloadRoot "skills"
    Ensure-Directory $payloadSkills
    foreach ($skillName in $ExpectedMicrosoftSkills) {
        Copy-Item -LiteralPath (Join-Path $sourceSkills $skillName) -Destination $payloadSkills -Recurse -Force
    }
    foreach ($skillName in $BundledCustomSkills) {
        $customSource = Join-Path $BundleRoot "skills\$skillName"
        if (-not (Test-Path -LiteralPath (Join-Path $customSource "SKILL.md") -PathType Leaf)) {
            throw "Skill customizada empacotada ausente: $skillName"
        }
        Assert-SkillMetadata $customSource $skillName
        Copy-Item -LiteralPath $customSource -Destination $payloadSkills -Recurse -Force
    }
    Copy-DirectoryContents $sourceCommon (Join-Path $PayloadRoot "common")
    Copy-Item -LiteralPath $pluginRoot -Destination (Join-Path $PayloadRoot "vendor\powerbi-authoring") -Recurse -Force

    Ensure-Directory (Join-Path $PayloadRoot "bin")
    foreach ($scriptName in @("Start-PowerBI-OpenCode.ps1", "Test-PowerBI-OpenCodeAccelerator.ps1", "Restore-PowerBI-OpenCodeAccelerator.ps1")) {
        $scriptSource = Join-Path $BundleRoot "bin\$scriptName"
        if (-not (Test-Path -LiteralPath $scriptSource -PathType Leaf)) { throw "Script empacotado ausente: $scriptSource" }
        Assert-PowerShellSyntax $scriptSource
        Copy-Item -LiteralPath $scriptSource -Destination (Join-Path $PayloadRoot "bin\$scriptName") -Force
    }
    Copy-Item -LiteralPath (Join-Path $BundleRoot "bin\pbi-ai.cmd") -Destination (Join-Path $PayloadRoot "bin\pbi-ai.cmd") -Force
    Copy-Item -LiteralPath (Join-Path $BundleRoot "Restore-PowerBI-OpenCodeAccelerator.ps1") -Destination (Join-Path $PayloadRoot "Restore-PowerBI-OpenCodeAccelerator.ps1") -Force
    Ensure-Directory (Join-Path $PayloadRoot "templates")
    Copy-Item -LiteralPath (Join-Path $BundleRoot "templates\AGENTS.md") -Destination (Join-Path $PayloadRoot "templates\AGENTS.md") -Force

    Ensure-Directory (Join-Path $PayloadRoot "commands")
    foreach ($commandName in $BundledCommands) {
        $commandSource = Join-Path $BundleRoot ".opencode\commands\$commandName.md"
        Assert-OpenCodeCommand $commandSource
        Copy-Item -LiteralPath $commandSource -Destination (Join-Path $PayloadRoot "commands\$commandName.md") -Force
    }

    $demoSource = Join-Path $BundleRoot "examples\VendasDemo"
    Assert-PortableDemoSource $demoSource
    Assert-PowerShellSyntax (Join-Path $demoSource "Test-VendasDemo.ps1")
    Copy-DirectoryContents $demoSource (Join-Path $PayloadRoot "examples\VendasDemo")

    $payloadNode = Join-Path $PayloadRoot "node"
    Ensure-Directory $payloadNode
    Copy-Item -LiteralPath (Join-Path $BundleRoot "node\package.json") -Destination (Join-Path $payloadNode "package.json") -Force
    Copy-Item -LiteralPath (Join-Path $BundleRoot "node\package-lock.json") -Destination (Join-Path $payloadNode "package-lock.json") -Force
    $package = Assert-JsonFile (Join-Path $payloadNode "package.json")
    $lock = Read-JsonDictionary (Join-Path $payloadNode "package-lock.json")
    $requiredPackages = [ordered]@{
        "@microsoft/powerbi-report-authoring-cli" = "0.5.0"
        "@microsoft/powerbi-desktop-bridge-cli" = "1.0.0"
        "@microsoft/powerbi-modeling-mcp" = "1.0.0"
    }
    foreach ($packageName in $requiredPackages.Keys) {
        if ($package.dependencies.$packageName -ne $requiredPackages[$packageName]) {
            throw "Versao incorreta em package.json para $packageName."
        }
        if ($lock["packages"][""]["dependencies"][$packageName] -ne $requiredPackages[$packageName]) {
            throw "Versao incorreta em package-lock.json para $packageName."
        }
    }

    Assert-MarkdownDependencies $payloadSkills $PayloadRoot
    if (-not $SkipNpmInstall) {
        Write-Step "Instalando dependencias npm no staging"
        & npm ci --prefix $payloadNode --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci falhou com codigo $LASTEXITCODE." }
        foreach ($packageName in $requiredPackages.Keys) {
            $installedManifest = Join-Path $payloadNode ("node_modules\" + $packageName + "\package.json")
            $installed = Assert-JsonFile $installedManifest
            if ($installed.version -ne $requiredPackages[$packageName]) {
                throw "npm instalou versao inesperada de ${packageName}: $($installed.version)"
            }
        }
    }
    else {
        Write-WarnMessage "npm ci ignorado; o payload de metadados continua validado."
    }

    $oldInventory = Get-Inventory
    $oldManagedFiles = if ($null -eq $oldInventory) { @() } else { @($oldInventory.managedFiles | ForEach-Object { [string]$_ }) }
    $newManagedFiles = @(Get-ChildItem -LiteralPath $PayloadRoot -File -Recurse -Force | ForEach-Object {
        Get-RelativePath $PayloadRoot $_.FullName
    })
    if ($SkipNpmInstall) {
        $existingNodeModules = Join-Path $InstallRoot "node\node_modules"
        if (Test-Path -LiteralPath $existingNodeModules -PathType Container) {
            foreach ($packageName in $requiredPackages.Keys) {
                $existingManifest = Join-Path $existingNodeModules ("$packageName\package.json")
                $existingPackage = Assert-JsonFile $existingManifest
                if ($existingPackage.version -ne $requiredPackages[$packageName]) {
                    throw "-SkipNpmInstall recusado: $packageName instalado em versao diferente de $($requiredPackages[$packageName])."
                }
            }
            foreach ($existingNodeFile in @(Get-ChildItem -LiteralPath $existingNodeModules -File -Recurse -Force)) {
                $newManagedFiles += Get-RelativePath $InstallRoot $existingNodeFile.FullName
            }
        }
        foreach ($oldPath in $oldManagedFiles) {
            if ($oldPath -like "node\node_modules\*") {
                $existing = Resolve-SafeRelativePath $InstallRoot $oldPath
                if (Test-Path -LiteralPath $existing -PathType Leaf) { $newManagedFiles += $oldPath }
            }
        }
    }
    $newManagedFiles += "managed-inventory.json"
    $newManagedFiles = @($newManagedFiles | Sort-Object -Unique)
    $inventory = [ordered]@{
        schemaVersion = 1
        acceleratorVersion = "2.1.0"
        source = [ordered]@{
            repository = $RepositoryUrl
            commit = if ($sourceWasCloned -or $null -ne $sourceGitRoot) { $PinnedCommit } else { $null }
            tag = if ($sourceWasCloned -or $null -ne $sourceGitRoot) { "v0.3.19" } else { $null }
            fixture = (-not $sourceWasCloned -and $null -eq $sourceGitRoot)
            plugin = "powerbi-authoring"
            pluginVersion = $PluginVersion
        }
        managedFiles = $newManagedFiles
    }
    Write-Utf8NoBom (Join-Path $PayloadRoot "managed-inventory.json") ($inventory | ConvertTo-Json -Depth 8)

    $obsoleteMigrationRoots = @(
        "skills\powerbi-report-authoring",
        "skills\powerbi-report-design",
        "skills\powerbi-report-management",
        "skills\powerbi-report-planning",
        "vendor\skills-for-fabric"
    )
    $migrationRoots = @($obsoleteMigrationRoots) + @(
        "vendor\powerbi-authoring",
        "templates\Abrir-PowerBI-OpenCode.ps1.template"
    )
    if (-not $SkipNpmInstall) { $migrationRoots += "node" }
    $legacyManagedRoots = @($migrationRoots) + @(
        "skills\semantic-model-authoring",
        "skills\rode-o-bpa",
        "skills\check-updates",
        "common\COMMON-CORE.md",
        "common\COMMON-CLI.md",
        "common\ITEM-DEFINITIONS-CORE.md",
        "bin\Start-PowerBI-OpenCode.ps1",
        "bin\pbi-ai.cmd",
        "templates\AGENTS.md",
        "templates\Abrir-PowerBI-OpenCode.ps1.template",
        "Restore-PowerBI-OpenCodeAccelerator.ps1"
    )
    $oldManagedSet = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($relative in $oldManagedFiles) { [void]$oldManagedSet.Add($relative) }
    $collisions = @()
    foreach ($relative in $newManagedFiles) {
        $destination = Resolve-SafeRelativePath $InstallRoot $relative
        $source = Resolve-SafeRelativePath $PayloadRoot $relative
        $typeCollision = (Test-Path -LiteralPath $destination -PathType Container) -and (Test-Path -LiteralPath $source -PathType Leaf)
        if ((Test-Path -LiteralPath $destination) -and ($typeCollision -or
            (-not $oldManagedSet.Contains($relative) -and -not (Test-IsUnderRelativeRoot $relative $legacyManagedRoots)))) {
            $collisions += $relative
        }
    }
    if ($collisions.Count -gt 0 -and -not $Force) {
        throw "A instalacao preservou arquivos nao gerenciados que colidem com o payload: $($collisions -join ', '). Revise-os ou execute com -Force para preserva-los no backup e substituir os destinos."
    }
    if ($collisions.Count -gt 0) {
        Write-WarnMessage "-Force autorizado: arquivos em colisao serao preservados no backup antes da substituicao."
    }

    Write-Step "Criando backup e aplicando payload"
    Ensure-Directory $InstallRoot
    $backupRoot = Join-Path $InstallRoot ("backups\" + (Get-Date -Format "yyyyMMdd-HHmmssfff") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
    $backupPayload = Join-Path $backupRoot "files"
    Ensure-Directory $backupPayload

    $affected = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($relative in $oldManagedFiles) { Add-ExistingFiles $affected $relative }
    foreach ($relative in $migrationRoots) { Add-ExistingFiles $affected $relative }
    foreach ($relative in $newManagedFiles) { Add-ExistingFiles $affected $relative }

    $previousFiles = @()
    foreach ($relative in @($affected | Sort-Object)) {
        $source = Resolve-SafeRelativePath $InstallRoot $relative
        $backupRelative = Join-Path "files" $relative
        $destination = Resolve-SafeRelativePath $backupRoot $backupRelative
        Ensure-Directory (Split-Path -Parent $destination)
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $previousFiles += [ordered]@{ path = $relative; backupPath = $backupRelative }
    }
    $backupManifest = [ordered]@{
        schemaVersion = 1
        createdUtc = [DateTime]::UtcNow.ToString("o")
        installRoot = $InstallRoot
        installedFiles = $newManagedFiles
        previousFiles = $previousFiles
    }
    Write-Utf8NoBom (Join-Path $backupRoot "backup-manifest.json") ($backupManifest | ConvertTo-Json -Depth 8)
    $commitStarted = $true

    foreach ($relative in $migrationRoots) {
        $target = Resolve-SafeRelativePath $InstallRoot $relative
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
    foreach ($relative in $oldManagedFiles) {
        if ($newManagedFiles -notcontains $relative) {
            $target = Resolve-SafeRelativePath $InstallRoot $relative
            if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
        }
    }

    $appliedCount = 0
    foreach ($relative in $newManagedFiles) {
        $source = Resolve-SafeRelativePath $PayloadRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            if ($SkipNpmInstall -and $relative -like "node\node_modules\*") { continue }
            throw "Arquivo do payload ausente durante aplicacao: $relative"
        }
        $destination = Resolve-SafeRelativePath $InstallRoot $relative
        Ensure-Directory (Split-Path -Parent $destination)
        if (Test-Path -LiteralPath $destination -PathType Container) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $appliedCount++
        if ($TestOnlyFailAfterApplyCount -gt 0 -and $appliedCount -ge $TestOnlyFailAfterApplyCount) {
            throw "Falha de aplicacao solicitada por switch exclusivo de teste."
        }
    }

    Write-Step "Instalacao concluida"
    Write-Ok "Acelerador instalado em: $InstallRoot"
    Write-Ok "Microsoft skills-for-fabric fixado em v0.3.19 ($PinnedCommit)."
    Write-Host "Backup mantido em: $backupRoot"
    Write-Host "Rollback: & `"$(Join-Path $InstallRoot 'Restore-PowerBI-OpenCodeAccelerator.ps1')`" -InstallRoot `"$InstallRoot`" -BackupPath `"$backupRoot`""
}
catch {
    if ($commitStarted -and $null -ne $backupManifest -and $null -ne $backupRoot) {
        try {
            Restore-BackupInProcess $backupManifest $backupRoot
            Write-WarnMessage "Falha durante aplicacao; rollback automatico concluido."
            Write-Host "Rollback manual: & `"$(Join-Path $InstallRoot 'Restore-PowerBI-OpenCodeAccelerator.ps1')`" -InstallRoot `"$InstallRoot`" -BackupPath `"$backupRoot`""
        }
        catch {
            Write-Error "Rollback automatico falhou: $($_.Exception.Message)"
        }
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
