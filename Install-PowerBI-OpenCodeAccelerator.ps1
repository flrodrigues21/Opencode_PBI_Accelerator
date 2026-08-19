<#
.SYNOPSIS
Instala um acelerador local compartilhado para OpenCode + Power BI PBIP.

.DESCRIPTION
Instala UMA VEZ no servidor:
- Microsoft skills-for-fabric (somente o plugin powerbi-authoring)
- Power BI Report Authoring CLI
- Power BI Desktop Bridge CLI
- Scripts de atalho para preparar/abrir qualquer projeto PBIP no OpenCode

Nao configura Power BI Service, Fabric, publicacao, tenant, OAuth, App Registration
ou Power BI Remote MCP. O objetivo e trabalhar localmente/offline com PBIP/PBIR.

A cada projeto, use:
  C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1 -ProjectPath .

O script cria dentro do projeto:
- .opencode\skills  -> junction para as skills compartilhadas
- .opencode\common  -> junction para os arquivos comuns
- AGENTS.md          -> regras locais do projeto
- Abrir-PowerBI-OpenCode.ps1
- Abrir-PowerBI-OpenCode.cmd  -> atalho clicavel

.PARAMETER InstallRoot
Pasta comum no servidor onde ficarao skills, CLIs npm e scripts.
Padrao: C:\OpenCode\PowerBI-Accelerator

.PARAMETER Force
Restaura a versao homologada do repositorio Microsoft e recria arquivos de atalho/regra.

.PARAMETER SkipNpmInstall
Pula a instalacao local das CLIs Power BI, util para testes.

.EXAMPLE
Set-ExecutionPolicy -Scope Process Bypass
.\Install-PowerBI-OpenCodeAccelerator.ps1

.EXAMPLE
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\Ferramentas\PowerBI-Accelerator" -Force

.NOTES
Pre-requisitos:
- Git
- Node.js 20 ou superior
- OpenCode
- Power BI Desktop (para bridge/screenshot/reload)

As CLIs sao instaladas LOCALMENTE em:
  <InstallRoot>\node\node_modules\.bin
Nenhuma instalacao npm global e feita.
#>

