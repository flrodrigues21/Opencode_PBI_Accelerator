#requires -Version 5.1
<#
.SYNOPSIS
Instala o acelerador LOCAL de Power BI + OpenCode uma vez no Windows Server.

.DESCRIPTION
Sem Power BI Service, Fabric, OAuth, MCP remoto ou publicacao.
O uso diario acontece dentro de cada pasta PBIP por um atalho .cmd.

Uso:
  powershell -ExecutionPolicy Bypass -File .\Install-PowerBI-OpenCodeAccelerator-v2.ps1
#>

[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\OpenCode\PowerBI-Accelerator",
    [switch]$Update,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$RepoRoot = Join-Path $InstallRoot "vendor\skills-for-fabric"
$SkillsRoot = Join-Path $InstallRoot "skills"
$BinRoot = Join-Path $InstallRoot "bin"
$NodeRoot = Join-Path $InstallRoot "node"
$TemplatesRoot = Join-Path $InstallRoot "templates"

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function WarnMsg([string]$Text) { Write-Host "    AVISO  $Text" -ForegroundColor Yellow }

function EnsureDir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function RequireCommand([string]$Name, [string]$Hint) {
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando '$Name' nao encontrado. $Hint"
    }
    Ok "$Name encontrado"
}

function WriteUtf8([string]$Path, [string]$Content) {
    EnsureDir (Split-Path -Parent $Path)
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
    Ok "Arquivo criado: $Path"
}

Step "Validando pre-requisitos"
RequireCommand "git" "Instale Git for Windows."
RequireCommand "node" "Instale Node.js LTS 20 ou superior."
RequireCommand "npm" "Reinstale Node.js LTS."
RequireCommand "opencode" "Instale/configure o OpenCode."

$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.') { throw "Nao consegui ler a versao do Node: $nodeVersion" }
if ([int]$Matches[1] -lt 20) { throw "Node 20+ exigido. Detectado: $nodeVersion" }
Ok "Node compativel: $nodeVersion"

Step "Criando estrutura central"
EnsureDir $InstallRoot
EnsureDir $SkillsRoot
EnsureDir $BinRoot
EnsureDir $NodeRoot
EnsureDir $TemplatesRoot
EnsureDir (Split-Path -Parent $RepoRoot)

Step "Baixando skills oficiais Microsoft"
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
    if (Test-Path -LiteralPath $RepoRoot) {
        $old = "$RepoRoot.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $RepoRoot -Destination $old
        WarnMsg "Pasta anterior preservada: $old"
    }
    & git clone --depth 1 https://github.com/microsoft/skills-for-fabric.git $RepoRoot
    if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar skills-for-fabric." }
    Ok "Repositorio clonado."
}
elseif ($Update) {
    Push-Location $RepoRoot
    try {
        & git pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar repositorio." }
    }
    finally { Pop-Location }
    Ok "Repositorio atualizado."
}
else {
    Ok "Repositorio ja existe. Use -Update para atualizar."
}

$SourceSkills = Join-Path $RepoRoot "plugins\powerbi-authoring\skills"
if (-not (Test-Path -LiteralPath $SourceSkills)) {
    throw "Nao encontrei: $SourceSkills"
}

Step "Copiando skills Power BI para o acelerador"
Get-ChildItem -LiteralPath $SkillsRoot -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$skills = Get-ChildItem -LiteralPath $SourceSkills -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md")
}
if (-not $skills) { throw "Nenhuma skill encontrada." }

foreach ($skill in $skills) {
    Copy-Item -LiteralPath $skill.FullName -Destination (Join-Path $SkillsRoot $skill.Name) -Recurse -Force
    Ok "Skill instalada: $($skill.Name)"
}

if (-not $SkipNpmInstall) {
    Step "Instalando CLIs localmente (sem npm global)"
    & npm install --prefix $NodeRoot @microsoft/powerbi-report-authoring-cli @microsoft/powerbi-desktop-bridge-cli
    if ($LASTEXITCODE -ne 0) { throw "Falha no npm install." }
    Ok "CLIs instaladas em $NodeRoot"
}
else {
    WarnMsg "CLIs npm ignoradas."
}

$agents = @'
# Power BI PBIP + OpenCode (modo local)

## Escopo
- Trabalhe exclusivamente nos arquivos locais PBIP, PBIR e TMDL deste projeto.
- Nao use Power BI Service, Fabric, OAuth, Power BI Remote MCP ou publicacao.
- Nao solicite, grave ou utilize credenciais do cliente.

## Regras
1. Use as skills disponiveis em .opencode/skills.
2. Antes de editar PBIR, explique um plano e aguarde aprovacao, exceto se a implementacao imediata for solicitada.
3. Inspecione os arquivos locais antes de criar bindings. Nunca invente tabelas, colunas, medidas ou propriedades PBIR.
4. Depois de cada lote de mudancas, valide com powerbi-report-author.
5. Quando o Power BI Desktop estiver aberto, use powerbi-desktop para reload e screenshot.
6. Nao altere RLS, fontes de dados, parametros, relacionamentos ou medidas criticas sem explicar impacto e rollback.
7. Nao atualize manualmente a versao $schema.
'@
WriteUtf8 (Join-Path $TemplatesRoot "AGENTS.md") $agents

$starter = @'
[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [switch]$InitializeOnly,
    [switch]$OpenDesktop,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$AcceleratorRoot = "__ACCELERATOR_ROOT__"
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
'@
$starter = $starter.Replace("__ACCELERATOR_ROOT__", $InstallRoot.Replace("'", "''"))
WriteUtf8 (Join-Path $BinRoot "Start-PowerBI-OpenCode.ps1") $starter

$centralCmd = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0Start-PowerBI-OpenCode.ps1`" -ProjectPath `"%CD%`" %*"
WriteUtf8 (Join-Path $BinRoot "pbi-ai.cmd") $centralCmd

$readme = @"
# Power BI + OpenCode Accelerator (local)

Pasta central: $InstallRoot

## Uso
Entre na pasta de qualquer projeto PBIP e execute:

    & "$BinRoot\Start-PowerBI-OpenCode.ps1" -ProjectPath .

Na primeira vez, o projeto ganha:
- .opencode\skills (junction para as skills centrais)
- AGENTS.md
- Abrir-PowerBI-OpenCode.ps1
- Abrir-PowerBI-OpenCode.cmd

Depois, basta dar duplo clique em Abrir-PowerBI-OpenCode.cmd.

## Escopo
Este acelerador nao usa Power BI Service, Fabric, OAuth, Power BI Remote MCP nem publicacao.
"@
WriteUtf8 (Join-Path $InstallRoot "README.md") $readme

Step "Concluido"
Write-Host "Acelerador instalado em: $InstallRoot" -ForegroundColor Green
Write-Host "Para iniciar em um projeto:"
Write-Host "  & `"$BinRoot\Start-PowerBI-OpenCode.ps1`" -ProjectPath ."
