<#
.SYNOPSIS
Instala um acelerador local compartilhado para OpenCode + Power BI PBIP.

.DESCRIPTION
Instala UMA VEZ no servidor:
- Microsoft skills-for-fabric (somente o plugin powerbi-authoring)
- Power BI Report Authoring CLI
- Power BI Desktop Bridge CLI
- Scripts de atalho para preparar/abrir qualquer projeto PBIP no OpenCode

N??o configura Power BI Service, Fabric, publica????o, tenant, OAuth, App Registration
ou Power BI Remote MCP. O objetivo ?? trabalhar localmente/offline com PBIP/PBIR.

A cada projeto, use:
  C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1 -ProjectPath .

O script cria dentro do projeto:
- .opencode\skills  -> junction para as skills compartilhadas
- AGENTS.md          -> regras locais do projeto
- Abrir-PowerBI-OpenCode.ps1
- Abrir-PowerBI-OpenCode.cmd  -> atalho clic??vel

.PARAMETER InstallRoot
Pasta comum no servidor onde ficar??o skills, CLIs npm e scripts.
Padr??o: C:\OpenCode\PowerBI-Accelerator

.PARAMETER Force
Atualiza o clone Git e restaura arquivos de atalho/regra quando necess??rio.

.PARAMETER SkipNpmInstall
Pula a instala????o local das CLIs Power BI, ??til para testes.

.EXAMPLE
Set-ExecutionPolicy -Scope Process Bypass
.\Install-PowerBI-OpenCodeAccelerator.ps1

.EXAMPLE
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\Ferramentas\PowerBI-Accelerator" -Force

.NOTES
Pr??-requisitos:
- Git
- Node.js 20 ou superior
- OpenCode
- Power BI Desktop (para bridge/screenshot/reload)

As CLIs s??o instaladas LOCALMENTE em:
  <InstallRoot>\node\node_modules\.bin
Nenhuma instala????o npm global ?? feita.
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
$RepoRoot = Join-Path $InstallRoot "vendor\skills-for-fabric"
$PluginSourceRelative = "plugins\powerbi-authoring"
$SharedSkillsRoot = Join-Path $InstallRoot "skills"
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
        throw "Comando '$Name' n??o encontrado. $Hint"
    }
    $version = try { (& $Name --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { "" }
    Write-Ok "$Name encontrado $version"
}

function Assert-Node20 {
    Assert-Command "node" "Instale Node.js LTS 20+. Em servidor sem winget, use o instalador MSI oficial."
    $v = (& node --version).Trim()
    if ($v -notmatch '^v(\d+)\.') { throw "Vers??o de Node inv??lida: $v" }
    if ([int]$Matches[1] -lt 20) { throw "?? necess??rio Node.js 20+. Detectado: $v" }
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
# Valida????o e estrutura central
# ---------------------------------------------------------------------------
Write-Step "Validando pr??-requisitos"
Assert-Command "git" "Instale Git for Windows."
Assert-Node20
Assert-Command "opencode" "Instale/configure o OpenCode antes de continuar."

Write-Step "Criando estrutura compartilhada"
Ensure-Dir $InstallRoot
Ensure-Dir $SharedSkillsRoot
Ensure-Dir $NodeLocalRoot
Ensure-Dir $BinRoot
Ensure-Dir $TemplateRoot

# ---------------------------------------------------------------------------
# Clone/atualiza????o do repositorio Microsoft
# ---------------------------------------------------------------------------
Write-Step "Obtendo Microsoft skills-for-fabric"
Ensure-Dir (Split-Path -Parent $RepoRoot)

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
    if (Test-Path -LiteralPath $RepoRoot) {
        $backup = "$RepoRoot.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $RepoRoot -Destination $backup
        Write-WarnMsg "Pasta anterior preservada em: $backup"
    }

    & git clone --depth 1 $RepoUrl $RepoRoot
    if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar $RepoUrl" }
    Write-Ok "Reposit??rio oficial clonado."
}
elseif ($Force) {
    Push-Location $RepoRoot
    try {
        & git fetch --depth 1 origin main
        if ($LASTEXITCODE -ne 0) { throw "Falha no git fetch." }
        & git reset --hard origin/main
        if ($LASTEXITCODE -ne 0) { throw "Falha no git reset." }
        Write-Ok "Reposit??rio oficial atualizado."
    }
    finally { Pop-Location }
}
else {
    Write-Ok "Clone oficial j?? existe. Use -Force para atualizar."
}

$pluginRoot = Join-Path $RepoRoot $PluginSourceRelative
$skillsSource = Join-Path $pluginRoot "skills"
if (-not (Test-Path -LiteralPath $skillsSource)) {
    throw "Estrutura esperada n??o encontrada: $skillsSource"
}

# ---------------------------------------------------------------------------
# Skills compartilhadas
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

Copy-Item -LiteralPath $pluginRoot -Destination (Join-Path $InstallRoot "vendor\powerbi-authoring") -Recurse -Force
Write-Ok "Plugin completo mantido em vendor para consulta."

# ---------------------------------------------------------------------------
# Node local: evita npm -g e privil??gios de administrador
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
    Write-WarnMsg "Instala????o npm ignorada por -SkipNpmInstall."
}

