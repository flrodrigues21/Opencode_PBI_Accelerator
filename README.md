# Power BI + OpenCode Accelerator (local)

Acelerador local e offline para desenvolvimento Power BI usando o formato PBIP (Power BI Project) com o assistente de IA OpenCode.

## O que e

Este projeto instala um conjunto compartilhado de **skills de IA** (documentos de prompt engineering em Markdown) que ensinam o OpenCode a trabalhar com:

- **Relatorios Power BI** via arquivos PBIR (Power BI Report)
- **Modelos semanticos** via arquivos TMDL (Tabular Model Definition Language)
- **Expressoes DAX** com analise de performance e granularidade
- **Validacao e interacao** com Power BI Desktop via CLIs locais

## Escopo

Este acelerador e **intencionalmente local/offline**. Nao utiliza:

- Power BI Service
- Microsoft Fabric
- OAuth / Entra ID
- Power BI Remote MCP
- Publicacao ou compartilhamento de relatorios
- Credenciais ou tenancy

## Pre-requisitos

| Ferramenta | Versao minima |
|---|---|
| Git | Qualquer versao recente |
| Node.js | 20+ |
| OpenCode | Instalado e configurado |
| Power BI Desktop | Para bridge/screenshot/reload (opcional) |

## Instalacao

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install-PowerBI-OpenCodeAccelerator.ps1
```

Ou para instalar em um diretorio customizado:

```powershell
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\MeuCaminho\PowerBI-Accelerator"
```

A versao simplificada tambem esta disponivel:

```powershell
.\Install-PowerBI-OpenCodeAccelerator-v2.ps1
```

### O que e instalado

- **Skills compartilhadas** - Copiadas do repositorio oficial [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) (plugin `powerbi-authoring`)
- **CLIs Power BI** - `powerbi-report-author` e `powerbi-desktop` instaladas localmente via npm (sem `npm -g`)
- **Templates** - `AGENTS.md` e scripts de bootstrap para projetos PBIP
- **Vendor** - Clone do repositorio Microsoft para consulta

## Uso

### Preparar um projeto PBIP

Entre na pasta do projeto PBIP e execute:

```powershell
& "Caminho\Do\Acelerator\bin\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

Na primeira vez, o script cria dentro do projeto:
- `.opencode\skills` - Junction para as skills compartilhadas
- `AGENTS.md` - Regras do projeto para o assistente de IA
- `Abrir-PowerBI-OpenCode.ps1` - Script de inicializacao
- `Abrir-PowerBI-OpenCode.cmd` - Atalho clicavel

### Abrir o projeto

Depois da preparacao, basta dar duplo clique em `Abrir-PowerBI-OpenCode.cmd` ou executar:

```powershell
.\Abrir-PowerBI-OpenCode.ps1
```

### Power BI Desktop

Abra o arquivo `.pbip` no Power BI Desktop e habilite o recurso de preview de acesso a ferramentas externas por APIs locais seguras. Em seguida teste:

```powershell
powerbi-desktop status
powerbi-report-author --version
```

## Skills disponiveis

| Skill | Descricao |
|---|---|
| `powerbi-report-authoring` | Criar e editar visuais, filtros, formatacao e expressoes |
| `powerbi-report-design` | Principios de design, layout, acessibilidade e UX |
| `powerbi-report-planning` | Planejamento e analise de requisitos |
| `powerbi-report-management` | Gerenciamento de versao e operacoes |
| `semantic-model-authoring` | Modelagem de dados, DAX, TMDL e naming conventions |
| `check-updates` | Verificacao de atualizacoes |

## Por que nao ha MCP remoto?

O Remote Power BI MCP consulta modelos semanticos hospedados no Power BI Service/Fabric. Ele exige autenticacao OAuth/Entra, permissoes no tenant e Build no modelo. Para este acelerador local, ele foi deliberadamente excluido.

## Estrutura do repositorio

```
PowerBI-Accelerator/
  bin/                                    Scripts de inicializacao
    Start-PowerBI-OpenCode.ps1            Bootstrap do projeto
    pbi-ai.cmd                           Wrapper CMD
  skills/                                 Skills Power BI compartilhadas
    powerbi-report-authoring/
    powerbi-report-design/
    powerbi-report-planning/
    powerbi-report-management/
    semantic-model-authoring/
    check-updates/
  templates/                              Templates para novos projetos
    AGENTS.md
  node/                                   CLIs Power BI (instalacao local)
  vendor/skills-for-fabric/               Clone do repositorio Microsoft
  Install-PowerBI-OpenCodeAccelerator.ps1 Instalador v1
  Install-PowerBI-OpenCodeAccelerator-v2.ps1 Instalador v2 (simplificado)
```

## Licenca

[MIT](LICENSE)
