# Power BI + OpenCode Accelerator (local)

Local accelerator for Power BI development using the PBIP format with the OpenCode AI assistant.

> **Independent and unofficial project.** It is not developed, sponsored, endorsed, or affiliated with the OpenCode team, Anomaly, or Microsoft. OpenCode, Power BI, Fabric, and Microsoft are trademarks of their respective owners.

> **Note on offline usage:** Initial installation and updates require an internet connection. After installation, the workflow can operate locally when configured with a local LLM (e.g., [Ollama](https://ollama.com) running `deepseek-r1`, `llama3`, etc.). Otherwise, OpenCode will need internet access to use cloud models (Claude, GPT, Gemini, etc.). Any cloud model may receive metadata and snippets from PBIP projects according to the user's chosen configuration.

---

## 1. What is OpenCode

[OpenCode](https://opencode.ai) is an **open-source AI coding assistant** that runs in the terminal. Created by [Anomaly](https://github.com/anomalyco/opencode), it connects to over 75 model providers (Claude, GPT, Gemini, Ollama local, etc.) and provides file editing, code generation, shell access, and project understanding through a single TUI (Terminal User Interface).

Unlike chat wrappers, OpenCode is a **complete agent harness** -- with tool loops, LSP integration, session management, and Plan/Build modes. It runs in the terminal, where it can inspect repositories, edit files, call tools, and execute repeatable agentic workflows.

**Key features:**
- Support for 75+ LLM providers (including local models via Ollama)
- LSP integration for real-time type information and diagnostics
- Multiple parallel sessions in the same project
- Session sharing via links
- Plan (planning) and Build (implementation) modes
- Customizable Markdown commands (`.opencode/commands/`)

**Official links:**
- Site: https://opencode.ai
- Documentation: https://opencode.ai/docs
- GitHub: https://github.com/anomalyco/opencode
- CLI Docs: https://opencode.ai/docs/cli/

---

## 2. What is MCP

**MCP (Model Context Protocol)** is an open-source standard for connecting AI applications to external systems. Created by Anthropic, it works like a **USB-C port for AI applications** -- providing a standardized way to connect AI assistants to data sources, tools, and workflows.

With MCP, tools like OpenCode, Claude Desktop, ChatGPT, and VS Code Copilot can:
- Access data sources (local files, databases)
- Use external tools (APIs, calculators, search engines)
- Execute specialized workflows (reusable prompts)

**Official links:**
- Site: https://modelcontextprotocol.io
- Documentation: https://modelcontextprotocol.io/docs
- GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- Introduction: https://modelcontextprotocol.io/introduction

### 2.1 Which MCPs does this project use

This accelerator works with Microsoft MCPs for Power BI. Although the focus is **local/offline**, MCPs complement the workflow:

| MCP Server | Description | Usage in this project |
|---|---|---|
| **Power BI Modeling MCP** | Inspects schemas, runs DAX queries, edits semantic models, and manages Fabric workspaces | Programmatic model editing via TOM (Tabular Object Model) |
| **Power BI Remote MCP** | Queries semantic models hosted in Power BI Service/Fabric | *Deliberately excluded* from this local accelerator |

> **Note:** The Power BI Modeling MCP is automatically registered by the `powerbi-authoring` plugin from the [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) repository. It works locally against Power BI Desktop and PBIP projects without requiring a Fabric license.

**Official Microsoft MCP links:**
- Power BI Modeling MCP: https://github.com/microsoft/powerbi-modeling-mcp
- Power BI Remote MCP: https://github.com/microsoft/powerbi-remote-mcp
- Power BI Agentic Overview: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview
- Microsoft Learn MCP Documentation: https://learn.microsoft.com/en-us/power-bi/developer/mcp/

---

## 3. What is BPA

**BPA (Best Practice Analyzer)** is a tool created by [Tabular Editor](https://tabulareditor.com) that automatically checks whether a Power BI semantic model follows community best practices. It scans the model against a set of rules and identifies performance issues, potential errors, formatting, and maintainability problems.

BPA is used by both **Tabular Editor 2** (free) and **Tabular Editor 3**, and is also available in **Microsoft Fabric notebooks**.

**Included rule categories:**

| Category | Examples | Severity |
|---|---|---|
| **Performance** | Floating-point data types, bi-directional relationships, tables without partitions, excessive Power Query | High/Medium |
| **DAX Expressions** | Unqualified columns, using IFERROR instead of DIVIDE, TREATAS vs INTERSECT | Medium |
| **Error Prevention** | Invalid characters in names, columns without source, RLS + USERELATIONSHIP | High |
| **Formatting** | Missing format strings, 0/1 flags instead of Yes/No, data categories | Medium/Low |
| **Maintenance** | Unreferenced hidden columns, unused measures, referential integrity violations | Medium |
| **Naming Conventions** | Names with spaces, special characters, inconsistent partition names | Medium/Low |

**Official rules included in this project:**
- File: `skills/rode-o-bpa/references/BPARules.json`
- Source: [microsoft/Analysis-Services](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) (~70 rules)

**Official links:**
- Tabular Editor BPA Docs: https://docs.tabulareditor.com/features/using-bpa.html
- BPA Rules (Tabular Editor): https://github.com/TabularEditor/BestPracticeRules
- BPA Rules (Microsoft CAT): https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- SQLBI article on BPA: https://www.sqlbi.com/articles/best-practice-analyzer/
- Tabular Editor blog on BPA: https://tabulareditor.com/blog/best-practice-analyzer-bpa-rules-for-semantic-models
- Fabric Notebooks BPA: https://learn.microsoft.com/en-us/power-bi/transform-model/service-notebooks

---

## 4. What this project can do

This accelerator combines OpenCode + AI Skills + BPA + local CLIs to provide a complete Power BI development workflow. After installation and configuration with a local LLM, it can operate entirely offline.

### 4.1 Create and edit Power BI reports (Dashboards)

With the `powerbi-report-authoring` skill, you can create and modify reports in PBIR/PBIP format using natural language:

- Create report pages from scratch
- Add and configure visuals (charts, tables, cards, maps)
- Configure filters, slicers, and bookmarks
- Apply themes and formatting
- Validate PBIR JSON and check rendering in Power BI Desktop

**Usage example:**
```
"Create a sales page with a KPI card for total revenue,
a bar chart by region, and a table with product details.
Use the corporate theme."
```

**Reference links:**
- Power BI Report Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Plugin powerbi-authoring: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/

### 4.2 Validate semantic models (DAX, TMDL, Relationships)

With the `semantic-model-authoring` skill and BPA, you can:

- Analyze DAX expressions for errors and anti-patterns
- Verify granularity and relationship cardinality
- Validate table, column, and measure names
- Identify unnecessary calculated columns
- Detect performance issues (long columns, floating-point types)
- Check star schema compliance

**Usage example:**
```
"Analyze the semantic model in this PBIP project.
Check for DAX issues, problematic bi-directional relationships,
and calculated columns that could be migrated to the data warehouse."
```

**Reference links:**
- Semantic Model Authoring Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview
- DAX Best Practices: https://www.sqlbi.com/articles/portrait-of-the-new-dax/
- Star Schema Guide: https://docs.microsoft.com/power-bi/guidance/star-schema
- TMDL Format: https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset

### 4.3 Create professional layouts and designs

With the `powerbi-report-design` skill, you can:

- Choose the right archetype (Executive Summary, Comparative Benchmark, Operational Monitor, etc.)
- Apply appropriate chart selection
- Configure colors, typography, and accessibility
- Use pre-defined layout templates
- Re-theme existing reports

**Usage example:**
```
"Redesign this report following the Executive Summary archetype.
Use corporate colors (blue #003366, gray #666666) and ensure
WCAG 2.1 accessibility."
```

**Reference links:**
- Power BI Report Design Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview
- Power BI Report Planning Skill: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview
- Design Brief Template: https://www.sqlbi.com/articles/power-bi-report-layout-and-design-best-practices/
- Visual Cookbook: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills/powerbi-report-design/references

### 4.4 Quality analysis with BPA

Run the Best Practice Analyzer against your model to automatically find and fix issues:

```
"Run BPA on this model and list all violations
of severity 3 and 2, grouped by category."
```

**Reference links:**
- Run BPA Skill: `skills/rode-o-bpa/SKILL.md`
- BPA Rules: `skills/rode-o-bpa/references/BPARules.json`
- Tabular Editor BPA: https://docs.tabulareditor.com/features/using-bpa.html

### 4.5 Local CLIs for validation

The project installs locally (no global npm):

| CLI | Description | Command |
|---|---|---|
| `powerbi-report-author` | Reads, validates, and creates PBIR files | `powerbi-report-author validate <folder>` |
| `powerbi-desktop` | Interacts with Power BI Desktop (reload, screenshot, status) | `powerbi-desktop reload` |

### 4.6 Complete workflow

```
Plan (powerbi-report-planning)
    |
    v
Design (powerbi-report-design)
    |
    v
Implement (powerbi-report-authoring)
    |
    v
Validate BPA (rode-o-bpa)
    |
    v
Verify in Desktop (powerbi-desktop screenshot)
```

---

## 5. How to use the project

### Step 1: Prerequisites

| Tool | Minimum version | Link |
|---|---|---|
| Git | Any recent version | https://git-scm.com/downloads |
| Node.js | 20+ | https://nodejs.org |
| OpenCode | Installed and configured | https://opencode.ai/docs |
| Power BI Desktop | For bridge/screenshot/reload (optional) | https://powerbi.microsoft.com/desktop/ |
| Tabular Editor 2 or 3 | For BPA (recommended) | https://tabulareditor.com |
| Ollama (or other local LLM) | For offline usage | https://ollama.com |

### Step 2: Install the accelerator

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd C:\path\to\repository
.\Install-PowerBI-OpenCodeAccelerator.ps1
```

To install in a custom directory:

```powershell
.\Install-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot "D:\MyPath\PowerBI-Accelerator"
```

**What the installation does:**
1. Clones the official [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) repository and pins to the approved commit (`ac156d284ab8e51f121af3f42303ea79c88cdab5`)
2. Copies Power BI skills to `skills/`
3. Copies common files to `common/` (referenced by skills)
4. Installs `powerbi-report-author` and `powerbi-desktop` CLIs locally via npm (versions pinned to `0.1.1`)
5. Creates `AGENTS.md` templates and bootstrap scripts

### Step 3: Prepare a PBIP project

Navigate to any Power BI PBIP project folder and run:

```powershell
& "Path\To\Accelerator\bin\Start-PowerBI-OpenCode.ps1" -ProjectPath .
```

**What happens on first run:**
- `.opencode/skills` -- Junction (symlink) to shared skills
- `.opencode/common` -- Junction (symlink) to common files
- `AGENTS.md` -- Project rules for the AI assistant
- `Abrir-PowerBI-OpenCode.ps1` -- Startup script
- `Abrir-PowerBI-OpenCode.cmd` -- Clickable shortcut (double-click)

### Step 4: Open the project

After preparation, just **double-click** `Abrir-PowerBI-OpenCode.cmd` or run:

```powershell
.\Abrir-PowerBI-OpenCode.ps1
```

This will:
1. Add CLIs to the session PATH
2. Create skills and common junctions
3. Prepare the AGENTS.md
4. Open OpenCode in the project folder

### Step 5: Use the AI assistant

Inside OpenCode, you can use commands like:

```
# Model analysis
"Analyze this Power BI project and tell me what tables,
measures, and relationships exist."

# Report creation
"Create a sales page with a bar chart by category
and a card with total revenue."

# BPA validation
"Run BPA on this model and suggest fixes for
high severity issues."

# DAX correction
"Optimize this DAX measure that uses FILTER inside CALCULATE."

# Desktop verification
"Open the report in Power BI Desktop and take a screenshot."
```

### Step 6: Validate changes

After each batch of changes, validate:

```powershell
# Validate PBIR files
powerbi-report-author validate .\MyProject.Report

# Reload in Desktop (if open)
powerbi-desktop reload

# Screenshot for visual verification
powerbi-desktop screenshot

# Check status
powerbi-desktop status
```

---

## Included Skills

| Skill | Description | Documentation |
|---|---|---|
| `powerbi-report-authoring` | Create and edit visuals, filters, formatting, and expressions | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-authoring-skill-overview) |
| `powerbi-report-design` | Design principles, layout, accessibility, and UX | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-design-skill-overview) |
| `powerbi-report-planning` | Planning and requirements analysis | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-planning-skill-overview) |
| `powerbi-report-management` | Version management and operations | [GitHub](https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring/skills) |
| `semantic-model-authoring` | Data modeling, DAX, TMDL, and naming conventions | [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/developer/agentic/semantic-model-authoring-skill-overview) |
| `rode-o-bpa` | Best Practice Analyzer with official Microsoft rules | [Tabular Editor Docs](https://docs.tabulareditor.com/features/using-bpa.html) |
| `check-updates` | Repository update checking | -- |

---

## Attributions and Licenses

This project uses the [MIT](LICENSE) license. It also includes third-party components detailed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Attribution details

| Component | Source | Copyright | License |
|---|---|---|---|
| Power BI Skills | [microsoft/skills-for-fabric](https://github.com/microsoft/skills-for-fabric) | (c) 2026 Microsoft Corporation | MIT ([copy](third-party/microsoft-skills-for-fabric-LICENSE.txt)) |
| BPA Rules | [microsoft/Analysis-Services](https://github.com/microsoft/Analysis-Services) | (c) 2016 Microsoft | MIT ([copy](third-party/microsoft-analysis-services-LICENSE.txt)) |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | Anomaly | MIT |
| npm CLIs | [@microsoft/powerbi-report-authoring-cli](https://www.npmjs.com/package/@microsoft/powerbi-report-authoring-cli), [@microsoft/powerbi-desktop-bridge-cli](https://www.npmjs.com/package/@microsoft/powerbi-desktop-bridge-cli) | Microsoft | MIT |

### Full references

#### Microsoft Power BI
- Power BI Desktop: https://powerbi.microsoft.com
- PBIP Documentation: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview
- PBIP Semantic Model: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset
- PBIP Report: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report
- Power BI Agentic Overview: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-agentic-overview

#### Microsoft Fabric and Skills
- Skills for Fabric: https://github.com/microsoft/skills-for-fabric
- Install Skills for Fabric: https://learn.microsoft.com/en-us/fabric/fundamentals/skills-for-fabric-install
- Power BI Authoring Plugin: https://github.com/microsoft/skills-for-fabric/tree/main/plugins/powerbi-authoring

#### Model Context Protocol
- MCP Site: https://modelcontextprotocol.io
- MCP GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- MCP Introduction: https://modelcontextprotocol.io/introduction

#### Tabular Editor and BPA
- Tabular Editor: https://tabulareditor.com
- BPA Documentation: https://docs.tabulareditor.com/features/using-bpa.html
- BPA Rules (Tabular Editor): https://github.com/TabularEditor/BestPracticeRules
- BPA Rules (Microsoft): https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- BPA Blog Post: https://tabulareditor.com/blog/best-practice-analyzer-bpa-rules-for-semantic-models

#### Community and Articles
- SQLBI Best Practices: https://www.sqlbi.com/articles/
- PBIR Format Guide: https://lukasreese.com/2026/03/16/what-is-pbir-full-guide-to-power-bi-enhanced-report-format/
- PBIP + Git + CI/CD: https://powerbiconsulting.com/blog/power-bi-project-format-pbip-git-ci-cd
- Power BI Semantic Model Optimization: https://powerbiconsulting.com/blog/power-bi-semantic-model-optimization-complete-guide-2026

---

## License

[MIT](LICENSE)