# ---------------------------------------------------------------------------
# Templates de projeto
# ---------------------------------------------------------------------------
$agentsTemplate = @'
# Power BI PBIP ??? regras do projeto

Este projeto usa um acelerador local de OpenCode + Power BI.
As skills s??o vinculadas de `.opencode/skills` para um diret??rio compartilhado no servidor.

## Escopo local e seguran??a
- Trabalhar somente com os arquivos locais PBIP/PBIR/TMDL deste projeto.
- N??o configurar, consultar ou publicar no Power BI Service/Fabric.
- N??o usar Power BI Remote MCP, OAuth, tenant, workspace ou semantic model remoto.
- N??o pedir nem armazenar credenciais de cliente neste projeto.
- N??o alterar fontes de dados, par??metros ou credenciais sem instru????o expl??cita.

## Fluxo obrigat??rio
1. Para entender a necessidade: usar skill de planejamento.
2. Para UX e layout: usar skill de design.
3. Antes de editar arquivos PBIR: explicar o plano e aguardar aprova????o, salvo pedido expl??cito de implementa????o imediata.
4. Antes de criar bindings: inspecionar os arquivos TMDL/PBIR existentes. Nunca inventar tabela, coluna ou medida.
5. Ap??s cada lote l??gico de mudan??as:
   `powerbi-report-author validate <pasta-do-arquivo-.Report>`
6. Para validar o resultado visual, quando Power BI Desktop estiver aberto:
   - `powerbi-desktop status`
   - `powerbi-desktop reload`
   - `powerbi-desktop screenshot`
7. N??o atualizar manualmente `$schema`.
8. N??o alterar RLS, incremental refresh, relacionamentos ou medidas cr??ticas sem explicar impacto e rollback.

## Qualidade
- Confirmar granularidade, filtros e contexto DAX.
- Preferir dimens??es e tabela calend??rio j?? existentes.
- Evitar relacionamentos bidirecionais sem justificativa.
- Registrar decis??es e an??lises em `docs/`.
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
    throw "Acelerador n??o encontrado em: $starter"
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
$LocalBin = Join-Path $AcceleratorRoot "node\node_modules\.bin"
$TemplateRoot = Join-Path $AcceleratorRoot "templates"

$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
if (-not (Test-Path -LiteralPath $ProjectPath)) {
    throw "Pasta do projeto n??o encontrada: $ProjectPath"
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
    throw "Skills compartilhadas n??o encontradas: $SharedSkillsRoot"
}
if (-not (Test-Path -LiteralPath $LocalBin)) {
    throw "CLIs locais n??o encontradas: $LocalBin. Reexecute o instalador central."
}

$pbip = Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pbip) {
    Write-Ok "PBIP encontrado: $($pbip.Name)"
}
else {
    Write-WarnMsg "Nenhum .pbip encontrado. A estrutura ser?? preparada mesmo assim."
}

# As CLIs s?? s??o adicionadas ao PATH da sess??o atual; n??o altera PATH do Windows.
$env:PATH = "$LocalBin;$env:PATH"
$env:POWERBI_OPENCODE_ACCELERATOR = $AcceleratorRoot

$opencodeRoot = Join-Path $ProjectPath ".opencode"
$projectSkills = Join-Path $opencodeRoot "skills"
Ensure-Dir $opencodeRoot

