---
name: powerbi-desktop-safe
description: Use when opening, selecting, capturing, saving, or connecting to a local Power BI Desktop report. Enforces path-to-PID target identity, finite serial capture, capability checks, and safe resume behavior.
---

# Power BI Desktop Safe Operations

Use the managed adapter at `$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd`. Do not invoke `powerbi-desktop open` directly from a host command with a shorter timeout.

## Execution mode

Before the first Desktop or Bridge call for a task and target, ask exactly:

```text
Como você quer executar?
1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas.
2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco.
```

Use a stable, non-secret task ID. Pass the choice on the first command as `--task-id <id> --execution-mode attended|background`; later calls must pass the same `--task-id` and omit `--execution-mode` to reuse the checkpoint. Pass a new explicit `--execution-mode` only when the user asks to change modes.

- Without a stored choice, do only offline file inspection. `EXECUTION_MODE_REQUIRED` means no Desktop or Bridge call was made.
- `attended` permits operations that may open or activate Desktop.
- `background` permits only operations classified `BACKGROUND_SAFE` or `OFFLINE`. It blocks `open`, Save As, refresh/save prompts, and every future host operation not yet classified with `FOCUS_POLICY_BLOCKED`. An unsupported CLI command name fails separately with `COMMAND_FAILED`.
- Never work around a focus block with mouse, keyboard, window activation, another shell, or a private API.

## Target identity

1. Treat these as separate states: file launch requested, file confirmed open, Bridge connected, engine available, and MCP connected.
2. Resolve the normalized requested path to the Desktop PID and Bridge before any host operation.
3. Treat `launchedProcessId` only as a candidate. Desktop can forward the file to another process.
4. Never use the first connected Bridge as a fallback. `TARGET_NOT_READY` and `AMBIGUOUS_TARGET` are expected outcomes, not permission to select another report.
5. Limit discovery and selection to the launcher's interactive Windows `SessionId`. Ignore Desktop processes from every other session, even when their paths match.
6. With multiple matching instances in that session, require `--pid` before capture, reload, or any change. Never inspect or alter an unrelated report.
7. Verify the MCP connection belongs to the resolved target before using modeling write tools. The Bridge does not expose the Analysis Services port, so do not claim that Bridge identity proves MCP identity.

## Opening

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" open "C:\Reports\Sales.pbip" --task-id "sales-review" --execution-mode attended --wait-seconds 15
```

- `READY` requires path evidence from `application.state.get/v1`.
- `OPENING` or `TARGET_NOT_READY` means the launcher ran but target readiness is not proven.
- Never repeat `open` automatically after either state. Run `resolve` against the same path.
- Use `--new-attempt` only after explicit evidence that the previous launch failed.
- A shell timeout is not proof that Desktop failed to open.

## PBIR edit batches

Before the first PBIR write for a target, run:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" prepare-pbir-edit "C:\Reports\Sales.pbip" --task-id "sales-review" --execution-mode attended
```

- `PBIR_EDIT_OFFLINE_READY` means the target was not observed in the current interactive session. Finish and validate the whole disk batch before opening Desktop. If `CROSS_SESSION_INSTANCES_IGNORED` is reported, first confirm that no other Windows session owns this project.
- `PBIR_EDIT_TARGET_OPEN` means the exact target is already open. Tell the user that one external-change apply may be needed after the disk batch, not after every edit.
- Reuse the returned PBIR checkpoint for that batch. Do not create a new checkpoint per file or visual.
- Complete PBIR edits and file validation before requesting any Desktop action.
- Only one task may own an active PBIR batch for a target, including while it is `READY_TO_TEST`. Never work around `PBIR_EDIT_OWNED_BY_ANOTHER_TASK` with a different task ID. After successful interaction testing, release ownership with `complete-pbir-review <checkpoint> --tested`. Use `--new-batch` only when the same task intentionally abandons and replaces its current review.

