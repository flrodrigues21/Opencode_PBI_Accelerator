# Power BI + OpenCode Accelerator (Windows, local)

Independent accelerator for Power BI PBIP/PBIR/TMDL projects in OpenCode. The default workflow is local and file-based: it does not enable Fabric, Power BI Service, OAuth, publishing, or remote MCP.

> Unofficial project, not affiliated with or endorsed by Microsoft, OpenCode, or Anomaly. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Architecture

| Layer | Purpose | Default |
|---|---|---|
| Skills | Markdown instructions discovered by OpenCode | Enabled |
| `/demo-powerbi` command | Creates an independent copy of the bundled demo | Enabled |
| npm CLIs | PBIR authoring/validation and Desktop bridge | Installed locally |
| Power BI Modeling MCP | Modeling tools for Desktop/local models | Disabled; opt-in |

The installer copies only Microsoft's local-focused `plugins/powerbi-authoring` plugin: `powerbi-report-cli`, `semantic-model-authoring`, and their complete `common/` dependencies. It does not install the broader cloud-focused `fabric-skills` bundle. Custom `rode-o-bpa` and `check-updates` skills remain included, and unknown skills already under `<InstallRoot>\skills` are preserved.

## Pinned Versions

| Component | Version/SHA |
|---|---|
| `microsoft/skills-for-fabric` | tag `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` (Node `>=20`) |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` (Node `>=20`) |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` (Node `>=18`) |

The previous pin, `ac156d284ab8e51f121af3f42303ea79c88cdab5`, predates 15 commits and releases `v0.3.13` through `v0.3.19`. The four former report skills were consolidated into `powerbi-report-cli`. Microsoft's `.mcp.json` still uses `@latest`; this accelerator does not import it and pins MCP `1.0.0` instead.

Official comparison: <https://github.com/microsoft/skills-for-fabric/compare/ac156d284ab8e51f121af3f42303ea79c88cdab5...bc42aaf734771bf752c1d7082dd91e5a6ca72b9f>

## Requirements

The local workflow requires Windows PowerShell 5.1+, Git, Node.js 20+ with npm, and OpenCode. Power BI Desktop is only required for bridge or visual tests. Tabular Editor is only required for BPA.

Azure CLI, Azure login, Fabric capacity/license, workspaces, and Power BI Service are not required for the file-only workflow. They apply only to optional cloud scenarios outside the default scope.

## Quick Start: Clone And Request A Demo

Actual prerequisites: Windows PowerShell 5.1+, Git, Node.js 20+ with npm, and OpenCode. Power BI Desktop is required only to open and visually inspect the report. Installation uses network access for Git/npm, and OpenCode needs network access when configured with a cloud LLM provider. Azure, Fabric, Power BI Service, customer credentials, and gateways are not required.

In PowerShell:

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git
Set-Location ".\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass
& ".\Install-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath (Get-Location).Path
```

In OpenCode, run `/demo-powerbi`. Without an argument, the safe destination is `VendasDemo-Demo` under the current directory; if it already exists, the command asks for another path and never overwrites it. You can also provide a new destination:

```text
/demo-powerbi "C:\Power BI Demos\My VendasDemo"
```

Or use this ready-made prompt:

> Crie uma demo Power BI do zero com dados fictícios, usando o exemplo VendasDemo e as skills deste acelerador. Prepare uma cópia independente, valide os arquivos e me diga qual PBIP abrir.

The canonical source is [`examples/VendasDemo`](examples/VendasDemo). The copy contains 120 sales and expects 360 units, R$720,000.00 revenue, R$503,400.00 cost, R$216,600.00 profit, and a 30.0833% margin. The command validates files, relative references, and totals; when the CLI is installed, it also validates PBIR. It does not claim model loading or visual validation.

Open the reported `VendasDemo.pbip` in Power BI Desktop. Because the copy does not distribute a local cache, Desktop may initially show empty tables; if so, perform one manual refresh, inspect the `Visão Geral` page, and save. All data is fictional and self-contained in Power Query M `#table` expressions: no external sources, customer data, credentials, cloud resources, or publishing are used.

