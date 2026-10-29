---
name: powerbi-desktop-safe
description: Use when opening, selecting, capturing, saving, or connecting to a local Power BI Desktop report. Enforces path-to-PID target identity, finite serial capture, capability checks, and safe resume behavior.
---

# Power BI Desktop Safe Operations

Use the managed adapter at `$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd`. Do not invoke `powerbi-desktop open` directly from a host command with a shorter timeout.

## Target identity

1. Treat these as separate states: file launch requested, file confirmed open, Bridge connected, engine available, and MCP connected.
2. Resolve the normalized requested path to the Desktop PID and Bridge before any host operation.
3. Treat `launchedProcessId` only as a candidate. Desktop can forward the file to another process.
4. Never use the first connected Bridge as a fallback. `TARGET_NOT_READY` and `AMBIGUOUS_TARGET` are expected outcomes, not permission to select another report.
5. With multiple matching instances, require `--pid` before capture, reload, or any change. Never inspect or alter an unrelated report.
6. Verify the MCP connection belongs to the resolved target before using modeling write tools. The Bridge does not expose the Analysis Services port, so do not claim that Bridge identity proves MCP identity.

## Opening

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" open "C:\Reports\Sales.pbix" --wait-seconds 15
```

- `READY` requires path evidence from `application.state.get/v1`.
- `OPENING` or `TARGET_NOT_READY` means the launcher ran but target readiness is not proven.
- Never repeat `open` automatically after either state. Run `resolve` against the same path.
- Use `--new-attempt` only after explicit evidence that the previous launch failed.
- A shell timeout is not proof that Desktop failed to open.

## Capabilities

Run `capabilities <report> --pid <pid>` once for a resolved Desktop PID. Reuse its checkpoint for the session/version instead of probing repeatedly.

The supported Bridge methods in version 1.0.0 are application state, file reload, and report snapshot. Save, Save As, and complete PBIX-to-PBIP export are not exposed. `ExportTMDL` exports semantic model metadata only and is not a complete report export.

When Save As or complete export is requested, run `save-as <source> <destination>`. Return `UNSUPPORTED_CAPABILITY`, present its single manual action, and resume from the checkpoint after the destination appears. Do not automate mouse, keyboard, focus, package reconstruction, or private APIs.

## Capture

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capture-all "C:\Reports\Sales.pbip" --pid 1234 --output-dir ".\screenshots" --total-seconds 20 --page-seconds 10
```

1. Capture pages serially for exactly one verified PID.
2. Keep total duration below the host timeout and persist each completed page.
3. Never start a parallel command while the PID lock reports `HOST_BUSY`.
4. On a deadline reached between pages, retain completed pages and resume only pending pages.
5. If a request times out in flight, retain the PID quarantine lock. Never send another host command to that PID or repeat a page marked `unknown`; the API has no operation ID or cancellation method.
6. After the old Desktop PID has ended and the target is explicitly resolved to a new PID, resume only pending pages from the same checkpoint. Completed and unknown pages remain skipped.
7. A screenshot failure blocks visual validation only. Continue independent file inspection, PBIR validation, tests, and documentation.
8. If the host protocol requires stopping host calls, stop. Do not retry through MCP, another shell, or another tool.

## Safety

- Do not reload when doing so could discard unsaved user changes.
- Do not end or save a Desktop session automatically.
- Do not print tokens, credentials, environment dumps, pipe payloads, or unrelated report paths.
- State evidence precisely: `FILE_OPEN`, `CONNECTED`, `NOT_EXPOSED`, `NOT_CHECKED`, or the structured failure code returned by the adapter.