After the PBIR CLI validation succeeds, mark that exact disk batch validated:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" complete-pbir-edit <checkpoint.json> --task-id "sales-review" --validated
```

Without `--validated`, the workflow remains `BATCH_VALIDATION_REQUIRED`. Use `prepare-pbir-edit ... --new-batch` only to explicitly supersede an abandoned batch. It creates a distinct checkpoint and atomically switches the target's authoritative owner pointer; the old status is marked `SUPERSEDED` on a best-effort basis. Stale commands still return `BATCH_SUPERSEDED` with the current checkpoint path. Normal calls reuse the active checkpoint.

Keep these states separate:

1. **Confirmed external PBIP changes**: only after the external-change notice is positively identified, run `request-pbir-review <checkpoint> --notice-type external --notice-confirmed`. The returned action must name the file, reason, project window, and exact **Confirmar e aplicar** action.
2. **Pending Power Query changes**: run `request-pbir-review <checkpoint> --notice-type power-query`. Resolve this state separately; never describe it as an external PBIR notice.
3. **Unsaved Desktop session changes**: `hasUnsavedChanges=true` is evidence only for session work. It does not prove an external-change notice or a Power Query notice. Request `--notice-type session-unsaved --session-changes-need-save` only when new session work is known to require persistence.
4. **Unknown notice type**: use `--notice-type unknown`. State that the type is unknown and issue neither Apply nor Ctrl+S guidance.
5. **No notice**: use `--notice-type none`, then resume with the resolved PID. The batch becomes ready only after that target read succeeds.

`request-pbir-review` is foreground-required and is blocked in background mode. Repeating it for the same batch returns the waiting checkpoint without repeating the user action.

After the user completes the exact action, resume once:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume-pbir-review <checkpoint.json> --completed --pid 1234 --task-id "sales-review"
```

The resume performs one target read. A confirmed external apply or confirmed no-notice state returns `READY_TO_TEST`; resolving Power Query or session-save work returns to `BATCH_VALIDATED` so any remaining external notice can still be classified. Test interactions only after `READY_TO_TEST`. Do not reload again when the revision is already applied, and do not request Ctrl+S unless new session work is known to need persistence. Repeating the same resume does not read or reload the target again. If the read fails or uses the wrong PID, fix the cause and use `--retry-target-read` explicitly; never retry it automatically.

After the revision, data, and interactions are visibly correct with no new notice, run:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" complete-pbir-review <checkpoint.json> --task-id "sales-review" --tested
```

Without `--tested`, ownership remains active and the command returns `INTERACTION_VALIDATION_REQUIRED`.

Every PBIR continuation must pass the same explicit `--task-id`; a checkpoint path alone does not grant task ownership. If a command returns `PBIR_EDIT_STALE_LOCK`, verify that `staleOwnerPid` is absent and that no Accelerator process uses the target. Only then remove exactly `lockPath` and retry. Never delete or replace that lock automatically.

## Capabilities

Run `capabilities <report> --pid <pid>` once for a resolved Desktop PID. Reuse its checkpoint for the session/version instead of probing repeatedly.

The supported Bridge methods in version 1.0.0 are application state, file reload, and report snapshot. Save, Save As, and complete PBIX-to-PBIP export are not exposed. `ExportTMDL` exports semantic model metadata only and is not a complete report export.

When Save As or complete export is requested, run `save-as <source> <destination>`. Return `UNSUPPORTED_CAPABILITY`, present its single manual action, and resume from the checkpoint after the destination appears. A PBIX `resume --pid` treats the destination as a new target and requires its own explicit mode choice or existing mode checkpoint. Do not automate mouse, keyboard, focus, package reconstruction, or private APIs.

## Capture

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capture-all "C:\Reports\Sales.pbip" --task-id "sales-review" --pid 1234 --output-dir ".\screenshots" --total-seconds 20 --page-seconds 10
```

1. Capture pages serially for exactly one verified PID.
2. Keep total duration below the host timeout and persist each completed page.
3. Never start a parallel command while the PID lock reports `HOST_BUSY`.
4. On a deadline reached between pages, retain completed pages and resume only pending pages.
5. If a request times out in flight, retain the PID quarantine lock. Never send another host command to that PID or repeat a page marked `unknown`; the API has no operation ID or cancellation method.
6. After the old Desktop PID has ended and the target is explicitly resolved to a new PID, resume only pending pages from the same checkpoint. Completed and unknown pages remain skipped.
7. A screenshot failure blocks visual validation only. Continue independent file inspection, PBIR validation, tests, and documentation.
8. If the host protocol requires stopping host calls, stop. Do not retry through MCP, another shell, or another tool.
9. Treat each `captures[].sourceEvidence.captureRepresents=DESKTOP_SESSION` as session evidence. If its `diskAlignment=SESSION_DIFFERS_FROM_DISK`, do not claim that screenshot represents the saved PBIP on disk. The aggregate can be `MIXED` after a resumed capture spans different session states.

## Manual refresh and save

The Bridge does not expose data refresh or save. In `attended` mode, use `request-refresh` or `request-save`; each returns one manual action and a checkpoint. Repeating the request returns the waiting state without asking again. Run `resume <checkpoint> --completed` only after explicit user confirmation. In `background` mode these requests are blocked rather than taking focus.

## Safety

- Do not reload when doing so could discard unsaved user changes.
- Do not end or save a Desktop session automatically.
- Do not print tokens, credentials, environment dumps, pipe payloads, or unrelated report paths.
- State evidence precisely: `FILE_OPEN`, `CONNECTED`, `NOT_EXPOSED`, `NOT_CHECKED`, or the structured failure code returned by the adapter.