[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\OpenCode\PowerBI-Accelerator",
    [switch]$Force,
    [switch]$SkipNpmInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$RepoUrl = "https://github.com/microsoft/skills-for-fabric.git"
$PinnedCommit = "ac156d284ab8e51f121af3f42303ea79c88cdab5"
$RepoRoot = Join-Path $InstallRoot "vendor\skills-for-fabric"
$PluginSourceRelative = "plugins\powerbi-authoring"
$SharedSkillsRoot = Join-Path $InstallRoot "skills"
$SharedCommonRoot = Join-Path $InstallRoot "common"
$NodeLocalRoot = Join-Path $InstallRoot "node"
$BinRoot = Join-Path $InstallRoot "bin"
$TemplateRoot = Join-Path $InstallRoot "templates"

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-WarnMsg([string]$Text) { Write-Host "    AVISO  $Text" -ForegroundColor Yellow }

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Assert-Command([string]$Name, [string]$Hint) {
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando '$Name' nao encontrado. $Hint"
    }
    $version = try { (& $Name --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { "" }
    Write-Ok "$Name encontrado $version"
}

function Assert-Node20 {
    Assert-Command "node" "Instale Node.js LTS 20+. Em servidor sem winget, use o instalador MSI oficial."
    $v = (& node --version).Trim()
    if ($v -notmatch '^v(\d+)\.') { throw "Versao de Node invalida: $v" }
    if ([int]$Matches[1] -lt 20) { throw "E necessario Node.js 20+. Detectado: $v" }
    Assert-Command "npm" "npm deve vir com o Node.js LTS."
}

function Write-FileUtf8NoBom([string]$Path, [string]$Content, [switch]$Overwrite) {
    Ensure-Dir (Split-Path -Parent $Path)
    if ((Test-Path -LiteralPath $Path) -and -not $Overwrite) {
        Write-WarnMsg "Preservado: $Path"
        return
    }
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
    Write-Ok "Criado/atualizado: $Path"
}

# ---------------------------------------------------------------------------
# Validacao e estrutura central
# ---------------------------------------------------------------------------
Write-Step "Validando pre-requisitos"
Assert-Command "git" "Instale Git for Windows."
Assert-Node20
Assert-Command "opencode" "Instale/configure o OpenCode antes de continuar."

Write-Step "Criando estrutura compartilhada"
Ensure-Dir $InstallRoot
Ensure-Dir $SharedSkillsRoot
Ensure-Dir $SharedCommonRoot
Ensure-Dir $NodeLocalRoot
Ensure-Dir $BinRoot
Ensure-Dir $TemplateRoot

# ---------------------------------------------------------------------------
# Clone/atualizacao do repositorio Microsoft (versao homologada)
# ---------------------------------------------------------------------------
Write-Step "Obtendo Microsoft skills-for-fabric (commit $PinnedCommit)"
Ensure-Dir (Split-Path -Parent $RepoRoot)

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
    if (Test-Path -LiteralPath $RepoRoot) {
        $backup = "$RepoRoot.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $RepoRoot -Destination $backup
        Write-WarnMsg "Pasta anterior preservada em: $backup"
    }

    & git clone $RepoUrl $RepoRoot
    if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar $RepoUrl" }

    Push-Location $RepoRoot
    try {
        & git checkout $PinnedCommit
        if ($LASTEXITCODE -ne 0) { throw "Falha ao fazer checkout do commit $PinnedCommit" }
    }
    finally { Pop-Location }

    $currentHead = (& git -C $RepoRoot rev-parse HEAD).Trim()
    if ($currentHead -ne $PinnedCommit) {
        throw "Commit invalido apos checkout. Esperado: $PinnedCommit, Obtido: $currentHead"
    }
    Write-Ok "Repositorio oficial clonado e fixado no commit $PinnedCommit."
}
elseif ($Force) {
    Push-Location $RepoRoot
    try {
        & git fetch --depth 1 origin $PinnedCommit
        if ($LASTEXITCODE -ne 0) { throw "Falha no git fetch." }
        & git checkout $PinnedCommit
        if ($LASTEXITCODE -ne 0) { throw "Falha ao fazer checkout do commit $PinnedCommit" }
    }
    finally { Pop-Location }

    $currentHead = (& git -C $RepoRoot rev-parse HEAD).Trim()
    if ($currentHead -ne $PinnedCommit) {
        throw "Commit invalido apos checkout. Esperado: $PinnedCommit, Obtido: $currentHead"
    }
    Write-Ok "Repositorio oficial restaurado para o commit $PinnedCommit."
}
else {
    $currentHead = (& git -C $RepoRoot rev-parse HEAD).Trim()
    if ($currentHead -ne $PinnedCommit) {
        throw "Versao do repositorio nao corresponde a homologada. HEAD: $currentHead, Esperado: $PinnedCommit. Execute novamente com -Force para restaurar."
    }
    Write-Ok "Clone oficial ja existe e corresponde ao commit homologado ($PinnedCommit)."
}

$pluginRoot = Join-Path $RepoRoot $PluginSourceRelative
$skillsSource = Join-Path $pluginRoot "skills"
if (-not (Test-Path -LiteralPath $skillsSource)) {
    throw "Estrutura esperada nao encontrada: $skillsSource"
}

# ---------------------------------------------------------------------------
# Skills compartilhadas (somente gerenciadas pelo acelerador)
# ---------------------------------------------------------------------------
Write-Step "Atualizando skills compartilhadas"
$managedSkills = Get-ChildItem -LiteralPath $skillsSource -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") } |
    Select-Object -ExpandProperty Name

Get-ChildItem -LiteralPath $SharedSkillsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $managedSkills -contains $_.Name } |
    Remove-Item -Recurse -Force

$skillFolders = Get-ChildItem -LiteralPath $skillsSource -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") }

if (-not $skillFolders) {
    throw "Nenhuma SKILL.md encontrada em: $skillsSource"
}

foreach ($folder in $skillFolders) {
    Copy-Item -LiteralPath $folder.FullName -Destination (Join-Path $SharedSkillsRoot $folder.Name) -Recurse -Force
    Write-Ok "Skill compartilhada: $($folder.Name)"
}

# ---------------------------------------------------------------------------
# Diretorio common (referenciado pelas skills via ../../common/)
# ---------------------------------------------------------------------------
Write-Step "Atualizando diretorio common"
$commonSource = Join-Path $pluginRoot "common"
if (-not (Test-Path -LiteralPath $commonSource)) {
    Write-WarnMsg "Diretorio common nao encontrado em: $commonSource - ignorando."
}
else {
    $managedCommon = @("COMMON-CORE.md", "COMMON-CLI.md", "ITEM-DEFINITIONS-CORE.md")
    Get-ChildItem -LiteralPath $SharedCommonRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $managedCommon -contains $_.Name } |
        Remove-Item -Force

    Copy-Item -LiteralPath (Join-Path $commonSource "*") -Destination $SharedCommonRoot -Recurse -Force
    Write-Ok "Diretorio common atualizado em: $SharedCommonRoot"
}

