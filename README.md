# Power BI + OpenCode Accelerator (local)

Acelerador local e offline para desenvolvimento Power BI usando o formato PBIP com o assistente de IA OpenCode.

> **Nota sobre offline:** Para funcionar 100% offline, voce precisa de um modelo LLM local (ex: [Ollama](https://ollama.com) rodando `deepseek-r1`, `llama3`, etc.). Se nao tiver um modelo local, precisara de conexao com a internet para usar modelos em nuvem (Claude, GPT, Gemini, etc.).

---

## 1. O que e OpenCode

[OpenCode](https://opencode.ai) e um **assistente de codificacao com IA de codigo aberto** que roda no terminal. Criado pela [Anomaly](https://github.com/anomalyco/opencode), ele conecta a mais de 75 provedores de modelos (Claude, GPT, Gemini, Ollama local, etc.) e fornece edicao de arquivos, geracao de codigo, acesso a shell e compreensao de projeto atraves de uma unica interface TUI (Terminal User Interface).

Diferente de wrappers de chat, o OpenCode e um **agent harness completo** ??? com loop de ferramentas, integracao LSP, gerenciamento de sessoes, e modos Plan/Build. Ele roda no terminal, onde pode inspecionar repositorios, editar arquivos, chamar ferramentas e executar fluxos de trabalho agentic repetiveis.

**Recursos principais:**
- Suporte a 75+ provedores de LLM (incluindo modelos locais via Ollama)
- Integracao LSP para informacoes de tipos e diagnosticos em tempo real
- Multiplas sessoes paralelas no mesmo projeto
- Compartilhamento de sessoes via links
- Modos Plan (planejamento) e Build (implementacao)
- Comandos customizaveis em Markdown (`.opencode/commands/`)

**Links oficiais:**
- Site: https://opencode.ai
- Documentacao: https://opencode.ai/docs
- GitHub: https://github.com/anomalyco/opencode
- CLI Docs: https://opencode.ai/docs/cli/

---

## 2. O que e MCP

**MCP (Model Context Protocol)** e um padrao open-source para conectar aplicacoes de IA a sistemas externos. Criado pela Anthropic, ele funciona como uma **porta USB-C para aplicacoes de IA** ??? fornecendo uma maneira padronizada de conectar assistentes de IA a fontes de dados, ferramentas e workflows.

Com o MCP, ferramentas como OpenCode, Claude Desktop, ChatGPT e VS Code Copilot podem:
- Acessar fontes de dados (arquivos locais, bancos de dados)
- Utilizar ferramentas externas (APIs, calculadoras, buscadores)
- Executar workflows especializados (prompts reutilizaveis)

**Links oficiais:**
- Site: https://modelcontextprotocol.io
- Documentacao: https://modelcontextprotocol.io/docs
- GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- Introducao: https://modelcontextprotocol.io/introduction

### 2.1 Quais MCPs este projeto utiliza

Este acelerador trabalha com MCPs da Microsoft para Power BI. O foco e **local**, mas para funcionar offline voce precisa ter um modelo LLM local (ex: via [Ollama](https://ollama.com)). Caso contrario, o OpenCode precisara de conexao com a internet para acessar modelos em nuvem.

| MCP Server | Descricao | Uso no projeto |
|---|---|---|
| **Power BI Modeling MCP** | Inspeciona schemas, roda consultas DAX, edita modelos semanticos e gerencia workspaces Fabric | Edicao programatica de modelos via TOM (Tabular Object Model) |
| **Power BI Remote MCP** | Consulta modelos semanticos hospedados no Power BI Service/Fabric | *Excluido deliberadamente* deste acelerador local |

> **Nota:** O Power BI Modeling MCP e registrado automaticamente pelo plugin `powerbi-authoring` do repositorio [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric). Ele funciona localmente contra Power BI Desktop e projetos PBIP sem necessidade de licenca Fabric.

**Links oficiais dos MCPs Microsoft:**
- Power BI Modeling MCP: https://github.com/microsoft/powerbi-modeling-mcp
- Power BI Remote MCP: https://github.com/microsoft/powerbi-remote-mcp
- Visao geral Power BI Agentic: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview
- Documentacao MCP Microsoft Learn: https://learn.microsoft.com/en-us/power-bi/developer/mcp/

---

## 3. O que e BPA

**BPA (Best Practice Analyzer)** e uma ferramenta criada pelo [Tabular Editor](https://tabulareditor.com) que verifica automaticamente se um modelo semantico Power BI segue as melhores praticas da comunidade. Ele escaneia o modelo contra um conjunto de regras e identifica problemas de performance, erros potenciais, formatacao e manutenibilidade.

O BPA e utilizado tanto pelo **Tabular Editor 2** (gratuito) quanto pelo **Tabular Editor 3**, e tambem esta disponivel em **notebooks do Microsoft Fabric**.

**Categorias de regras incluidas:**

| Categoria | Exemplos | Severidade |
|---|---|---|
| **Performance** | Tipos de dados flutuantes, relacionamentos bi-direcionais, tabelas sem particoes, Power Query excessivo | Alta/Media |
| **DAX Expressions** | Colunas nao qualificadas, uso de IFERROR ao inves de DIVIDE, TREATAS vs INTERSECT | Media |
| **Error Prevention** | Caracteres invalidos em nomes, colunas sem fonte, RLS + USERELATIONSHIP | Alta |
| **Formatting** | Format strings ausentes, flags 0/1 ao inves de Sim/Nao, categorias de dados | Media/Baixa |
| **Maintenance** | Colunas ocultas nao referenciadas, medias sem uso, violacoes de integridade referencial | Media |
| **Naming Conventions** | Nomes com espacos, caracteres especiais, nomes de particoes inconsistentes | Media/Baixa |

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

Este acelerador combina OpenCode + Skills de IA + BPA + CLIs locais para oferecer um fluxo de trabalho completo de desenvolvimento Power BI **100% local e offline**.

### 4.1 Criar e editar relatorios Power BI (Dashboards)

Com a skill `powerbi-report-authoring`, voce pode criar e modificar relatorios no formato PBIR/PBIP usando linguagem natural:

- Criar paginas de relatorio do zero
- Adicionar e configurar visuais (graficos, tabelas, cards, mapas)
- Configurar filtros, slicers e bookmarks
- Aplicar temas e formatacao
- Validar JSON do PBIR e verificar renderizacao no Power BI Desktop

**Exemplo de uso:**
```
"Crie uma pagina de vendas com um KPI card para receita total,
um grafico de barras por regiao e uma tabela com detalhamento
por produto. Use o tema corporativo."
```

**Links de referencia:**
- Power BI Report Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Plugin powerbi-authoring: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/

### 4.2 Validar modelos semanticos (DAX, TMDL, Relacionamentos)

Com a skill `semantic-model-authoring` e o BPA, voce pode:

- Analisar expressoes DAX para erros e anti-patterns
- Verificar granularidade e Cardinalidade dos relacionamentos
- Validar nomes de tabelas, colunas e medidas
- Identificar colunas calculadas desnecessarias
- Detectar problemas de performance (colunas longas, tipos flutuantes)
- Verificar conformidade com star schema

**Exemplo de uso:**
```
"Analise o modelo semantico deste projeto PBIP.
Verifique se ha problemas de DAX, relacionamentos
bidirecionais problematicos, e colunas calculadas
que poderiam ser migradas para o data warehouse."
```

**Links de referencia:**
- Semantic Model Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview
- DAX Best Practices: https://www.sqlbi.com/articles/portrait-of-the-new-dax/
- Star Schema Guide: https://docs.microsoft.com/power-bi/guidance/star-schema
- TMDL Format: https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset

### 4.3 Criar layouts e designs profissionais

Com a skill `powerbi-report-design`, voce pode:

- Escolher o arquetype certo (Executive Summary, Comparative Benchmark, Operational Monitor, etc.)
- Aplicar selecao adequada de graficos
- Configurar cores, tipografia e acessibilidade
- Usar templates de layout pre-definidos
- Re-tematizar relatorios existentes

**Exemplo de uso:**
```
"Redesenhe este relatorio seguindo o arquetype
Executive Summary. Use cores corporativas (azul #003366,
cinza #666666) e garantia acessibilidade WCAG 2.1."
```

**Links de referencia:**
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Power BI Report Planning Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview
- Design Brief Template: https://www.sqlbi.com/articles/power-bi-report-layout-and-design-best-practices/
- Visual Cookbook: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills/powerbi-report-design/references

### 4.4 Analise de qualidade com BPA

Execute o Best Practice Analyzer contra seu modelo para encontrar e corrigir problemas automaticamente:

```
"Roda o BPA neste modelo e me lista todas as violacoes
de severidade 3 e 2, agrupadas por categoria."
```

**Links de referencia:**
- Skill Rode o BPA: `skills/rode-o-bpa/SKILL.md`
- Regras BPA: `skills/rode-o-bpa/references/BPARules.json`
- Tabular Editor BPA: https://docs.tabulareditor.com/features/using-bpa.html

### 4.5 CLIs locais para validacao

O projeto instala localmente (sem npm global):

| CLI | Descricao | Comando |
|---|---|---|
| `powerbi-report-author` | Le, valida e cria arquivos PBIR | `powerbi-report-author validate <pasta>` |
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

### Passo 1: Pre-requisitos

| Ferramenta | Versao minima | Link |
|---|---|---|
| Git | Qualquer versao recente | https://git-scm.com/downloads |
| Node.js | 20+ | https://nodejs.org |
| OpenCode | Instalado e configurado | https://opencode.ai/docs |
| Power BI Desktop | Para bridge/screenshot/reload (opcional) | https://powerbi.microsoft.com/desktop/ |
| Tabular Editor 2 ou 3 | Para BPA (recomendado) | https://tabulareditor.com |

### Passo 2: Instalar o acelerador

Abra o PowerShell e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\caminho\para\o\repositorio
.\Install-PowerBI-OpenCodeAccelerator.ps1
```

Para instalar em um diretorio customizado:

```powershell
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\MeuCaminho\PowerBI-Accelerator"
```

**O que a instalacao faz:**
1. Clona o repositorio oficial [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric)
2. Copia as skills Power BI para `skills/`
3. Instala as CLIs `powerbi-report-author` e `powerbi-desktop` localmente via npm
4. Cria os templates de `AGENTS.md` e scripts de bootstrap

### Passo 3: Preparar um projeto PBIP

Entre na pasta de qualquer projeto Power BI PBIP e execute:

```powershell
& "Caminho\Do\Acelerator\bin\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

**O que acontece na primeira vez:**
- `.opencode/skills` ??? Junction (atalho) para as skills compartilhadas
- `AGENTS.md` ??? Regras do projeto para o assistente de IA
- `Abrir-PowerBI-OpenCode.ps1` ??? Script de inicializacao
- `Abrir-PowerBI-OpenCode.cmd` ??? Atalho clicavel (duplo clique)

### Passo 4: Abrir o projeto

Depois da preparacao, basta dar **duplo clique** em `Abrir-PowerBI-OpenCode.cmd` ou executar:

```powershell
.\Abrir-PowerBI-OpenCode.ps1
```

Isso vai:
1. Adicionar as CLIs ao PATH da sessao
2. Criar a junction de skills
3. Preparar o AGENTS.md
4. Abrir o OpenCode na pasta do projeto

### Passo 5: Usar o assistente de IA

Dentro do OpenCode, voce pode usar comandos como:

```
# Analise do modelo
"Analise este projeto Power BI e me diga quais sao as tabelas,
medidas e relacionamentos existentes."

# Criacao de relatorio
"Crie uma pagina de vendas com grafico de barras por categoria
e um card com o total de receita."

# Validacao BPA
"Rode o BPA neste modelo e proponha correcoes para os
problemas de severidade alta."

# Correcao de DAX
"Otimize esta medida DAX que esta usando FILTER dentro de CALCULATE."

# Verificacao no Desktop
"Abra o relatorio no Power BI Desktop e tire um screenshot."
```

### Passo 6: Validar mudancas

Apos cada lote de mudancas, valide:

```powershell
# Validar arquivos PBIR
powerbi-report-author validate .\MeuProjeto.Report

# Reload no Desktop (se aberto)
powerbi-desktop reload

# Screenshot para verificacao visual
powerbi-desktop screenshot

# Verificar status
powerbi-desktop status
```

---

## Skills incluidas

| Skill | Descricao | Documentacao |
|---|---|---|
| `powerbi-report-authoring` | Criar e editar visuais, filtros, formatacao e expressoes | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview) |
| `powerbi-report-design` | Principios de design, layout, acessibilidade e UX | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview) |
| `powerbi-report-planning` | Planejamento e analise de requisitos | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview) |
| `powerbi-report-management` | Gerenciamento de versao e operacoes | [GitHub](https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills) |
| `semantic-model-authoring` | Modelagem de dados, DAX, TMDL e naming conventions | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview) |
| `rode-o-bpa` | Best Practice Analyzer com regras oficiais da Microsoft | [Tabular Editor Docs](https://docs.tabulareditor.com/features/using-bpa.html) |
| `check-updates` | Verificacao de atualizacoes do repositorio | ??? |

---

## Referencias completas

### Microsoft Power BI
- Power BI Desktop: https://powerbi.microsoft.com
- PBIP Documentation: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset
- PBIP Report: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report
- Power BI Agentic Overview: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview

### Microsoft Fabric e Skills
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- Install Skills for Fabric: https://learn.microsoft.com/en-us/fabric/fundamentals/skills-for-fabric-install
- Power BI Authoring Plugin: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring

### Model Context Protocol
- MCP Site: https://modelcontextprotocol.io
- MCP GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- MCP Introduction: https://modelcontextprotocol.io/introduction

### Tabular Editor e BPA
- Tabular Editor: https://tabulareditor.com
- BPA Documentation: https://docs.tabulareditor.com/features/using-bpa.html
- BPA Rules (Tabular Editor): https://github.com/TabularEditor/BestPracticeRules
- BPA Rules (Microsoft): https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- BPA Blog Post: https://tabulareditor.com/blog/best-practice-analyzer-bpa-rules-for-semantic-models

### Comunidade e Artigos
- SQLBI Best Practices: https://www.sqlbi.com/articles/
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/
- PBIP + Git + CI/CD: https://powerbiconsulting.com/blog/power-bi-project-format-pbip-git-ci-cd
- Power BI Semantic Model Optimization: https://powerbiconsulting.com/blog/power-bi-semantic-model-optimization-complete-guide-2026

---

## Licenca

[MIT](LICENSE)

