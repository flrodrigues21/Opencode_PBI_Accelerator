# Power BI + OpenCode Accelerator (local)

Acelerador local e offline para desenvolvimento Power BI usando o formato PBIP com o assistente de IA OpenCode.

---

## 1. O que ?? OpenCode

[OpenCode](https://opencode.ai) ?? um **assistente de codifica????o com IA de c??digo aberto** que roda no terminal. Criado pela [Anomaly](https://github.com/anomalyco/opencode), ele conecta a mais de 75 provedores de modelos (Claude, GPT, Gemini, Ollama local, etc.) e fornece edi????o de arquivos, gera????o de c??digo, acesso a shell e compreens??o de projeto atrav??s de uma ??nica interface TUI (Terminal User Interface).

Diferente de wrappers de chat, o OpenCode ?? um **agent harness completo** ??? com loop de ferramentas, integra????o LSP, gerenciamento de sess??es, e modos Plan/Build. Ele roda no terminal, onde pode inspecionar reposit??rios, editar arquivos, chamar ferramentas e executar fluxos de trabalho agentic repet??veis.

**Recursos principais:**
- Suporte a 75+ provedores de LLM (incluindo modelos locais via Ollama)
- Integra????o LSP para informa????es de tipos e diagn??sticos em tempo real
- M??ltiplas sess??es paralelas no mesmo projeto
- Compartilhamento de sess??es via links
- Modos Plan (planejamento) e Build (implementa????o)
- Comandos customiz??veis em Markdown (`.opencode/commands/`)

**Links oficiais:**
- Site: https://opencode.ai
- Documenta????o: https://opencode.ai/docs
- GitHub: https://github.com/anomalyco/opencode
- CLI Docs: https://opencode.ai/docs/cli/

---

## 2. O que ?? MCP

**MCP (Model Context Protocol)** ?? um padr??o open-source para conectar aplica????es de IA a sistemas externos. Criado pela Anthropic, ele funciona como uma **porta USB-C para aplica????es de IA** ??? fornecendo uma maneira padronizada de conectar assistentes de IA a fontes de dados, ferramentas e workflows.

Com o MCP, ferramentas como OpenCode, Claude Desktop, ChatGPT e VS Code Copilot podem:
- Acessar fontes de dados (arquivos locais, bancos de dados)
- Utilizar ferramentas externas (APIs, calculadoras, buscadores)
- Executar workflows especializados (prompts reutiliz??veis)

**Links oficiais:**
- Site: https://modelcontextprotocol.io
- Documenta????o: https://modelcontextprotocol.io/docs
- GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- Introdu????o: https://modelcontextprotocol.io/introduction

### 2.1 Quais MCPs este projeto utiliza

Este acelerador trabalha com MCPs da Microsoft para Power BI. Embora o foco seja **local/offline**, os MCPs complementam o fluxo de trabalho:

| MCP Server | Descri????o | Uso no projeto |
|---|---|---|
| **Power BI Modeling MCP** | Inspeciona schemas, roda consultas DAX, edita modelos sem??nticos e gerencia workspaces Fabric | Edi????o program??tica de modelos via TOM (Tabular Object Model) |
| **Power BI Remote MCP** | Consulta modelos sem??nticos hospedados no Power BI Service/Fabric | *Exclu??do deliberadamente* deste acelerador local |

> **Nota:** O Power BI Modeling MCP ?? registrado automaticamente pelo plugin `powerbi-authoring` do reposit??rio [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric). Ele funciona localmente contra Power BI Desktop e projetos PBIP sem necessidade de licen??a Fabric.

**Links oficiais dos MCPs Microsoft:**
- Power BI Modeling MCP: https://github.com/microsoft/powerbi-modeling-mcp
- Power BI Remote MCP: https://github.com/microsoft/powerbi-remote-mcp
- Vis??o geral Power BI Agentic: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview
- Documenta????o MCP Microsoft Learn: https://learn.microsoft.com/en-us/power-bi/developer/mcp/

---

## 3. O que ?? BPA

**BPA (Best Practice Analyzer)** ?? uma ferramenta criada pelo [Tabular Editor](https://tabulareditor.com) que verifica automaticamente se um modelo sem??ntico Power BI segue as melhores pr??ticas da comunidade. Ele escaneia o modelo contra um conjunto de regras e identifica problemas de performance, erros potenciais, formata????o e manutenibilidade.

O BPA ?? utilizado tanto pelo **Tabular Editor 2** (gratuito) quanto pelo **Tabular Editor 3**, e tamb??m est?? dispon??vel em **notebooks do Microsoft Fabric**.

**Categorias de regras inclu??das:**

| Categoria | Exemplos | Severidade |
|---|---|---|
| **Performance** | Tipos de dados flutuantes, relacionamentos bi-direcionais, tabelas sem parti????es, Power Query excessivo | Alta/M??dia |
| **DAX Expressions** | Colunas n??o qualificadas, uso de IFERROR ao inv??s de DIVIDE, TREATAS vs INTERSECT | M??dia |
| **Error Prevention** | Caracteres inv??lidos em nomes, colunas sem fonte, RLS + USERELATIONSHIP | Alta |
| **Formatting** | Format strings ausentes, flags 0/1 ao inv??s de Sim/N??o, categorias de dados | M??dia/Baixa |
| **Maintenance** | Colunas ocultas n??o referenciadas, m??dias sem uso, viola????es de integridade referencial | M??dia |
| **Naming Conventions** | Nomes com espa??os, caracteres especiais, nomes de parti????es inconsistentes | M??dia/Baixa |

**Regras oficiais inclusas neste projeto:**
- Arquivo: `skills/rode-o-bpa/references/BPARules.json`
- Fonte: [microsoft/Analysis-Services](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) (~70 regras)

**Links oficiais:**
- Tabular Editor BPA Docs: https://docs.tabulareditor.com/features/using-bpa.html
- BPA Rules (Tabular Editor): https://github.com/TabularEditor/BestPracticeRules
- BPA Rules (Microsoft CAT): https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- Artigo SQLBI sobre BPA: https://www.sqlbi.com/articles/best-practice-analyzer/
- Blog Tabular Editor sobre BPA: https://tabulareditor.com/blog/best-practice-analyzer-bpa-rules-for-semantic-models
- Fabric Notebooks BPA: https://learn.microsoft.com/en-us/power-bi/transform-model/service-notebooks

---

## 4. O que este projeto pode fazer

Este acelerador combina OpenCode + Skills de IA + BPA + CLIs locais para oferecer um fluxo de trabalho completo de desenvolvimento Power BI. Ap??s a instala????o e configura????o com uma LLM local, pode operar inteiramente offline.

### 4.1 Criar e editar relat??rios Power BI (Dashboards)

Com a skill `powerbi-report-authoring`, voc?? pode criar e modificar relat??rios no formato PBIR/PBIP usando linguagem natural:

- Criar p??ginas de relat??rio do zero
- Adicionar e configurar visuais (gr??ficos, tabelas, cards, mapas)
- Configurar filtros, slicers e bookmarks
- Aplicar temas e formata????o
- Validar JSON do PBIR e verificar renderiza????o no Power BI Desktop

**Exemplo de uso:**
```
"Crie uma p??gina de vendas com um KPI card para receita total,
um gr??fico de barras por regi??o e uma tabela com detalhamento
por produto. Use o tema corporativo."
```

**Links de refer??ncia:**
- Power BI Report Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Plugin powerbi-authoring: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/

### 4.2 Validar modelos sem??nticos (DAX, TMDL, Relacionamentos)

Com a skill `semantic-model-authoring` e o BPA, voc?? pode:

- Analisar express??es DAX para erros e anti-patterns
- Verificar granularidade e Cardinalidade dos relacionamentos
- Validar nomes de tabelas, colunas e medidas
- Identificar colunas calculadas desnecess??rias
- Detectar problemas de performance (colunas longas, tipos flutuantes)
- Verificar conformidade com star schema

**Exemplo de uso:**
```
"Analise o modelo sem??ntico deste projeto PBIP.
Verifique se h?? problemas de DAX, relacionamentos
bidirecionais problem??ticos, e colunas calculadas
que poderiam ser migradas para o data warehouse."
```

**Links de refer??ncia:**
- Semantic Model Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview
- DAX Best Practices: https://www.sqlbi.com/articles/portrait-of-the-new-dax/
- Star Schema Guide: https://docs.microsoft.com/power-bi/guidance/star-schema
- TMDL Format: https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset

### 4.3 Criar layouts e designs profissionais

Com a skill `powerbi-report-design`, voc?? pode:

- Escolher o arquetype certo (Executive Summary, Comparative Benchmark, Operational Monitor, etc.)
- Aplicar sele????o adequada de gr??ficos
- Configurar cores, tipografia e acessibilidade
- Usar templates de layout pr??-definidos
- Re-tematizar relat??rios existentes

**Exemplo de uso:**
```
"Redesenhe este relat??rio seguindo o arquetype
Executive Summary. Use cores corporativas (azul #003366,
cinza #666666) e garanta acessibilidade WCAG 2.1."
```

**Links de refer??ncia:**
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Power BI Report Planning Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview
- Design Brief Template: https://www.sqlbi.com/articles/power-bi-report-layout-and-design-best-practices/
- Visual Cookbook: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills/powerbi-report-design/references

### 4.4 An??lise de qualidade com BPA

Execute o Best Practice Analyzer contra seu modelo para encontrar e corrigir problemas automaticamente:

```
"Roda o BPA neste modelo e me lista todas as viola????es
de severidade 3 e 2, agrupadas por categoria."
```

**Links de refer??ncia:**
- Skill Rode o BPA: `skills/rode-o-bpa/SKILL.md`
- Regras BPA: `skills/rode-o-bpa/references/BPARules.json`
- Tabular Editor BPA: https://docs.tabulareditor.com/features/using-bpa.html

### 4.5 CLIs locais para valida????o

O projeto instala localmente (sem npm global):

| CLI | Descri????o | Comando |
|---|---|---|
| `powerbi-report-author` | L??, valida e cria arquivos PBIR | `powerbi-report-author validate <pasta>` |
| `powerbi-desktop` | Interage com Power BI Desktop (reload, screenshot, status) | `powerbi-desktop reload` |

### 4.6 Fluxo completo de trabalho

```
Planejar (powerbi-report-planning)
    |
    v
Desenhar (powerbi-report-design)
    |
    v
Implementar (powerbi-report-authoring)
    |
    v
Validar BPA (rode-o-bpa)
    |
    v
Verificar no Desktop (powerbi-desktop screenshot)
```

---

## 5. Como usar o projeto

### Passo 1: Pr??-requisitos

| Ferramenta | Vers??o m??nima | Link |
|---|---|---|
| Git | Qualquer vers??o recente | https://git-scm.com/downloads |
| Node.js | 20+ | https://nodejs.org |
| OpenCode | Instalado e configurado | https://opencode.ai/docs |
| Power BI Desktop | Para bridge/screenshot/reload (opcional) | https://powerbi.microsoft.com/desktop/ |
| Tabular Editor 2 ou 3 | Para BPA (recomendado) | https://tabulareditor.com |
| Ollama (ou outro LLM local) | Para uso offline | https://ollama.com |

### Passo 2: Instalar o acelerador

Abra o PowerShell e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\caminho\para\o\repositorio
.\Install-PowerBI-OpenCodeAccelerator.ps1
```

Para instalar em um diret??rio customizado:

```powershell
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\MeuCaminho\PowerBI-Accelerator"
```

**O que a instala????o faz:**
1. Clona o reposit??rio oficial [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) e fixa no commit homologado
2. Copia as skills Power BI para `skills/`
3. Copia os arquivos comuns para `common/` (referenciados pelas skills)
4. Instala as CLIs `powerbi-report-author` e `powerbi-desktop` localmente via npm (vers??es fixadas em 0.1.1)
5. Cria os templates de `AGENTS.md` e scripts de bootstrap

### Passo 3: Preparar um projeto PBIP

Entre na pasta de qualquer projeto Power BI PBIP e execute:

```powershell
& "Caminho\Do\Acelerator\bin\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

**O que acontece na primeira vez:**
- `.opencode/skills` ??? Junction (atalho) para as skills compartilhadas
- `.opencode/common` ??? Junction (atalho) para os arquivos comuns
- `AGENTS.md` ??? Regras do projeto para o assistente de IA
- `Abrir-PowerBI-OpenCode.ps1` ??? Script de inicializa????o
- `Abrir-PowerBI-OpenCode.cmd` ??? Atalho clic??vel (duplo clique)

### Passo 4: Abrir o projeto

Depois da prepara????o, basta dar **duplo clique** em `Abrir-PowerBI-OpenCode.cmd` ou executar:

```powershell
.\Abrir-PowerBI-OpenCode.ps1
```

Isso vai:
1. Adicionar as CLIs ao PATH da sess??o
2. Criar as junctions de skills e common
3. Preparar o AGENTS.md
4. Abrir o OpenCode na pasta do projeto

### Passo 5: Usar o assistente de IA

Dentro do OpenCode, voc?? pode usar comandos como:

```
# An??lise do modelo
"Analise este projeto Power BI e me diga quais s??o as tabelas,
medidas e relacionamentos existentes."

# Cria????o de relat??rio
"Crie uma p??gina de vendas com gr??fico de barras por categoria
e um card com o total de receita."

# Valida????o BPA
"Rode o BPA neste modelo e proponha corre????es para os
problemas de severidade alta."

# Corre????o de DAX
"Otimize esta medida DAX que est?? usando FILTER dentro de CALCULATE."

# Verifica????o no Desktop
"Abra o relat??rio no Power BI Desktop e tire um screenshot."
```

### Passo 6: Validar mudan??as

Ap??s cada lote de mudan??as, valide:

```powershell
# Validar arquivos PBIR
powerbi-report-author validate .\MeuProjeto.Report

# Reload no Desktop (se aberto)
powerbi-desktop reload

# Screenshot para verifica????o visual
powerbi-desktop screenshot

# Verificar status
powerbi-desktop status
```

---

## Skills inclu??das

| Skill | Descri????o | Documenta????o |
|---|---|---|
| `powerbi-report-authoring` | Criar e editar visuais, filtros, formata????o e express??es | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview) |
| `powerbi-report-design` | Princ??pios de design, layout, acessibilidade e UX | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview) |
| `powerbi-report-planning` | Planejamento e an??lise de requisitos | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview) |
| `powerbi-report-management` | Gerenciamento de vers??o e opera????es | [GitHub](https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills) |
| `semantic-model-authoring` | Modelagem de dados, DAX, TMDL e naming conventions | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview) |
| `rode-o-bpa` | Best Practice Analyzer com regras oficiais da Microsoft | [Tabular Editor Docs](https://docs.tabulareditor.com/features/using-bpa.html) |
| `check-updates` | Verifica????o de atualiza????es do reposit??rio | ??? |

---

## Atribui????es e Licen??as

Este projeto usa licen??a [MIT](LICENSE). Al??m disso, inclui componentes de terceiros detalhados em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Detalhes de atribui????o

| Componente | Fonte | Copyright | Licen??a |
|---|---|---|---|
| Skills Power BI | [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) | (c) 2026 Microsoft Corporation | MIT ([c??pia](third-party/microsoft-skills-for-fabric-LICENSE.txt)) |
| BPA Rules | [microsoft/Analysis-Services](https://github.com/microsoft/Analysis-Services) | (c) 2016 Microsoft | MIT ([c??pia](third-party/microsoft-analysis-services-LICENSE.txt)) |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | Anomaly | MIT |
| CLIs npm | [@microsoft/powerbi-report-authoring-cli](https://www.npmjs.com/package/@microsoft/powerbi-report-authoring-cli), [@microsoft/powerbi-desktop-bridge-cli](https://www.npmjs.com/package/@microsoft/powerbi-desktop-bridge-cli) | Microsoft | MIT |

### Refer??ncias completas

#### Microsoft Power BI
- Power BI Desktop: https://powerbi.microsoft.com
- PBIP Documentation: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset
- PBIP Report: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report
- Power BI Agentic Overview: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview

#### Microsoft Fabric e Skills
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- Install Skills for Fabric: https://learn.microsoft.com/en-us/fabric/fundamentals/skills-for-fabric-install
- Power BI Authoring Plugin: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring

#### Model Context Protocol
- MCP Site: https://modelcontextprotocol.io
- MCP GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- MCP Introduction: https://modelcontextprotocol.io/introduction

#### Tabular Editor e BPA
- Tabular Editor: https://tabulareditor.com
- BPA Documentation: https://docs.tabulareditor.com/features/using-bpa.html
- BPA Rules (Tabular Editor): https://github.com/TabularEditor/BestPracticeRules
- BPA Rules (Microsoft): https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- BPA Blog Post: https://tabulareditor.com/blog/best-practice-analyzer-bpa-rules-for-semantic-models

#### Comunidade e Artigos
- SQLBI Best Practices: https://www.sqlbi.com/articles/
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/
- PBIP + Git + CI/CD: https://powerbiconsulting.com/blog/power-bi-project-format-pbip-git-ci-cd
- Power BI Semantic Model Optimization: https://powerbiconsulting.com/blog/power-bi-semantic-model-optimization-complete-guide-2026

---

## Licen??a

[MIT](LICENSE)

