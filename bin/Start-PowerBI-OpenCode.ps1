#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$InitializeOnly,
    [switch]$OpenDesktop,
    [switch]$Force,
    [switch]$EnableModelingMcp,
    [ValidateSet("attended", "background")]
    [string]$ExecutionMode,
    [string]$ExecutionTaskId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$InteractiveSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
$SharedSkills = Join-Path $InstallRoot "skills"
$SharedCommon = Join-Path $InstallRoot "common"
$LocalBin = Join-Path $InstallRoot "node\node_modules\.bin"
$TemplateAgents = Join-Path $InstallRoot "templates\AGENTS.md"
$ManagedDemoCommand = Join-Path $InstallRoot "commands\demo-powerbi.md"
$ManagedDemo = Join-Path $InstallRoot "examples\VendasDemo\VendasDemo.pbip"

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Test-ReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Connect-SharedDirectory([string]$ProjectDirectory, [string]$SharedDirectory, [string]$Name, [string]$Timestamp) {
    if (Test-Path -LiteralPath $ProjectDirectory) {
        if (Test-ReparsePoint $ProjectDirectory) {
            $item = Get-Item -LiteralPath $ProjectDirectory -Force
            $currentTarget = [string]$item.Target
            if (-not [string]::IsNullOrWhiteSpace($currentTarget) -and
                [IO.Path]::GetFullPath($currentTarget).TrimEnd('\') -eq [IO.Path]::GetFullPath($SharedDirectory).TrimEnd('\')) {
                Write-Host "$Name ja esta vinculado ao acelerador." -ForegroundColor Green
                return
            }
            if (-not $Force) {
                throw "'$ProjectDirectory' e uma junction para outro destino. Use -Force para recriar somente o vinculo; o destino atual nao sera alterado."
            }
            [IO.Directory]::Delete($ProjectDirectory)
        }
        elseif ($Force) {
            $backup = "$ProjectDirectory.backup-$Timestamp"
            $suffix = 0
            while (Test-Path -LiteralPath $backup) {
                $suffix++
                $backup = "$ProjectDirectory.backup-$Timestamp-$suffix"
            }
            Move-Item -LiteralPath $ProjectDirectory -Destination $backup
            Write-Host "$Name local preservado em: $backup" -ForegroundColor Yellow
        }
        else {
            throw "Ja existe '$ProjectDirectory' e nao e uma junction. Use -Force para move-lo para backup."
        }
    }
    New-Item -ItemType Junction -Path $ProjectDirectory -Target $SharedDirectory | Out-Null
    Write-Host "$Name vinculado ao acelerador." -ForegroundColor Green
}

function Copy-ProjectCommandIfMissing([string]$OpenCodeDirectory, [string]$Source) {
    $pluralDirectory = Join-Path $OpenCodeDirectory "commands"
    $pluralTarget = Join-Path $pluralDirectory "demo-powerbi.md"
    if (Test-Path -LiteralPath $pluralTarget) {
        Write-Host "Comando /demo-powerbi existente preservado." -ForegroundColor Yellow
        return
    }
    if (Test-Path -LiteralPath $pluralDirectory) {
        if (-not (Test-Path -LiteralPath $pluralDirectory -PathType Container)) {
            throw "'.opencode\commands' nao e um diretorio."
        }
        if (Test-ReparsePoint $pluralDirectory) {
            throw "'.opencode\commands' e uma junction ou link; o acelerador nao escreve em destinos externos."
        }
    }
    else {
        Ensure-Directory $pluralDirectory
    }
    [IO.File]::Copy($Source, $pluralTarget, $false)
    Write-Host "Comando /demo-powerbi adicionado." -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw "Projeto nao encontrado: $ProjectPath" }
if (-not (Test-Path -LiteralPath $SharedSkills -PathType Container)) { throw "Skills nao encontradas: $SharedSkills" }
if (-not (Test-Path -LiteralPath $SharedCommon -PathType Container)) { throw "Common nao encontrado: $SharedCommon" }
if (-not (Test-Path -LiteralPath $TemplateAgents -PathType Leaf)) { throw "Template AGENTS.md nao encontrado: $TemplateAgents" }
if (-not (Test-Path -LiteralPath $ManagedDemoCommand -PathType Leaf)) { throw "Comando /demo-powerbi nao encontrado: $ManagedDemoCommand" }
if (-not (Test-Path -LiteralPath $ManagedDemo -PathType Leaf)) { throw "Exemplo VendasDemo nao encontrado: $ManagedDemo" }
if (-not $InitializeOnly -and $null -eq (Get-Command opencode -ErrorAction SilentlyContinue)) {
    throw "OpenCode nao encontrado no PATH."
}
$previousConfig = [Environment]::GetEnvironmentVariable("OPENCODE_CONFIG", "Process")
$previousExecutionTaskId = [Environment]::GetEnvironmentVariable("POWERBI_EXECUTION_TASK_ID", "Process")
$previousExecutionMode = [Environment]::GetEnvironmentVariable("POWERBI_EXECUTION_MODE", "Process")
$previousInteractiveSessionId = [Environment]::GetEnvironmentVariable("POWERBI_INTERACTIVE_SESSION_ID", "Process")
$mcpCommand = $null
if ($EnableModelingMcp -and -not $InitializeOnly) {
    if (-not [string]::IsNullOrWhiteSpace($previousConfig)) {
        throw "OPENCODE_CONFIG ja aponta para '$previousConfig'. Nenhuma configuracao foi alterada."
    }
    $mcpCommand = @(
        (Join-Path $LocalBin "powerbi-modeling-mcp.cmd"),
        (Join-Path $LocalBin "powerbi-modeling-mcp.exe"),
        (Join-Path $LocalBin "powerbi-modeling-mcp")
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($mcpCommand)) {
        throw "MCP local @microsoft/powerbi-modeling-mcp@1.0.0 nao encontrado em: $LocalBin"
    }
}

if (Test-Path -LiteralPath $LocalBin -PathType Container) { $env:PATH = "$LocalBin;$env:PATH" }
$env:PATH = "$(Join-Path $InstallRoot 'bin');$env:PATH"
$env:POWERBI_OPENCODE_ACCELERATOR = $InstallRoot
$env:POWERBI_DESKTOP_SAFE = Join-Path $InstallRoot "bin\powerbi-desktop-safe.cmd"

if ($OpenDesktop -and [string]::IsNullOrWhiteSpace($ExecutionMode)) {
    Write-Host "Como você quer executar?"
    Write-Host "1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas."
    Write-Host "2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco."
    $choice = Read-Host "Escolha 1 ou 2"
    if ($choice -eq "1") { $ExecutionMode = "attended" }
    elseif ($choice -eq "2") { $ExecutionMode = "background" }
    else { throw "Modo de execucao invalido. Nenhuma janela foi aberta ou ativada." }
}
if (-not [string]::IsNullOrWhiteSpace($ExecutionMode)) {
    if ([string]::IsNullOrWhiteSpace($ExecutionTaskId)) {
        $ExecutionTaskId = "launcher:${InteractiveSessionId}:${PID}:$([Guid]::NewGuid().ToString('N'))"
    }
}

$opencodeDirectory = Join-Path $ProjectPath ".opencode"
if (Test-Path -LiteralPath $opencodeDirectory -PathType Leaf) { throw "'.opencode' e um arquivo; esperado diretorio." }
if (Test-ReparsePoint $opencodeDirectory) { throw "'.opencode' e uma junction ou link; o acelerador nao escreve em destinos externos." }
Ensure-Directory $opencodeDirectory
$timestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
Connect-SharedDirectory (Join-Path $opencodeDirectory "skills") $SharedSkills "Skills" $timestamp
Connect-SharedDirectory (Join-Path $opencodeDirectory "common") $SharedCommon "Common" $timestamp
Copy-ProjectCommandIfMissing $opencodeDirectory $ManagedDemoCommand

$agentsTarget = Join-Path $ProjectPath "AGENTS.md"
if (-not (Test-Path -LiteralPath $agentsTarget)) {
    Copy-Item -LiteralPath $TemplateAgents -Destination $agentsTarget
    Write-Host "AGENTS.md criado." -ForegroundColor Green
}
else {
    Write-Host "AGENTS.md existente preservado." -ForegroundColor Yellow
}

$escapedInstallRoot = $InstallRoot.Replace("'", "''")
$shortcutPs1 = @"
[CmdletBinding()]
param(
    [switch]`$InitializeOnly,
    [switch]`$OpenDesktop,
    [switch]`$Force,
    [switch]`$EnableModelingMcp,
    [ValidateSet("attended", "background")]
    [string]`$ExecutionMode,
    [string]`$ExecutionTaskId
)

`$ErrorActionPreference = "Stop"
`$accelerator = '$escapedInstallRoot'
`$starter = Join-Path `$accelerator "bin\Start-PowerBI-OpenCode.ps1"
`$parameters = @{
    ProjectPath = `$PSScriptRoot
    InstallRoot = `$accelerator
    InitializeOnly = `$InitializeOnly
    OpenDesktop = `$OpenDesktop
    Force = `$Force
    EnableModelingMcp = `$EnableModelingMcp
}
if (-not [string]::IsNullOrWhiteSpace(`$ExecutionMode)) { `$parameters.ExecutionMode = `$ExecutionMode }
if (-not [string]::IsNullOrWhiteSpace(`$ExecutionTaskId)) { `$parameters.ExecutionTaskId = `$ExecutionTaskId }
& `$starter @parameters
"@
$shortcutPs1Path = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.ps1"
$shortcutCmdPath = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.cmd"
if (-not (Test-Path -LiteralPath $shortcutPs1Path)) {
    Write-Utf8NoBom $shortcutPs1Path $shortcutPs1
}
if (-not (Test-Path -LiteralPath $shortcutCmdPath)) {
    Write-Utf8NoBom $shortcutCmdPath "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0Abrir-PowerBI-OpenCode.ps1`" %*`r`n"
}

$pbip = Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($OpenDesktop -and $null -ne $pbip) {
    Write-Host "Sessao interativa do launcher: $InteractiveSessionId"
    $safeDesktop = Join-Path $InstallRoot "bin\powerbi-desktop-safe.mjs"
    if (-not (Test-Path -LiteralPath $safeDesktop -PathType Leaf)) { throw "Adaptador Desktop seguro nao encontrado: $safeDesktop" }
    if ($ExecutionMode -eq "background") {
        $openOutput = (& node $safeDesktop execution-mode $pbip.FullName --task-id $ExecutionTaskId --execution-mode $ExecutionMode --session-id $InteractiveSessionId 2>&1 | Out-String).Trim()
    }
    else {
        $openOutput = (& node $safeDesktop open $pbip.FullName --wait-seconds 15 --task-id $ExecutionTaskId --execution-mode $ExecutionMode --session-id $InteractiveSessionId 2>&1 | Out-String).Trim()
    }
    $openExitCode = $LASTEXITCODE
    Write-Host $openOutput
    if ($openExitCode -ne 0) { throw "Abertura segura do Power BI Desktop falhou com codigo $openExitCode." }
    try { $openResult = $openOutput | ConvertFrom-Json }
    catch { throw "Abertura segura retornou JSON invalido: $($_.Exception.Message)" }
    if ($openResult.status -notin @("READY", "OPENING", "TARGET_NOT_READY", "OPEN_IN_PROGRESS", "EXECUTION_MODE_READY")) {
        throw "Abertura segura interrompida pelo estado: $($openResult.status)."
    }
    if ($ExecutionMode -eq "background") {
        Write-Host "Modo background registrado; o Power BI Desktop nao foi aberto nem ativado." -ForegroundColor Green
    }
}

if ($InitializeOnly) {
    Write-Host "Projeto preparado. Comandos personalizados, AGENTS.md e configuracoes OpenCode existentes foram preservados." -ForegroundColor Green
    return
}

$generatedConfig = $null
try {
    if (-not [string]::IsNullOrWhiteSpace($ExecutionTaskId)) {
        $env:POWERBI_EXECUTION_TASK_ID = $ExecutionTaskId
    }
    if (-not [string]::IsNullOrWhiteSpace($ExecutionMode)) {
        $env:POWERBI_EXECUTION_MODE = $ExecutionMode
    }
    $env:POWERBI_INTERACTIVE_SESSION_ID = [string]$InteractiveSessionId
    if ($EnableModelingMcp) {
        $generatedConfig = Join-Path ([IO.Path]::GetTempPath()) ("opencode-powerbi-mcp-" + [Guid]::NewGuid().ToString("N") + ".json")
        $config = [ordered]@{
            '$schema' = "https://opencode.ai/config.json"
            mcp = [ordered]@{
                'powerbi-modeling-mcp-accelerator' = [ordered]@{
                    type = "local"
                    command = @($mcpCommand, "--start")
                    enabled = $true
                    timeout = 30000
                }
            }
        }
        Write-Utf8NoBom $generatedConfig ($config | ConvertTo-Json -Depth 8)
        $env:OPENCODE_CONFIG = $generatedConfig
        $resolvedConfigText = (& opencode debug config 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { throw "OpenCode nao conseguiu resolver a configuracao MCP (codigo $LASTEXITCODE)." }
        try { $resolvedConfig = $resolvedConfigText | ConvertFrom-Json }
        catch { throw "OpenCode retornou configuracao resolvida invalida: $($_.Exception.Message)" }
        $resolvedMcp = $resolvedConfig.mcp.'powerbi-modeling-mcp-accelerator'
        if ($null -eq $resolvedMcp -or $resolvedMcp.type -ne "local" -or -not $resolvedMcp.enabled -or
            @($resolvedMcp.command).Count -ne 2 -or $resolvedMcp.command[0] -ne $mcpCommand -or $resolvedMcp.command[1] -ne "--start") {
            throw "Outra configuracao OpenCode substituiu o MCP local opt-in; nenhuma sessao foi iniciada."
        }
    }

    Set-Location -LiteralPath $ProjectPath
    & opencode
    $openCodeExitCode = $LASTEXITCODE
    if ($openCodeExitCode -ne 0) { throw "OpenCode terminou com codigo $openCodeExitCode." }
}
finally {
    Remove-Item Env:POWERBI_EXECUTION_TASK_ID -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($previousExecutionTaskId)) {
        $env:POWERBI_EXECUTION_TASK_ID = $previousExecutionTaskId
    }
    Remove-Item Env:POWERBI_EXECUTION_MODE -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($previousExecutionMode)) {
        $env:POWERBI_EXECUTION_MODE = $previousExecutionMode
    }
    Remove-Item Env:POWERBI_INTERACTIVE_SESSION_ID -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($previousInteractiveSessionId)) {
        $env:POWERBI_INTERACTIVE_SESSION_ID = $previousInteractiveSessionId
    }
    if ($EnableModelingMcp) {
        Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
        if (-not [string]::IsNullOrWhiteSpace($previousConfig)) { $env:OPENCODE_CONFIG = $previousConfig }
    }
    if ($null -ne $generatedConfig -and (Test-Path -LiteralPath $generatedConfig)) {
        Remove-Item -LiteralPath $generatedConfig -Force -ErrorAction SilentlyContinue
    }
}
