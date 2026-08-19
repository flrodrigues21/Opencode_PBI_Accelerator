# Power BI + OpenCode Accelerator (local)

Acelerador local para desenvolvimento Power BI usando o formato PBIP com o assistente de IA OpenCode.

> **Projeto independente e não oficial.** Não é desenvolvido, patrocinado, endossado ou afiliado à equipe do OpenCode, à Anomaly ou à Microsoft. OpenCode, Power BI, Fabric e Microsoft são marcas de seus respectivos titulares.

> **Nota sobre offline:** A instalação inicial e as atualizações requerem conexão com a internet. Após a instalação, o fluxo de trabalho pode operar localmente quando configurado com uma LLM local (ex: [Ollama](https://ollama.com) rodando `deepseek-r1`, `llama3`, etc.). Caso contrário, o OpenCode precisará de conexão com a internet para acessar modelos em nuvem (Claude, GPT, Gemini, etc.). Qualquer modelo em nuvem poderá receber metadados e trechos dos projetos PBIP conforme a configuração escolhida pelo usuário.

---

## 1. O que é OpenCode

[OpenCode](https://opencode.ai) é um **assistente de codificação com IA de código aberto** que roda no terminal. Criado pela [Anomaly](https://github.com/anomalyco/opencode), ele conecta a mais de 75 provedores de modelos (Claude, GPT, Gemini, Ollama local, etc.) e fornece edição de arquivos, geração de código, acesso a shell e compreensão de projeto através de uma única interface TUI (Terminal User Interface).

Diferente de wrappers de chat, o OpenCode é um **agent harness completo** — com loop de ferramentas, integração LSP, gerenciamento de sessões, e modos Plan/Build. Ele roda no terminal, onde pode inspecionar repositórios, editar arquivos, chamar ferramentas e executar fluxos de trabalho agentic repetíveis.

**Recursos principais:**
- Suporte a 75+ provedores de LLM (incluindo modelos locais via Ollama)
- Integração LSP para informações de tipos e diagnósticos em tempo real
- Múltiplas sessões paralelas no mesmo projeto
- Compartilhamento de sessões via links
- Modos Plan (planejamento) e Build (implementação)
- Comandos customizáveis em Markdown (`.opencode/commands/`)

**Links oficiais:**
- Site: https://opencode.ai
- Documentação: https://opencode.ai/docs
- GitHub: https://github.com/anomalyco/opencode
- CLI Docs: https://opencode.ai/docs/cli/

---

## 2. O que é MCP

**MCP (Model Context Protocol)** é um padrão open-source para conectar aplicações de IA a sistemas externos. Criado pela Anthropic, ele funciona como uma **porta USB-C para aplicações de IA** — fornecendo uma maneira padronizada de conectar assistentes de IA a fontes de dados, ferramentas e workflows.

Com o MCP, ferramentas como OpenCode, Claude Desktop, ChatGPT e VS Code Copilot podem:
- Acessar fontes de dados (arquivos locais, bancos de dados)
- Utilizar ferramentas externas (APIs, calculadoras, buscadores)
- Executar workflows especializados (prompts reutilizáveis)

**Links oficiais:**
- Site: https://modelcontextprotocol.io
- Documentação: https://modelcontextprotocol.io/docs
- GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- Introdução: https://modelcontextprotocol.io/introduction

### 2.1 Quais MCPs este projeto utiliza

Este acelerador trabalha com MCPs da Microsoft para Power BI. Embora o foco seja **local/offline**, os MCPs complementam o fluxo de trabalho:

| MCP Server | Descrição | Uso no projeto |
|---|---|---|
| **Power BI Modeling MCP** | Inspeciona schemas, roda consultas DAX, edita modelos semânticos e gerencia workspaces Fabric | Edição programática de modelos via TOM (Tabular Object Model) |
| **Power BI Remote MCP** | Consulta modelos semânticos hospedados no Power BI Service/Fabric | *Excluído deliberadamente* deste acelerador local |

> **Nota:** O Power BI Modeling MCP é registrado automaticamente pelo plugin `powerbi-authoring` do repositório [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric). Ele funciona localmente contra Power BI Desktop e projetos PBIP sem necessidade de licença Fabric.

**Links oficiais dos MCPs Microsoft:**
- Power BI Modeling MCP: https://github.com/microsoft/powerbi-modeling-mcp
- Power BI Remote MCP: https://github.com/microsoft/powerbi-remote-mcp
- Visão geral Power BI Agentic: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview
- Documentação MCP Microsoft Learn: https://learn.microsoft.com/en-us/power-bi/developer/mcp/

---

## 3. O que é BPA

**BPA (Best Practice Analyzer)** é uma ferramenta criada pelo [Tabular Editor](https://tabulareditor.com) que verifica automaticamente se um modelo semântico Power BI segue as melhores práticas da comunidade. Ele escaneia o modelo contra um conjunto de regras e identifica problemas de performance, erros potenciais, formatação e manutenibilidade.

O BPA é utilizado tanto pelo **Tabular Editor 2** (gratuito) quanto pelo **Tabular Editor 3**, e também está disponível em **notebooks do Microsoft Fabric**.

**Categorias de regras incluídas:**

| Categoria | Exemplos | Severidade |
|---|---|---|
| **Performance** | Tipos de dados flutuantes, relacionamentos bi-direcionais, tabelas sem partições, Power Query excessivo | Alta/Média |
| **DAX Expressions** | Colunas não qualificadas, uso de IFERROR ao invés de DIVIDE, TREATAS vs INTERSECT | Média |
| **Error Prevention** | Caracteres inválidos em nomes, colunas sem fonte, RLS + USERELATIONSHIP | Alta |
| **Formatting** | Format strings ausentes, flags 0/1 ao invés de Sim/Não, categorias de dados | Média/Baixa |
| **Maintenance** | Colunas ocultas não referenciadas, médias sem uso, violações de integridade referencial | Média |
| **Naming Conventions** | Nomes com espaços, caracteres especiais, nomes de partições inconsistentes | Média/Baixa |

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

Este acelerador combina OpenCode + Skills de IA + BPA + CLIs locais para oferecer um fluxo de trabalho completo de desenvolvimento Power BI. Após a instalação e configuração com uma LLM local, pode operar inteiramente offline.

### 4.1 Criar e editar relatórios Power BI (Dashboards)

Com a skill `powerbi-report-authoring`, você pode criar e modificar relatórios no formato PBIR/PBIP usando linguagem natural:

- Criar páginas de relatório do zero
- Adicionar e configurar visuais (gráficos, tabelas, cards, mapas)
- Configurar filtros, slicers e bookmarks
- Aplicar temas e formatação
- Validar JSON do PBIR e verificar renderização no Power BI Desktop

**Exemplo de uso:**
```
"Crie uma página de vendas com um KPI card para receita total,
um gráfico de barras por região e uma tabela com detalhamento
por produto. Use o tema corporativo."
```

**Links de referência:**
- Power BI Report Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Plugin powerbi-authoring: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/

### 4.2 Validar modelos semânticos (DAX, TMDL, Relacionamentos)

Com a skill `semantic-model-authoring` e o BPA, você pode:

- Analisar expressões DAX para erros e anti-patterns
- Verificar granularidade e Cardinalidade dos relacionamentos
- Validar nomes de tabelas, colunas e medidas
- Identificar colunas calculadas desnecessárias
- Detectar problemas de performance (colunas longas, tipos flutuantes)
- Verificar conformidade com star schema

**Exemplo de uso:**
```
"Analise o modelo semântico deste projeto PBIP.
Verifique se há problemas de DAX, relacionamentos
bidirecionais problemáticos, e colunas calculadas
que poderiam ser migradas para o data warehouse."
```

**Links de referência:**
- Semantic Model Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview
- DAX Best Practices: https://www.sqlbi.com/articles/portrait-of-the-new-dax/
- Star Schema Guide: https://docs.microsoft.com/power-bi/guidance/star-schema
- TMDL Format: https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset

### 4.3 Criar layouts e designs profissionais

Com a skill `powerbi-report-design`, você pode:

- Escolher o arquetype certo (Executive Summary, Comparative Benchmark, Operational Monitor, etc.)
- Aplicar seleção adequada de gráficos
- Configurar cores, tipografia e acessibilidade
- Usar templates de layout pré-definidos
- Re-tematizar relatórios existentes

**Exemplo de uso:**
```
"Redesenhe este relatório seguindo o arquetype
Executive Summary. Use cores corporativas (azul #003366,
cinza #666666) e garanta acessibilidade WCAG 2.1."
```

**Links de referência:**
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Power BI Report Planning Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview
- Design Brief Template: https://www.sqlbi.com/articles/power-bi-report-layout-and-design-best-practices/
- Visual Cookbook: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills/powerbi-report-design/references

### 4.4 Análise de qualidade com BPA

Execute o Best Practice Analyzer contra seu modelo para encontrar e corrigir problemas automaticamente:

```
"Roda o BPA neste modelo e me lista todas as violações
de severidade 3 e 2, agrupadas por categoria."
```

**Links de referência:**
- Skill Rode o BPA: `skills/rode-o-bpa/SKILL.md`
- Regras BPA: `skills/rode-o-bpa/references/BPARules.json`
- Tabular Editor BPA: https://docs.tabulareditor.com/features/using-bpa.html

### 4.5 CLIs locais para validação

O projeto instala localmente (sem npm global):

| CLI | Descrição | Comando |
|---|---|---|
| `powerbi-report-author` | Lê, valida e cria arquivos PBIR | `powerbi-report-author validate <pasta>` |
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

### Passo 1: Pré-requisitos

| Ferramenta | Versão mínima | Link |
|---|---|---|
| Git | Qualquer versão recente | https://git-scm.com/downloads |
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

Para instalar em um diretório customizado:

```powershell
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\MeuCaminho\PowerBI-Accelerator"
```

**O que a instalação faz:**
1. Clona o repositório oficial [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) e fixa no commit homologado
2. Copia as skills Power BI para `skills/`
3. Copia os arquivos comuns para `common/` (referenciados pelas skills)
4. Instala as CLIs `powerbi-report-author` e `powerbi-desktop` localmente via npm (versões fixadas em 0.1.1)
5. Cria os templates de `AGENTS.md` e scripts de bootstrap

### Passo 3: Preparar um projeto PBIP

Entre na pasta de qualquer projeto Power BI PBIP e execute:

```powershell
& "Caminho\Do\Acelerator\bin\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

**O que acontece na primeira vez:**
- `.opencode/skills` — Junction (atalho) para as skills compartilhadas
- `.opencode/common` — Junction (atalho) para os arquivos comuns
- `AGENTS.md` — Regras do projeto para o assistente de IA
- `Abrir-PowerBI-OpenCode.ps1` — Script de inicialização
- `Abrir-PowerBI-OpenCode.cmd` — Atalho clicável (duplo clique)

### Passo 4: Abrir o projeto

Depois da preparação, basta dar **duplo clique** em `Abrir-PowerBI-OpenCode.cmd` ou executar:

```powershell
.\Abrir-PowerBI-OpenCode.ps1
```

Isso vai:
1. Adicionar as CLIs ao PATH da sessão
2. Criar as junctions de skills e common
3. Preparar o AGENTS.md
4. Abrir o OpenCode na pasta do projeto

### Passo 5: Usar o assistente de IA

Dentro do OpenCode, você pode usar comandos como:

```
# Análise do modelo
"Analise este projeto Power BI e me diga quais são as tabelas,
medidas e relacionamentos existentes."

# Criação de relatório
"Crie uma página de vendas com gráfico de barras por categoria
e um card com o total de receita."

# Validação BPA
"Rode o BPA neste modelo e proponha correções para os
problemas de severidade alta."

# Correção de DAX
"Otimize esta medida DAX que está usando FILTER dentro de CALCULATE."

# Verificação no Desktop
"Abra o relatório no Power BI Desktop e tire um screenshot."
```

### Passo 6: Validar mudanças

Após cada lote de mudanças, valide:

```powershell
# Validar arquivos PBIR
powerbi-report-author validate .\MeuProjeto.Report

# Reload no Desktop (se aberto)
powerbi-desktop reload

# Screenshot para verificação visual
powerbi-desktop screenshot

# Verificar status
powerbi-desktop status
```

---

## Skills incluídas

| Skill | Descrição | Documentação |
|---|---|---|
| `powerbi-report-authoring` | Criar e editar visuais, filtros, formatação e expressões | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview) |
| `powerbi-report-design` | Princípios de design, layout, acessibilidade e UX | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview) |
| `powerbi-report-planning` | Planejamento e análise de requisitos | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview) |
| `powerbi-report-management` | Gerenciamento de versão e operações | [GitHub](https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills) |
| `semantic-model-authoring` | Modelagem de dados, DAX, TMDL e naming conventions | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview) |
| `rode-o-bpa` | Best Practice Analyzer com regras oficiais da Microsoft | [Tabular Editor Docs](https://docs.tabulareditor.com/features/using-bpa.html) |
| `check-updates` | Verificação de atualizações do repositório | — |

---

## Atribuições e Licenças

Este projeto usa licença [MIT](LICENSE). Além disso, inclui componentes de terceiros detalhados em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Detalhes de atribuição

| Componente | Fonte | Copyright | Licença |
|---|---|---|---|
| Skills Power BI | [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) | (c) 2026 Microsoft Corporation | MIT ([cópia](third-party/microsoft-skills-for-fabric-LICENSE.txt)) |
| BPA Rules | [microsoft/Analysis-Services](https://github.com/microsoft/Analysis-Services) | (c) 2016 Microsoft | MIT ([cópia](third-party/microsoft-analysis-services-LICENSE.txt)) |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | Anomaly | MIT |
| CLIs npm | [@microsoft/powerbi-report-authoring-cli](https://www.npmjs.com/package/@microsoft/powerbi-report-authoring-cli), [@microsoft/powerbi-desktop-bridge-cli](https://www.npmjs.com/package/@microsoft/powerbi-desktop-bridge-cli) | Microsoft | MIT |

### Referências completas

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

## Licença

[MIT](LICENSE)