# ---------------------------------------------------------------------------
# Plugin powerbi-authoring completo (idempotente)
# ---------------------------------------------------------------------------
Write-Step "Mantendo plugin completo para consulta"
$vendorPlugin = Join-Path $InstallRoot "vendor\powerbi-authoring"
if (Test-Path -LiteralPath $vendorPlugin) {
    Remove-Item -LiteralPath $vendorPlugin -Recurse -Force
    Write-Ok "Diretorio vendor anterior removido para evitar aninhamento."
}
Copy-Item -LiteralPath $pluginRoot -Destination $vendorPlugin -Recurse -Force
Write-Ok "Plugin completo mantido em: $vendorPlugin"

# ---------------------------------------------------------------------------
# Node local: evita npm -g e privilegios de administrador
# ---------------------------------------------------------------------------
if (-not $SkipNpmInstall) {
    Write-Step "Instalando CLIs Power BI localmente no acelerador"
    & npm install --prefix $NodeLocalRoot `
        @microsoft/powerbi-report-authoring-cli@0.1.1 `
        @microsoft/powerbi-desktop-bridge-cli@0.1.1
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao instalar as CLIs Power BI localmente via npm."
    }
    Write-Ok "CLIs instaladas em: $NodeLocalRoot"
}
else {
    Write-WarnMsg "Instalacao npm ignorada por -SkipNpmInstall."
}

# ---------------------------------------------------------------------------
# Templates de projeto
# ---------------------------------------------------------------------------
$agentsTemplate = @'
# Power BI PBIP - regras do projeto

Este projeto usa um acelerador local de OpenCode + Power BI.
As skills sao vinculadas de `.opencode/skills` para um diretorio compartilhado no servidor.

## Escopo local e seguranca
- Trabalhar somente com os arquivos locais PBIP/PBIR/TMDL deste projeto.
- Nao configurar, consultar ou publicar no Power BI Service/Fabric.
- Nao usar Power BI Remote MCP, OAuth, tenant, workspace ou semantic model remoto.
- Nao pedir nem armazenar credenciais de cliente neste projeto.
- Nao alterar fontes de dados, parametros ou credenciais sem instrucao explicita.

## Fluxo obrigatorio
1. Para entender a necessidade: usar skill de planejamento.
2. Para UX e layout: usar skill de design.
3. Antes de editar arquivos PBIR: explicar o plano e aguardar aprovacao, salvo pedido explicito de implementacao imediata.
4. Antes de criar bindings: inspecionar os arquivos TMDL/PBIR existentes. Nunca inventar tabela, coluna ou medida.
5. Apos cada lote logico de mudancas:
   `powerbi-report-author validate <pasta-do-arquivo-.Report>`
6. Para validar o resultado visual, quando Power BI Desktop estiver aberto:
   - `powerbi-desktop status`
   - `powerbi-desktop reload`
   - `powerbi-desktop screenshot`
7. Nao atualizar manualmente `$schema`.
8. Nao alterar RLS, incremental refresh, relacionamentos ou medidas criticas sem explicar impacto e rollback.

## Qualidade
- Confirmar granularidade, filtros e contexto DAX.
- Preferir dimensoes e tabela calendario ja existentes.
- Evitar relacionamentos bidirecionais sem justificativa.
- Registrar decisoes e analises em `docs/`.
'@
Write-FileUtf8NoBom (Join-Path $TemplateRoot "AGENTS.md") $agentsTemplate -Overwrite:$true

