<#
.SYNOPSIS
Instala um acelerador local compartilhado para OpenCode + Power BI PBIP.

.DESCRIPTION
Instala UMA VEZ no servidor:
- Microsoft skills-for-fabric (somente o plugin powerbi-authoring)
- Power BI Report Authoring CLI
- Power BI Desktop Bridge CLI
- Scripts de atalho para preparar/abrir qualquer projeto PBIP no OpenCode

Não configura Power BI Service, Fabric, publicação, tenant, OAuth, App Registration
ou Power BI Remote MCP. O objetivo é trabalhar localmente/offline com PBIP/PBIR.

A cada projeto, use:
  C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1 -ProjectPath .

O script cria dentro do projeto:
- .opencode\skills  -> junction para as skills compartilhadas
- AGENTS.md          -> regras locais do projeto
- Abrir-PowerBI-OpenCode.ps1
- Abrir-PowerBI-OpenCode.cmd  -> atalho clicável

.PARAMETER InstallRoot
Pasta comum no servidor onde ficarão skills, CLIs npm e scripts.
Padrão: C:\OpenCode\PowerBI-Accelerator

.PARAMETER Force
Atualiza o clone Git e restaura arquivos de atalho/regra quando necessário.

.PARAMETER SkipNpmInstall
Pula a instalação local das CLIs Power BI, útil para testes.

.EXAMPLE
Set-ExecutionPolicy -Scope Process Bypass
.\Install-PowerBI-OpenCodeAccelerator.ps1

.EXAMPLE
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\Ferramentas\PowerBI-Accelerator" -Force

.NOTES
Pré-requisitos:
- Git
- Node.js 20 ou superior
- OpenCode
- Power BI Desktop (para bridge/screenshot/reload)

As CLIs são instaladas LOCALMENTE em:
  <InstallRoot>\node\node_modules\.bin
Nenhuma instalação npm global é feita.
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
        throw "Comando '$Name' não encontrado. $Hint"
    }
    $version = try { (& $Name --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { "" }
    Write-Ok "$Name encontrado $version"
}

function Assert-Node20 {
    Assert-Command "node" "Instale Node.js LTS 20+. Em servidor sem winget, use o instalador MSI oficial."
    $v = (& node --version).Trim()
    if ($v -notmatch '^v(\d+)\.') { throw "Versão de Node inválida: $v" }
    if ([int]$Matches[1] -lt 20) { throw "É necessário Node.js 20+. Detectado: $v" }
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
# Validação e estrutura central
# ---------------------------------------------------------------------------
Write-Step "Validando pré-requisitos"
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
# Clone/atualização do repositorio Microsoft
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
    Write-Ok "Repositório oficial clonado."
}
elseif ($Force) {
    Push-Location $RepoRoot
    try {
        & git fetch --depth 1 origin main
        if ($LASTEXITCODE -ne 0) { throw "Falha no git fetch." }
        & git reset --hard origin/main
        if ($LASTEXITCODE -ne 0) { throw "Falha no git reset." }
        Write-Ok "Repositório oficial atualizado."
    }
    finally { Pop-Location }
}
else {
    Write-Ok "Clone oficial já existe. Use -Force para atualizar."
}

$pluginRoot = Join-Path $RepoRoot $PluginSourceRelative
$skillsSource = Join-Path $pluginRoot "skills"
if (-not (Test-Path -LiteralPath $skillsSource)) {
    throw "Estrutura esperada não encontrada: $skillsSource"
}

# ---------------------------------------------------------------------------
# Skills compartilhadas
# ---------------------------------------------------------------------------
Write-Step "Atualizando skills compartilhadas"
Get-ChildItem -LiteralPath $SharedSkillsRoot -Directory -ErrorAction SilentlyContinue |
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
# Node local: evita npm -g e privilégios de administrador
# ---------------------------------------------------------------------------
if (-not $SkipNpmInstall) {
    Write-Step "Instalando CLIs Power BI localmente no acelerador"
    & npm install --prefix $NodeLocalRoot `
        @microsoft/powerbi-report-authoring-cli `
        @microsoft/powerbi-desktop-bridge-cli
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao instalar as CLIs Power BI localmente via npm."
    }
    Write-Ok "CLIs instaladas em: $NodeLocalRoot"
}
else {
    Write-WarnMsg "Instalação npm ignorada por -SkipNpmInstall."
}

# ---------------------------------------------------------------------------
# Templates de projeto
# ---------------------------------------------------------------------------
$agentsTemplate = @'
# Power BI PBIP — regras do projeto

Este projeto usa um acelerador local de OpenCode + Power BI.
As skills são vinculadas de `.opencode/skills` para um diretório compartilhado no servidor.

## Escopo local e segurança
- Trabalhar somente com os arquivos locais PBIP/PBIR/TMDL deste projeto.
- Não configurar, consultar ou publicar no Power BI Service/Fabric.
- Não usar Power BI Remote MCP, OAuth, tenant, workspace ou semantic model remoto.
- Não pedir nem armazenar credenciais de cliente neste projeto.
- Não alterar fontes de dados, parâmetros ou credenciais sem instrução explícita.

