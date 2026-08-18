[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [switch]$InitializeOnly,
    [switch]$OpenDesktop,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$AcceleratorRoot = Split-Path -Parent $PSScriptRoot
$SharedSkills = Join-Path $AcceleratorRoot "skills"
$LocalBin = Join-Path $AcceleratorRoot "node\node_modules\.bin"
$TemplateAgents = Join-Path $AcceleratorRoot "templates\AGENTS.md"

$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
if (-not (Test-Path -LiteralPath $ProjectPath)) { throw "Projeto nao encontrado: $ProjectPath" }
if (-not (Test-Path -LiteralPath $SharedSkills)) { throw "Skills nao encontradas: $SharedSkills" }
if (-not (Test-Path -LiteralPath $LocalBin)) { throw "CLIs nao encontradas: $LocalBin. Rode o instalador sem -SkipNpmInstall." }

$env:PATH = "$LocalBin;$env:PATH"
$opencodeDir = Join-Path $ProjectPath ".opencode"
$projectSkills = Join-Path $opencodeDir "skills"
if (-not (Test-Path -LiteralPath $opencodeDir)) { New-Item -ItemType Directory -Path $opencodeDir -Force | Out-Null }

if (Test-Path -LiteralPath $projectSkills) {
    $item = Get-Item -LiteralPath $projectSkills -Force
    $isLink = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    if ($isLink) {
        Remove-Item -LiteralPath $projectSkills -Force
    }
    elseif ($Force) {
        $backup = "$projectSkills.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $projectSkills -Destination $backup
        Write-Host "Skills locais preservadas em: $backup" -ForegroundColor Yellow
    }
    else {
        throw "Ja existe $projectSkills e nao e um atalho/junction. Rode com -Force para preservar em backup e recriar."
    }
}

New-Item -ItemType Junction -Path $projectSkills -Target $SharedSkills | Out-Null
Write-Host "Skills vinculadas ao acelerador." -ForegroundColor Green

$agentsTarget = Join-Path $ProjectPath "AGENTS.md"
if ((-not (Test-Path -LiteralPath $agentsTarget)) -or $Force) {
    Copy-Item -LiteralPath $TemplateAgents -Destination $agentsTarget -Force
}

$promptsDir = Join-Path $ProjectPath "prompts"
if (-not (Test-Path -LiteralPath $promptsDir)) { New-Item -ItemType Directory -Path $promptsDir -Force | Out-Null }

$promptPath = Join-Path $promptsDir "01-diagnostico-local.md"
if ((-not (Test-Path -LiteralPath $promptPath)) -or $Force) {
    $prompt = "Analise este projeto PBIP sem alterar arquivos.`r`n`r`nTrabalhe somente localmente. Nao use Power BI Service, Fabric, OAuth, MCP remoto ou publicacao.`r`n`r`nEntregue paginas, visuais, medidas, filtros, riscos de DAX/granularidade, relacoes, performance e melhorias priorizadas.`r`n`r`nNao implemente nada ainda."
    [IO.File]::WriteAllText($promptPath, $prompt, (New-Object Text.UTF8Encoding($false)))
}

$projectPs = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.ps1"
$projectCmd = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.cmd"
$psContent = "& '$AcceleratorRoot\bin\Start-PowerBI-OpenCode.ps1' -ProjectPath `$PSScriptRoot"
$cmdContent = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0Abrir-PowerBI-OpenCode.ps1`""
[IO.File]::WriteAllText($projectPs, $psContent, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($projectCmd, $cmdContent, (New-Object Text.UTF8Encoding($false)))

$pbip = Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($OpenDesktop -and $pbip) { Start-Process $pbip.FullName }

if ($InitializeOnly) {
    Write-Host "Projeto preparado. Use Abrir-PowerBI-OpenCode.cmd daqui para frente." -ForegroundColor Green
    exit 0
}

Set-Location $ProjectPath
& opencode
