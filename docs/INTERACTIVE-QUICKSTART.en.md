# From zero to the first result

[Português](INTERACTIVE-QUICKSTART.md) | [**English**](INTERACTIVE-QUICKSTART.en.md) | [Back to the home page](../README.en.md)

This guide explains how to install the Accelerator, confirm the installation, and use the same files and CLIs with different assistants. The paths are examples and must be replaced.

1. [Prepare the environment](#requirements)
2. [Install and confirm](#install-and-confirm)
3. [Choose the execution mode](#execution-modes)
4. [Open the chosen client](#client-tracks)
5. [Know when Desktop is required](#desktop-boundary)

<a id="requirements"></a>
## 1. Prepare the environment

### Requirements

| Component | Minimum requirement or scope | Tested version |
|---|---|---|
| Windows | PowerShell 5.1 and junction support | Windows 11, build `26100` |
| Windows PowerShell | `5.1+` | `5.1.26100.33648` |
| Git for Windows | Required | `2.55.0.windows.3` |
| Node.js | `20+` | `24.15.0` |
| npm | Included with Node.js | `11.12.1` |
| OpenCode | Required for the primary integration | `1.19.4` |
| Power BI Desktop | Optional for files; required for Bridge and visual validation | `2.159.883.0 (26.10)` |
| Tabular Editor | Optional, only for BPA | Not exercised in the smoke test |

Installation and updates require network access for Git and npm. Azure CLI, Azure login, Fabric, Power BI Service, gateways, and customer credentials are not required for the local file-based flow. The selected LLM provider may require separate network access.

The installer pins these dependencies:

| Component | Version |
|---|---|
| `microsoft/skills-for-fabric` | `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` |

<a id="install-and-confirm"></a>
## 2. Install and confirm

### Clone and install

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git `
  "C:\Tools\Opencode_PBI_Accelerator"
Set-Location "C:\Tools\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

The installer:

- checks Git, Node.js 20+, npm, and OpenCode;
- validates the Microsoft source at the pinned commit;
- runs `npm ci` in staging;
- creates an inventory and backup before applying changes;
- installs skills, commands, templates, and CLIs under `InstallRoot`;
- automatically rolls back an apply failure.

It does not install Power BI Desktop, Claude Code, Codex, VS Code, or editor extensions.

### Prepare a working directory

Use a directory other than the clone so junctions, shortcuts, and demos are not generated in the source repository.

```powershell
New-Item -ItemType Directory -Path "C:\Projects\PowerBI-First-Result" -Force | Out-Null

& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result" `
  -InitializeOnly
```

The launcher creates or preserves:

- `.opencode\skills` and `.opencode\common` junctions to the installation;
- `.opencode\commands\demo-powerbi.md`, without replacing an existing command;
- `AGENTS.md`, only when absent;
- `Abrir-PowerBI-OpenCode.ps1` and `.cmd`, only when absent.

An existing `AGENTS.md` is preserved, not merged. Conflicting local skills/common directories require `-Force` and are moved to a backup.

### Confirm the installation

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result"
```

The diagnostic checks the inventory, skills, Markdown dependencies, npm versions, PowerShell syntax, and any PBIP/PBIR/TMDL files it finds. Without `-TestBridge`, it does not open or query Desktop and ends by reporting that visual validation was not executed.

### Create the first demo

Start OpenCode in the prepared directory:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result"
```

Paste into the conversation:

```text
/demo-powerbi
```

The command creates `VendasDemo-Demo`, validates structure, references, TMDL, totals, and PBIR when the CLI is available. It does not open Desktop, refresh data, or replace an existing destination.

Validate again against the copy:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result\VendasDemo-Demo"
```

<a id="execution-modes"></a>
## 3. Choose the execution mode

When `-OpenDesktop` is used without `-ExecutionMode`, the launcher asks:

```text
How do you want to run this?
1. Attended — Desktop may open and show the steps.
2. Background — keep using your current window while work continues without taking focus.
```

| Operation | Attended | Background |
|---|---:|---:|
| Analyze PBIP/PBIR/TMDL files | Yes | Yes |
| Open a PBIP | Yes | Blocked |
| Query/capture an already-open Bridge target | Yes | Yes |
| Refresh, `Ctrl+S`, or Save As | Manual intervention | Blocked |
| Mouse, keyboard, dialogs, or window activation | Not automated | Not automated |

To choose without a prompt:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result\VendasDemo-Demo" `
  -OpenDesktop `
  -ExecutionMode attended `
  -ExecutionTaskId "first-demo"
```

Replacing `attended` with `background` records the mode and starts OpenCode, but does not open or activate Desktop. In Attended mode, refresh, save, and Save As use checkpoints and remain manual; in Background, those requests are blocked instead of taking focus.

<a id="client-tracks"></a>
## 4. Open the chosen client

### OpenCode: primary integration

**Where to open the project:** pass its path through `-ProjectPath` to the launcher.

**Where to paste the prompt:** in the conversation opened by OpenCode.

**How to point to the Accelerator:** the launcher uses the installation at `C:\OpenCode\PowerBI-Accelerator`; mention the clone at `C:\Tools\Opencode_PBI_Accelerator` in a prompt when you want the agent to read the source documentation.

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\Sales"
```

Native project support includes skill discovery through `.opencode`, the `AGENTS.md` template, `/demo-powerbi`, launcher environment variables, and installed CLIs. Automated coverage validates packaging and launcher plumbing; the final response still depends on the selected model/provider.

#### Optional Modeling MCP, only for this track

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\Sales" `
  -EnableModelingMcp
```

The launcher creates a temporary OpenCode configuration for `@microsoft/powerbi-modeling-mcp@1.0.0` and removes it on exit. Configuration generation and resolution are tested with fixtures; a live MCP connection, model identity, and MCP write operation were not proven by the live test. Use it only with the correct Desktop/model open and confirm identity before writing.

### Claude Code: instruction reading and CLI, untested

**Where to open the project:** in a terminal in the project directory.

**Where to paste the prompt:** in the session started by the `claude` command.

```powershell
Set-Location "C:\Projects\Sales"
claude
```

In the prompt, provide the clone path and request that it read `README.en.md`, `templates\AGENTS.md`, `C:\OpenCode\PowerBI-Accelerator\skills\<skill>\SKILL.md`, and `docs\POWERBI-DESKTOP-INTEGRATION.md`. Installed CLIs are under `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin`; use full paths because the launcher adds them only to OpenCode's `PATH`. The installer does not create `.claude`, install a Claude plugin, or provide `/demo-powerbi` in this client. This track has not been tested; prefer file analysis and invoke the CLIs explicitly when needed.

### Codex CLI: instruction reading and CLI, untested

**Where to open the project:** in a terminal in the project directory.

**Where to paste the prompt:** in the session started by the `codex` command.

```powershell
Set-Location "C:\Projects\Sales"
codex
```

In the prompt, provide the clone path and the same instruction files, including the installed skill under `C:\OpenCode\PowerBI-Accelerator\skills`. The CLIs are under `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin` and must be called by full path. The Accelerator does not create `.codex` configuration, install skills into Codex, or provide `/demo-powerbi`. This track has not been tested; use the files as context and the scripts/CLIs as explicit tools.

### VS Code: the selected assistant runs the prompt, not the editor

**Where to open the project:** open the target directory.

```powershell
code "C:\Projects\Sales"
```

**Where to paste the prompt:** in the chat panel of the installed assistant extension. For example, if you use **GitHub Copilot Chat**, that extension receives and runs the prompt; VS Code alone does not run prompts.

Include the clone path and `C:\OpenCode\PowerBI-Accelerator\skills` in the prompt and explicitly request that the instructions be read. The installer does not configure VS Code, Copilot, or another assistant. No VS Code extension has been tested with the Accelerator; if the assistant cannot run commands, analyze the files and run the CLIs from `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin` by full path in a separate terminal.

### Common file and CLI fallback

Regardless of the client, run the installed validation directly:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\Sales"
```

This does not turn other clients into native integrations; it only provides reproducible file-based evidence.

<a id="desktop-boundary"></a>
## 5. Know when Desktop is required

### Can proceed without Desktop

- install, update, and restore the Accelerator;
- prepare a project and create the demo;
- inspect PBIP, PBIR, TMDL, DAX, Power Query M, and relative references;
- run the standard diagnostic and PBIR validation;
- propose pages, measures, and documentation in a separate copy;
- record checkpoints and work from files in background mode.

### Requires Desktop or an already-open session

- open the PBIP in attended mode;
- obtain Bridge evidence for path, PID, session, or pages;
- capture and inspect rendering;
- manually refresh, press `Ctrl+S`, or use Save As;
- connect Modeling MCP to a real local model.

Background does not remove this dependency: Bridge queries in background require the correct report to be already open.

## Updates and rollback

Run the installer again to update. Backups are stored under `<InstallRoot>\backups`. To restore the latest valid backup:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\Restore-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

## Next steps

- Copy one of the [home-page prompts](../README.en.md#validate-existing-pbip).
- Read [Safe Power BI Desktop integration](POWERBI-DESKTOP-INTEGRATION.md) (Portuguese) before using Bridge, captures, or checkpoints.
- See [VendasDemo](../examples/VendasDemo/README.md) (Portuguese) for its structure and expected totals.
- Use the [public-data procedure](../tests/manual/powerbi-open-data-smoke.md) (Portuguese) only with disposable copies.