## Fluxo obrigatório
1. Para entender a necessidade: usar skill de planejamento.
2. Para UX e layout: usar skill de design.
3. Antes de editar arquivos PBIR: explicar o plano e aguardar aprovação, salvo pedido explícito de implementação imediata.
4. Antes de criar bindings: inspecionar os arquivos TMDL/PBIR existentes. Nunca inventar tabela, coluna ou medida.
5. Após cada lote lógico de mudanças:
   `powerbi-report-author validate <pasta-do-arquivo-.Report>`
6. Para validar o resultado visual, quando Power BI Desktop estiver aberto:
   - `powerbi-desktop status`
   - `powerbi-desktop reload`
   - `powerbi-desktop screenshot`
7. Não atualizar manualmente `$schema`.
8. Não alterar RLS, incremental refresh, relacionamentos ou medidas críticas sem explicar impacto e rollback.

## Qualidade
- Confirmar granularidade, filtros e contexto DAX.
- Preferir dimensões e tabela calendário já existentes.
- Evitar relacionamentos bidirecionais sem justificativa.
- Registrar decisões e análises em `docs/`.
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
    throw "Acelerador não encontrado em: $starter"
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
    throw "Pasta do projeto não encontrada: $ProjectPath"
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
    throw "Skills compartilhadas não encontradas: $SharedSkillsRoot"
}
if (-not (Test-Path -LiteralPath $LocalBin)) {
    throw "CLIs locais não encontradas: $LocalBin. Reexecute o instalador central."
}

$pbip = Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pbip) {
    Write-Ok "PBIP encontrado: $($pbip.Name)"
}
else {
    Write-WarnMsg "Nenhum .pbip encontrado. A estrutura será preparada mesmo assim."
}

# As CLIs só são adicionadas ao PATH da sessão atual; não altera PATH do Windows.
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
Já existe '$projectSkills' e ela não é uma junction.
Para preservar segurança, o script não a substituiu.
Use -Force para movê-la para backup e criar o vínculo compartilhado.
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

Trabalhe somente com os arquivos locais. Não use Power BI Service, Fabric, MCP remoto,
OAuth ou publicação.

Use as skills de planejamento, design e autoria quando aplicável.

Entregue:
1. Páginas e visuais existentes.
2. Tabelas, medidas e colunas usadas.
3. Filtros de relatório, página e visual.
4. Riscos de DAX, granularidade, relacionamentos e performance.
5. Problemas de UX e melhorias possíveis.
6. Priorização de alto, médio e baixo impacto.

Não implemente nada ainda.
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
Write-Host "CLIs disponíveis somente nesta sessão: powerbi-report-author e powerbi-desktop"

if ($InitializeOnly) {
    Write-Host "`nInicialização concluída. Para abrir depois, execute:"
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

# Template tem caminho resolvido no momento da instalação.
$shortcutPs1Resolved = $shortcutPs1Template.Replace("__ACCELERATOR_ROOT__", $InstallRoot.Replace("'", "''"))
Write-FileUtf8NoBom (Join-Path $TemplateRoot "Abrir-PowerBI-OpenCode.ps1.template") $shortcutPs1Resolved -Overwrite:$true

$readme = @"
# Acelerador Local Power BI + OpenCode

## Finalidade
Esta instalação é intencionalmente local:
- skills oficiais de Power BI
- PBIP/PBIR/TMDL local
- validação e interação com Power BI Desktop
- sem Power BI Service, Fabric, publicação, OAuth ou Power BI Remote MCP

## Uso em um projeto PBIP
Abra PowerShell dentro da pasta do projeto e execute:

```powershell
& "$BinRoot\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

Na primeira execução serão criados atalhos dentro da pasta:
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

## Por que não há MCP remoto?
O Remote Power BI MCP consulta modelos semânticos hospedados no Power BI Service/Fabric.
Ele exige autenticação OAuth/Entra, permissões no tenant e Build no modelo. Para este
acelerador local, ele foi deliberadamente excluído.
"@
Write-FileUtf8NoBom (Join-Path $InstallRoot "README.md") $readme -Overwrite:$true

# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------
Write-Step "Instalação concluída"
Write-Host "Acelerador: $InstallRoot" -ForegroundColor Green
Write-Host "Starter:    $BinRoot\Start-PowerBI-OpenCode.ps1"
Write-Host ""
Write-Host "Para preparar um projeto PBIP:" -ForegroundColor Cyan
Write-Host "  cd C:\caminho\do\projeto"
Write-Host "  & `"$BinRoot\Start-PowerBI-OpenCode.ps1`" -ProjectPath ."
Write-Host ""
Write-Host "Após a primeira vez, use o atalho criado no próprio projeto:"
Write-Host "  Abrir-PowerBI-OpenCode.cmd"
