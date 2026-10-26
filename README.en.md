# Power BI + OpenCode Accelerator (Windows, local)

Independent accelerator for Power BI PBIP/PBIR/TMDL projects in OpenCode. The default workflow is local and file-based: it does not enable Fabric, Power BI Service, OAuth, publishing, or remote MCP.

> Unofficial project, not affiliated with or endorsed by Microsoft, OpenCode, or Anomaly. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Architecture

| Layer | Purpose | Default |
|---|---|---|
| Skills | Markdown instructions discovered by OpenCode | Enabled |
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

The bootstrap creates `.opencode\skills` and `.opencode\common` junctions so relative `../../common/...` references remain valid. Existing `AGENTS.md`, `opencode.json`, `opencode.jsonc`, and JSONC comments are preserved.

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
- <https://opencode.ai/docs/mcp-servers/>

## Licenses

Project code is [MIT](LICENSE). Microsoft components retain their notices and licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `third-party/`.