if (Test-Path -LiteralPath $projectSkills) {
    if (Is-Junction $projectSkills) {
        Remove-Item -LiteralPath $projectSkills -Force
        Write-Ok "Junction anterior removida."
    }
    elseif ($Force) {
        $backup = "$projectSkills.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item -LiteralPath $projectSkills -Destination $backup
        Write-WarnMsg "Skills locais preservadas em: $backup"
    }
    else {
        throw @"
J?? existe '$projectSkills' e ela n??o ?? uma junction.
Para preservar seguran??a, o script n??o a substituiu.
Use -Force para mov??-la para backup e criar o v??nculo compartilhado.
"@
    }
}

New-Item -ItemType Junction -Path $projectSkills -Target $SharedSkillsRoot | Out-Null
Write-Ok "Skills vinculadas ao acelerador compartilhado."

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

Trabalhe somente com os arquivos locais. N??o use Power BI Service, Fabric, MCP remoto,
OAuth ou publica????o.

Use as skills de planejamento, design e autoria quando aplic??vel.

Entregue:
1. P??ginas e visuais existentes.
2. Tabelas, medidas e colunas usadas.
3. Filtros de relat??rio, p??gina e visual.
4. Riscos de DAX, granularidade, relacionamentos e performance.
5. Problemas de UX e melhorias poss??veis.
6. Prioriza????o de alto, m??dio e baixo impacto.

N??o implemente nada ainda.
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
Write-Host "Atalho:  $shortcutCmd"
Write-Host ""
Write-Host "Modo local: sem Power BI Service, Fabric, OAuth ou Power BI Remote MCP." -ForegroundColor Green
Write-Host "CLIs dispon??veis somente nesta sess??o: powerbi-report-author e powerbi-desktop"

if ($InitializeOnly) {
    Write-Host "`nInicializa????o conclu??da. Para abrir depois, execute:"
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

# Template tem caminho resolvido no momento da instala????o.
$shortcutPs1Resolved = $shortcutPs1Template.Replace("__ACCELERATOR_ROOT__", $InstallRoot.Replace("'", "''"))
Write-FileUtf8NoBom (Join-Path $TemplateRoot "Abrir-PowerBI-OpenCode.ps1.template") $shortcutPs1Resolved -Overwrite:$true

$readme = @"
# Acelerador Local Power BI + OpenCode

## Finalidade
Esta instala????o ?? intencionalmente local:
- skills oficiais de Power BI
- PBIP/PBIR/TMDL local
- valida????o e intera????o com Power BI Desktop
- sem Power BI Service, Fabric, publica????o, OAuth ou Power BI Remote MCP

## Uso em um projeto PBIP
Abra PowerShell dentro da pasta do projeto e execute:

```powershell
& "$BinRoot\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

Na primeira execu????o ser??o criados atalhos dentro da pasta:
- `Abrir-PowerBI-OpenCode.ps1`
- `Abrir-PowerBI-OpenCode.cmd`

Depois, basta usar o `.cmd` com duplo clique ou rodar o `.ps1`.

## Power BI Desktop
Abra o `.pbip` e habilite o recurso de preview de acesso a ferramentas externas
por APIs locais seguras. Em seguida teste:

```powershell
powerbi-desktop status
powerbi-report-author --version
```

## Por que n??o h?? MCP remoto?
O Remote Power BI MCP consulta modelos sem??nticos hospedados no Power BI Service/Fabric.
Ele exige autentica????o OAuth/Entra, permiss??es no tenant e Build no modelo. Para este
acelerador local, ele foi deliberadamente exclu??do.
"@
Write-FileUtf8NoBom (Join-Path $InstallRoot "README.md") $readme -Overwrite:$true

# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------
Write-Step "Instala????o conclu??da"
Write-Host "Acelerador: $InstallRoot" -ForegroundColor Green
Write-Host "Starter:    $BinRoot\Start-PowerBI-OpenCode.ps1"
Write-Host ""
Write-Host "Para preparar um projeto PBIP:" -ForegroundColor Cyan
Write-Host "  cd C:\caminho\do\projeto"
Write-Host "  & `"$BinRoot\Start-PowerBI-OpenCode.ps1`" -ProjectPath ."
Write-Host ""
Write-Host "Ap??s a primeira vez, use o atalho criado no pr??prio projeto:"
Write-Host "  Abrir-PowerBI-OpenCode.cmd"