$shortcutPs1Template = @'
[CmdletBinding()]
param(
    [switch]$InitializeOnly,
    [switch]$OpenDesktop,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$accelerator = "__ACCELERATOR_ROOT__"
$starter = Join-Path $accelerator "bin\Start-PowerBI-OpenCode.ps1"

if (-not (Test-Path -LiteralPath $starter)) {
    throw "Acelerador nao encontrado em: $starter"
}

& $starter -ProjectPath $PSScriptRoot -InitializeOnly:$InitializeOnly -OpenDesktop:$OpenDesktop -Force:$Force
'@

$projectStarter = @'
[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [switch]$InitializeOnly,
    [switch]$OpenDesktop,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AcceleratorRoot = Split-Path -Parent $PSScriptRoot
$SharedSkillsRoot = Join-Path $AcceleratorRoot "skills"
$SharedCommonRoot = Join-Path $AcceleratorRoot "common"
$LocalBin = Join-Path $AcceleratorRoot "node\node_modules\.bin"
$TemplateRoot = Join-Path $AcceleratorRoot "templates"

$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
if (-not (Test-Path -LiteralPath $ProjectPath)) {
    throw "Pasta do projeto nao encontrada: $ProjectPath"
}

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-WarnMsg([string]$Text) { Write-Host "    AVISO  $Text" -ForegroundColor Yellow }
function Ensure-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
}
function Is-Junction([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}
function Write-FileUtf8NoBom([string]$Path, [string]$Content, [switch]$Overwrite) {
    if ((Test-Path -LiteralPath $Path) -and -not $Overwrite) {
        Write-WarnMsg "Preservado: $Path"
        return
    }
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
    Write-Ok "Criado/atualizado: $Path"
}

Write-Step "Preparando projeto Power BI local"
if (-not (Test-Path -LiteralPath $SharedSkillsRoot)) {
    throw "Skills compartilhadas nao encontradas: $SharedSkillsRoot"
}
if (-not (Test-Path -LiteralPath $LocalBin)) {
    throw "CLIs locais nao encontradas: $LocalBin. Reexecute o instalador central."
}

$pbip = Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pbip) {
    Write-Ok "PBIP encontrado: $($pbip.Name)"
}
else {
    Write-WarnMsg "Nenhum .pbip encontrado. A estrutura sera preparada mesmo assim."
}

$env:PATH = "$LocalBin;$env:PATH"
$env:POWERBI_OPENCODE_ACCELERATOR = $AcceleratorRoot

$opencodeRoot = Join-Path $ProjectPath ".opencode"
$projectSkills = Join-Path $opencodeRoot "skills"
$projectCommon = Join-Path $opencodeRoot "common"
Ensure-Dir $opencodeRoot

# Junction de skills
if (Test-Path -LiteralPath $projectSkills) {
    if (Is-Junction $projectSkills) {
        Remove-Item -LiteralPath $projectSkills -Force
        Write-Ok "Junction anterior de skills removida."
    }
    elseif ($Force) {
        $backup = "$projectSkills.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $projectSkills -Destination $backup
        Write-WarnMsg "Skills locais preservadas em: $backup"
    }
    else {
        throw @"
Ja existe '$projectSkills' e ela nao e uma junction.
Para preservar seguranca, o script nao a substituiu.
Use -Force para move-la para backup e criar o vinculo compartilhado.
"@
    }
}
New-Item -ItemType Junction -Path $projectSkills -Target $SharedSkillsRoot | Out-Null
Write-Ok "Skills vinculadas ao acelerador compartilhado."

# Junction de common
if (Test-Path -LiteralPath $projectCommon) {
    if (Is-Junction $projectCommon) {
        Remove-Item -LiteralPath $projectCommon -Force
        Write-Ok "Junction anterior de common removida."
    }
    elseif ($Force) {
        $backup = "$projectCommon.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $projectCommon -Destination $backup
        Write-WarnMsg "Common local preservado em: $backup"
    }
    else {
        throw "Ja existe '$projectCommon' e nao e uma junction. Use -Force para substituir."
    }
}
if (Test-Path -LiteralPath $SharedCommonRoot) {
    New-Item -ItemType Junction -Path $projectCommon -Target $SharedCommonRoot | Out-Null
    Write-Ok "Common vinculado ao acelerador compartilhado."
}
else {
    Write-WarnMsg "Diretorio common nao encontrado. Referencias em skills podem falhar."
}

$agentsTarget = Join-Path $ProjectPath "AGENTS.md"
$agentsSource = Join-Path $TemplateRoot "AGENTS.md"
if (-not (Test-Path -LiteralPath $agentsTarget) -or $Force) {
    Copy-Item -LiteralPath $agentsSource -Destination $agentsTarget -Force
    Write-Ok "AGENTS.md preparado."
}
else {
    Write-WarnMsg "AGENTS.md existente preservado."
}

$docs = Join-Path $ProjectPath "docs"
$prompts = Join-Path $ProjectPath "prompts"
Ensure-Dir $docs
Ensure-Dir $prompts

$diagnosticPrompt = @'
Analise este projeto Power BI PBIP sem alterar arquivos.

Trabalhe somente com os arquivos locais. Nao use Power BI Service, Fabric, MCP remoto,
OAuth ou publicacao.

Use as skills de planejamento, design e autoria quando aplicavel.

Entregue:
1. Paginas e visuais existentes.
2. Tabelas, medidas e colunas usadas.
3. Filtros de relatorio, pagina e visual.
4. Riscos de DAX, granularidade, relacionamentos e performance.
5. Problemas de UX e melhorias possiveis.
6. Priorizacao de alto, medio e baixo impacto.

Nao implemente nada ainda.
'@
Write-FileUtf8NoBom (Join-Path $prompts "01-diagnostico-local.md") $diagnosticPrompt -Overwrite:$Force

$shortcutPs1 = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.ps1"
$shortcutPs1Content = (Get-Content -LiteralPath (Join-Path $TemplateRoot "Abrir-PowerBI-OpenCode.ps1.template") -Raw)
Write-FileUtf8NoBom $shortcutPs1 $shortcutPs1Content -Overwrite:$Force

$shortcutCmd = Join-Path $ProjectPath "Abrir-PowerBI-OpenCode.cmd"
$shortcutCmdContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Abrir-PowerBI-OpenCode.ps1" %*
"@
Write-FileUtf8NoBom $shortcutCmd $shortcutCmdContent -Overwrite:$Force

$gitIgnore = Join-Path $ProjectPath ".gitignore"
$ignoreEntries = @(
    "# Gerado localmente pelo acelerador Power BI/OpenCode",
    "screenshots/",
    ""
) -join [Environment]::NewLine
if (-not (Test-Path -LiteralPath $gitIgnore)) {
    Write-FileUtf8NoBom $gitIgnore $ignoreEntries -Overwrite:$false
}
else {
    $current = Get-Content -LiteralPath $gitIgnore -Raw
    if ($current -notmatch [regex]::Escape("screenshots/")) {
        Add-Content -LiteralPath $gitIgnore -Value ("`r`n" + $ignoreEntries) -Encoding UTF8
        Write-Ok ".gitignore atualizado."
    }
}

if ($OpenDesktop -and $pbip) {
    Write-Step "Abrindo projeto no Power BI Desktop"
    Start-Process -FilePath $pbip.FullName
}

Write-Step "Pronto"
Write-Host "Projeto: $ProjectPath"
Write-Host "Skills:  $projectSkills"
Write-Host "Common:  $projectCommon"
Write-Host "Atalho:  $shortcutCmd"
Write-Host ""
Write-Host "Modo local: sem Power BI Service, Fabric, OAuth ou Power BI Remote MCP." -ForegroundColor Green
Write-Host "CLIs disponiveis somente nesta sessao: powerbi-report-author e powerbi-desktop"

if ($InitializeOnly) {
    Write-Host "`nInicializacao concluida. Para abrir depois, execute:"
    Write-Host "  .\Abrir-PowerBI-OpenCode.ps1"
    exit 0
}

Set-Location $ProjectPath
& opencode
'@

Write-FileUtf8NoBom (Join-Path $BinRoot "Start-PowerBI-OpenCode.ps1") $projectStarter -Overwrite:$true

$cmdStarter = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-PowerBI-OpenCode.ps1" -ProjectPath "%CD%" %*
'@
Write-FileUtf8NoBom (Join-Path $BinRoot "pbi-ai.cmd") $cmdStarter -Overwrite:$true

# Template tem caminho resolvido no momento da instalacao.
$shortcutPs1Resolved = $shortcutPs1Template.Replace("__ACCELERATOR_ROOT__", $InstallRoot.Replace("'", "''"))
Write-FileUtf8NoBom (Join-Path $TemplateRoot "Abrir-PowerBI-OpenCode.ps1.template") $shortcutPs1Resolved -Overwrite:$true

# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------
Write-Step "Instalacao concluida"
Write-Host "Acelerador: $InstallRoot" -ForegroundColor Green
Write-Host "Commit Microsoft fixado: $PinnedCommit" -ForegroundColor Green
Write-Host "Starter:    $BinRoot\Start-PowerBI-OpenCode.ps1"
Write-Host ""
Write-Host "Para preparar um projeto PBIP:" -ForegroundColor Cyan
Write-Host "  cd C:\caminho\do\projeto"
Write-Host "  & `"$BinRoot\Start-PowerBI-OpenCode.ps1`" -ProjectPath ."
Write-Host ""
Write-Host "Apos a primeira vez, use o atalho criado no proprio projeto:"
Write-Host "  Abrir-PowerBI-OpenCode.cmd"