## Install Or Update

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ".\Install-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

The same command performs a clean install or idempotent update. It downloads and validates the pinned source in staging, runs `npm ci` in staging, creates a managed-file inventory and backup, then applies the payload. Apply failures trigger automatic rollback. Unknown files and custom skills are preserved; unknown destination collisions fail unless explicitly reviewed and retried with `-Force`.

Backups are stored under `<InstallRoot>\backups`. Restore the latest one with:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\Restore-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

## OpenCode And MCP

OpenCode discovers skills under `.opencode\skills` and commands under `.opencode\commands`. The repository exposes `/demo-powerbi` directly; the bootstrap copies it into prepared projects only when no same-name command exists. Custom commands are never replaced. Junctions are used only for `.opencode\skills` and `.opencode\common`, so relative `../../common/...` references remain valid. Existing `AGENTS.md`, `opencode.json`, `opencode.jsonc`, and JSONC comments are preserved.

### Backend-First Execution

The `AGENTS.md` created for new projects tells OpenCode to prioritize files, scripts, CLIs, local APIs, and programmatic queries. Power BI Desktop UI work is reserved for operations that require it, preferably in one final batch after file validation.

The policy also requires:

- verifiable terminal progress using `[ETAPA x/y]`, `[OK]`, `[AVISO]`, and `[PROXIMO]` markers;
- explicit timeouts and at most one justified retry for external commands, bridge, and MCP;
- never terminating Desktop processes to unblock automation;
- preserving unsaved changes before any reload;
- distinguishing generated files, validated structure, executed queries, and visually confirmed results.

The bootstrap preserves an existing `AGENTS.md`. The policy therefore applies automatically to new projects; for projects already initialized, merge the template's `Execucao Backend Primeiro` section without removing local instructions.

Prepare and open a project:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\path\Project"
```

The same backend used by `/demo-powerbi` can create a demo without entering OpenCode. The destination must be new:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath (Get-Location).Path -PrepareDemo -DemoDestination "C:\Power BI Demos\My VendasDemo"
```

OpenCode does not automatically import another client's `.mcp.json`. To opt into the pinned local Modeling MCP for one OpenCode invocation:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\path\Project" -EnableModelingMcp
```

The launcher creates a temporary official-shape OpenCode config and never edits personal config files. It refuses to override an existing `OPENCODE_CONFIG`. Microsoft EULA acceptance may still be required.

## Safe Smoke Test

Diagnostics are read-only by default:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\path\Project"
```

Optional bridge test with finite attempts and timeout:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\path\Project" -TestBridge -BridgeTimeoutSeconds 5 -BridgeAttempts 2
```

Prepare an isolated copy at a new destination:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\Reports\Project" -PrepareCopy -CopyDestination "C:\Reports\Project-Smoke"
```

The test never performs refresh, reload, screenshots, publishing, or visual validation automatically. A disconnected bridge is reported and file checks continue. The original PBIP/PBIR/TMDL content, sources, credentials, relationships, and measures are not modified.

## Offline Limits

Git/npm installation and updates require network access. Installed skills and CLIs are local, but cloud LLM providers still require network access; fully offline OpenCode use requires an already configured local model provider. File validation is not equivalent to a connected bridge or visual Desktop validation.

## Repository Tests

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tests\Run-Tests.ps1"
git diff --check
```

Tests use fixtures and temporary directories, never user reports. Live Desktop and visual validation remain manual.

## Official References

- <https://learn.microsoft.com/en-us/fabric/fundamentals/skills-for-fabric-install>
- <https://github.com/microsoft/skills-for-fabric>
- <https://github.com/microsoft/powerbi-modeling-mcp>
- <https://opencode.ai/docs/skills/>
- <https://opencode.ai/docs/commands/>
- <https://opencode.ai/docs/mcp-servers/>

## Licenses

Project code is [MIT](LICENSE). Microsoft components retain their notices and licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `third-party/`.
