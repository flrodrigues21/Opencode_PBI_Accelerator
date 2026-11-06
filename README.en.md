# Power BI + OpenCode Accelerator

[Português](README.md) | [**English**](README.en.md)

The Accelerator prepares OpenCode to safely create, validate, and operate local Power BI PBIP/PBIR/TMDL projects for BI analysts and developers who want file-based automation with controlled Desktop interventions.

> Unofficial project, not affiliated with or endorsed by Microsoft, OpenCode, or Anomaly. See the [third-party notices](THIRD_PARTY_NOTICES.md).

## Quick start

In Windows PowerShell:

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git
Set-Location ".\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"

& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath (Get-Location).Path
```

In OpenCode, create the first independent demo copy:

```text
/demo-powerbi
```

The default destination is `VendasDemo-Demo`; an existing directory is never overwritten. To prepare the generated project and choose how Desktop should open:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath ".\VendasDemo-Demo" `
  -OpenDesktop
```

The launcher asks whether the task should run attended or in the background. The demo contains self-contained fictional data and verifiable totals; see the [VendasDemo documentation](examples/VendasDemo/README.md).

## Execution modes

| Mode | When to use it | What works | User intervention |
|---|---|---|---|
| **Attended** | Initial opening, refresh, save, or visual inspection | Opens the PBIP, resolves path/PID/session, and allows Bridge queries and captures | Refresh, `Ctrl+S`, and Save As remain manual and are requested only when needed |
| **Background** | File validation and safe queries while you use another window | Offline work, `resolve`, capabilities, and Bridge capture of an already open target | None for permitted operations; explicitly switch to attended mode to open, refresh, or save |

Background blocks `open`, refresh, Save, Save As, and every operation whose focus behavior is not classified. It does not automate mouse, keyboard, dialogs, or window activation.

## Validated behavior

- Discovery considers only Power BI processes in the interactive Windows session; path, PID, and `SessionId` must match.
- Bridge operations permitted in background mode preserved the foreground window in the live smoke test.
- Multi-page captures and manual interventions use checkpoints; completed work is not repeated when resuming.
- Refresh and `Ctrl+S` are requested once per checkpoint and marked complete only after explicit confirmation.
- Bridge 1.0.0 does not provide Save, Save As, or complete PBIX/PBIP export; these actions are not advertised as automated.

Detailed commands, structured states, and troubleshooting are in [Safe Power BI Desktop integration](docs/POWERBI-DESKTOP-INTEGRATION.md) (Portuguese).

## Prerequisites and tested versions

| Component | Minimum requirement or scope | Version tested on this branch |
|---|---|---|
| Windows | Windows with PowerShell 5.1 and junction support | Windows 11, build `26100` |
| Windows PowerShell | `5.1+` | `5.1.26100.33648` |
| Git for Windows | Required; no pinned minimum | `2.55.0.windows.3` |
| Node.js | `20+` | `24.15.0` |
| npm | Included with Node.js | `11.12.1` |
| OpenCode | Required; no pinned minimum | `1.19.4` |
| Power BI Desktop | Optional for files; required for Bridge and visual validation | `2.159.883.0 (26.10)` |
| Tabular Editor | Optional, only for BPA | Not exercised in this branch's smoke test |

Installation and updates require network access for Git and npm. Azure CLI, Azure login, Fabric, Power BI Service, gateways, and customer credentials are not required for the local file-based workflow. A cloud LLM provider may require separate network access.

### Pinned dependencies

| Component | Version |
|---|---|
| `microsoft/skills-for-fabric` | `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` |

The installer uses only the official `plugins/powerbi-authoring` plugin needed for the local workflow and keeps Modeling MCP disabled by default.

## Public-data example

The manual smoke test created two disposable copies of a **Programa Mais Médicos** dashboard with a KPI, time series, state comparison, and filters. The source was transformed outside Git, and the latest-period totals were checked independently against the raw CSV and the aggregate: Brazil `26,646` and São Paulo `3,394`.

The scenario validated both modes, session isolation, focus behavior, manual refresh, `Ctrl+S`, persistence after reopening, and checkpoint resume. Downloads, PBIPs, caches, and screenshots are not versioned.

To repeat the scenario with another public source, follow [`tests/manual/powerbi-open-data-smoke.md`](tests/manual/powerbi-open-data-smoke.md) (Portuguese).

## Project languages and formats

| Language/format | Role in the project |
|---|---|
| PowerShell | Transactional installer, rollback, launcher, diagnostics, demo preparation, and integration tests |
| JavaScript (Node.js ES modules) | Desktop Bridge adapter, focus policy, target identity, checkpoints, and unit tests |
| Windows Batch | Thin wrappers for installed commands and process fixtures |
| Markdown | READMEs, skills, OpenCode commands, agent template, and manual test procedures |
| TMDL, DAX, and Power Query M | Semantic model, measures, and self-contained Power BI demo data |
| JSON/PBIR/PBIP | Report metadata, manifests, rules, fixtures, and Power BI project definitions |

## Architecture and limits

- The installer validates the payload in staging, runs `npm ci`, creates an inventory and backup, and automatically rolls back apply failures.
- The bootstrap creates `.opencode/skills` and `.opencode/common` junctions, adds `/demo-powerbi` when absent, and preserves existing `AGENTS.md`, commands, and configuration.
- The default workflow is local and file-based. Fabric, publishing, OAuth, and remote MCP are outside its scope.
- Local Modeling MCP is opt-in through `-EnableModelingMcp`; the launcher uses a temporary configuration and does not edit `opencode.json` or `opencode.jsonc`.
- Static validation, a connected Bridge, a loaded model, and a visual result are distinct forms of evidence.

Run the installer again to update. Backups are stored under `<InstallRoot>\backups`; the rollback command is printed at the end and is also available in `Restore-PowerBI-OpenCodeAccelerator.ps1`.

## Documentation

- [Desktop integration, commands, and troubleshooting](docs/POWERBI-DESKTOP-INTEGRATION.md) (Portuguese)
- [Bundled demo and expected totals](examples/VendasDemo/README.md) (Portuguese)
- [Manual public-data smoke test](tests/manual/powerbi-open-data-smoke.md) (Portuguese)
- [OpenCode `/demo-powerbi` command](.opencode/commands/demo-powerbi.md) (Portuguese)
- [Third-party notices and licenses](THIRD_PARTY_NOTICES.md)

## Tests

```powershell
node --test ".\tests\powerbi-desktop-safe.test.mjs"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tests\Run-Tests.ps1"
git diff --check
```

On `feat/powerbi-execution-modes`, 36 Node tests, the complete transactional suite, and the live Windows smoke test described above were validated.

## Contributing

Open an [issue](https://github.com/flrodrigues21/Opencode_PBI_Accelerator/issues) for bugs or proposals. To contribute code, create a branch, keep local artifacts out of Git, run the tests above, and submit a pull request with a clear scope and validation evidence.

## License

Project code is [MIT](LICENSE). Microsoft components retain their attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [`third-party/`](third-party/).
