# Power BI + OpenCode Accelerator

[Português](README.md) | [**English**](README.en.md)

Create, validate, and document Power BI PBIP/PBIR/TMDL projects from files, with controlled Desktop operations only when they are actually needed.

> Unofficial project, not affiliated with or endorsed by Microsoft, OpenCode, or Anomaly. See the [third-party notices](THIRD_PARTY_NOTICES.md).

| Start here | Expected result |
|---|---|
| [**I want to install from scratch**](#install-from-scratch) | Installed Accelerator, prepared project, and validated first demo |
| [**I want to validate an existing PBIP**](#validate-existing-pbip) | File-based diagnosis, evidence, and next steps without changing the project |
| [**I want to create a dashboard proposal from data**](#create-dashboard-proposal) | Separate PBIP prototype with documented measures, sources, and assumptions |

<a id="install-from-scratch"></a>
## I want to install from scratch

You need Windows PowerShell 5.1+, Git, Node.js 20+, npm, and OpenCode on `PATH`. Power BI Desktop is optional for file analysis and required to open, refresh, or visually inspect a result. See the [complete interactive guide](docs/INTERACTIVE-QUICKSTART.en.md#requirements).

### Quick start

The paths below are examples. Replace them with your own directories.

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git `
  "C:\Tools\Opencode_PBI_Accelerator"
Set-Location "C:\Tools\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"

New-Item -ItemType Directory -Path "C:\Projects\PowerBI-First-Result" -Force | Out-Null
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result"
```

The installer validates prerequisites, pinned dependencies, and the payload before applying it; it creates an inventory and backup and installs the local CLIs. The launcher prepares `.opencode`, preserves existing configuration, and opens OpenCode in the project directory.

In OpenCode, run:

```text
/demo-powerbi
```

The demo creates `VendasDemo-Demo` without overwriting an existing directory. Confirm the installation and generated files:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result\VendasDemo-Demo"
```

This flow is offline with respect to Desktop. To open the demo, run the launcher below and choose **Attended**; **Background** records the mode but does not open or activate Desktop.

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projects\PowerBI-First-Result\VendasDemo-Demo" `
  -OpenDesktop
```

<a id="validate-existing-pbip"></a>
## I want to validate an existing PBIP

**When to use it:** before refreshing, publishing, technically reviewing, or delivering an existing PBIP.

**What you get:** an executive summary, Markdown documentation, file-based evidence, and a separate list of anything that still depends on Desktop.

<details>
<summary><strong>Copy the validation prompt</strong></summary>

The paths are fictional and must be replaced.

```text
Use the Accelerator cloned at C:\Tools\Opencode_PBI_Accelerator.
Read the applicable instructions and validate C:\Projects\Sales\Sales.pbip.
Start with offline analysis: check PBIR, TMDL, report-to-model references,
sources, and missing objects. Preserve the project. Produce an executive
summary and Markdown documentation with evidence and next steps. Separate
what was verified from files from what depends on Desktop.
Do not refresh or publish.
```

</details>

<a id="create-dashboard-proposal"></a>
## I want to create a dashboard proposal from data

**When to use it:** when data is available but there is no validated design for indicators and pages yet.

**What you get:** a PBIP prototype in a separate directory, a proposal for indicators, filters, and pages, plus documented measures, sources, and assumptions.

<details>
<summary><strong>Copy the proposal prompt</strong></summary>

The paths are fictional and must be replaced.

```text
Use the Accelerator cloned at C:\Tools\Opencode_PBI_Accelerator.
Inspect the data under C:\Projects\Sales\data: files, columns, types,
grain, and quality. Propose indicators, filters, and pages based on the
questions the data can answer. Create a separate PBIP prototype under
C:\Projects\Sales\proposal and document its measures, sources, and assumptions.
If you cannot render the prototype, state what was validated offline.
Preserve the original data and do not publish.
```

</details>

<details>
<summary><strong>Short example: review cards and drillthrough without refresh</strong></summary>

```text
Use the Accelerator cloned at C:\Tools\Opencode_PBI_Accelerator and review
the cards and drillthrough in C:\Projects\Sales\Sales.pbip without refreshing.
Compare the IDs used by the source and detail in the same filter context,
document discrepancies, and preserve the project. Separate PBIR/TMDL evidence
from any visual confirmation that still depends on Desktop.
```

</details>

<a id="execution-modes"></a>
## Attended or Background

| Mode | Use it when | Main limit |
|---|---|---|
| **Attended** | The PBIP must be opened or the visual result must be checked | Refresh, `Ctrl+S`, and Save As remain manual |
| **Background** | Analysis can proceed from files or query an already-open target without taking focus | It does not open, refresh, or save; operations with unknown focus behavior are blocked |

Opening, refreshing, or saving may require switching to attended mode and an explicit user action; the Accelerator does not automate mouse, keyboard, or dialogs.

<a id="client-tracks"></a>
## Where to run the prompt

| Client | How to use it | Accelerator support |
|---|---|---|
| **OpenCode** | Open the project through the launcher and paste the prompt into the conversation; `/demo-powerbi` is available | Primary integration, tested through CLI/files |
| **Claude Code** | Open a terminal in the project directory, run `claude`, and paste the prompt with the clone path | Untested; manual instruction reading and CLI use |
| **Codex CLI** | Open a terminal in the project directory, run `codex`, and paste the prompt with the clone path | Untested; manual instruction reading and CLI use |
| **VS Code** | Open the folder and paste the prompt into the chosen assistant extension's chat, such as GitHub Copilot Chat | VS Code alone does not run prompts; integration is untested |

The OpenCode installer does not configure other clients, and `/demo-powerbi` is not available in them. See commands, files to read, the CLI fallback, and optional MCP only for OpenCode in the [client guide](docs/INTERACTIVE-QUICKSTART.en.md#client-tracks).

<details>
<summary><strong>Scope, evidence, and versions</strong></summary>

- The default workflow is local and file-based; Fabric, publishing, OAuth, and remote MCP are out of scope.
- Static validation, a connected Bridge, a loaded model, and a visual result are different forms of evidence.
- Bridge 1.0.0 does not provide Save, Save As, or complete PBIX/PBIP export.
- 36 Node tests, 124 transactional checks, and a live Windows smoke test with session isolation and focus preservation were validated.
- Tested versions and pinned dependencies are listed in the [interactive guide](docs/INTERACTIVE-QUICKSTART.en.md#requirements).

</details>

<a id="documentation"></a>
## Documentation

- [From zero to the first result and client tracks](docs/INTERACTIVE-QUICKSTART.en.md)
- [Desktop integration, commands, and troubleshooting](docs/POWERBI-DESKTOP-INTEGRATION.md) (Portuguese)
- [Bundled demo and expected totals](examples/VendasDemo/README.md) (Portuguese)
- [Manual public-data smoke test](tests/manual/powerbi-open-data-smoke.md) (Portuguese)
- [OpenCode `/demo-powerbi` command](.opencode/commands/demo-powerbi.md) (Portuguese)
- [Third-party notices and licenses](THIRD_PARTY_NOTICES.md)

To contribute, open an [issue](https://github.com/flrodrigues21/Opencode_PBI_Accelerator/issues), keep local artifacts out of Git, and submit a pull request with clear scope and evidence. Code is licensed under [MIT](LICENSE).
