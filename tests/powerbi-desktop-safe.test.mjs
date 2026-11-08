import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_METHODS,
  FileStateStore,
  authorizeExecution,
  captureAll,
  completePbirEditBatch,
  completePbirReview,
  confirmPbixSaveWithDesktop,
  inspectCapabilities,
  openTarget,
  pathsEqual,
  preparePbirEdit,
  requestManualIntervention,
  requestPbirReviewIntervention,
  resolveTarget,
  resumeCheckpoint,
  resumePbirReview,
  selectTarget,
  unsupportedSaveAs,
} from "../lib/powerbi-desktop-safe.mjs";

function reportDirFor(target) {
  if (!target.toLowerCase().endsWith(".pbip")) return null;
  return path.join(path.dirname(target), `${path.basename(target, path.extname(target))}.Report`);
}

function connected(pid, currentFilePath, pages = []) {
  return {
    pid,
    sessionId: 6,
    bridgeStatus: "connected",
    currentFilePath,
    reportDir: reportDirFor(currentFilePath),
    hasUnsavedChanges: false,
    pages,
  };
}

function mockRuntime(options = {}) {
  let now = 1_000;
  let statusIndex = 0;
  let identityIndex = 0;
  const statusSequence = options.statusSequence ?? [[]];
  const runtime = {
    platform: "win32",
    sessionId: options.sessionId ?? 6,
    bridgeVersion: "1.0.0",
    launchCount: 0,
    captureCalls: [],
    sessionCount: 0,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    resolveReportDir: reportDirFor,
    readDesktopStatus: async ({ pid } = {}) => {
      runtime.statusCount = (runtime.statusCount ?? 0) + 1;
      if (options.statusError) throw options.statusError;
      const selected = statusSequence[Math.min(statusIndex, statusSequence.length - 1)];
      statusIndex += 1;
      const instances = pid === undefined ? selected : selected.filter((instance) => instance.pid === Number(pid));
      runtime.lastInstances = instances;
      return { instances, diagnostics: options.diagnostics ?? [] };
    },
    openDesktop: (target) => {
      runtime.launchCount += 1;
      if (options.openError) throw options.openError;
      return {
        executablePath: "C:\\Program Files\\Microsoft Power BI Desktop\\bin\\PBIDesktop.exe",
        reportPath: target,
        launchedProcessId: 777,
      };
    },
    openSession: async ({ pid }) => {
      runtime.sessionCount += 1;
      return {
        pid: Number(pid),
        manifest: {
          methods: (options.methods ?? Object.values(BRIDGE_METHODS)).map((name) => ({ name })),
        },
        getApplicationState: async () => {
          if (options.identity === "pending") return new Promise(() => {});
          if (options.applicationStateSequence) {
            const state = options.applicationStateSequence[
              Math.min(identityIndex, options.applicationStateSequence.length - 1)
            ];
            identityIndex += 1;
            return { ...state };
          }
          const instance = runtime.lastInstances?.find((item) => item.pid === Number(pid));
          const state = { currentFilePath: options.identity ?? instance?.currentFilePath };
          if (Object.prototype.hasOwnProperty.call(instance ?? {}, "hasUnsavedChanges")) {
            state.hasUnsavedChanges = instance.hasUnsavedChanges;
          }
          return state;
        },
        captureScreenshot: async (request) => {
          runtime.captureCalls.push(request.page);
          if (options.capture?.[request.page] === "pending") return new Promise(() => {});
          if (options.capture?.[request.page] instanceof Error) throw options.capture[request.page];
          if (options.writeCaptures) {
            fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });
            fs.writeFileSync(request.outputPath, request.page, "utf8");
          }
          return { page: request.page, path: request.outputPath, pid: Number(pid), mimeType: "image/png" };
        },
        dispose: () => {},
      };
    },
  };
  return runtime;
}

function withStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbi-safe-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new FileStateStore(root);
}

test("requires and persists one execution mode per task and target", (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Mode.pbip";
  const missing = authorizeExecution(store, target, { operation: "resolve", taskId: "task-one" });
  assert.equal(missing.status, "EXECUTION_MODE_REQUIRED");
  assert.match(missing.prompt.join("\n"), /Como você quer executar/);

  const selected = authorizeExecution(store, target, {
    operation: "resolve",
    taskId: "task-one",
    mode: "background",
    now: 1_000,
  });
  assert.equal(selected.status, "EXECUTION_MODE_READY");
  assert.equal(selected.execution.mode, "background");
  assert.equal(fs.existsSync(selected.execution.checkpointPath), true);

  const reused = authorizeExecution(store, target, { operation: "resolve", taskId: "task-one", now: 2_000 });
  assert.equal(reused.execution.reused, true);
  assert.equal(reused.execution.mode, "background");

  const changed = authorizeExecution(store, target, {
    operation: "resolve",
    taskId: "task-one",
    mode: "attended",
    now: 3_000,
  });
  assert.equal(changed.execution.changed, true);
  assert.equal(changed.execution.mode, "attended");

  fs.writeFileSync(changed.execution.checkpointPath, JSON.stringify({ mode: "not-a-mode" }), "utf8");
  const invalid = authorizeExecution(store, target, { operation: "open", taskId: "task-one" });
  assert.equal(invalid.status, "INVALID_EXECUTION_CHECKPOINT");
  const repaired = authorizeExecution(store, target, {
    operation: "resolve",
    taskId: "task-one",
    mode: "background",
  });
  assert.equal(repaired.status, "EXECUTION_MODE_READY");
});

test("background mode blocks foreground and unknown operations", (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Focus.pbix";
  const open = authorizeExecution(store, target, {
    operation: "open",
    taskId: "task-focus",
    mode: "background",
  });
  assert.equal(open.status, "FOCUS_POLICY_BLOCKED");
  assert.equal(open.execution.focusBehavior, "FOREGROUND_REQUIRED");

  const unknown = authorizeExecution(store, target, {
    operation: "future-host-operation",
    taskId: "task-focus",
  });
  assert.equal(unknown.status, "FOCUS_POLICY_BLOCKED");
  assert.equal(unknown.execution.focusBehavior, "UNKNOWN");

  const capture = authorizeExecution(store, target, {
    operation: "capture-all",
    taskId: "task-focus",
  });
  assert.equal(capture.status, "EXECUTION_MODE_READY");
  assert.equal(capture.execution.focusBehavior, "BACKGROUND_SAFE");

  const manualReview = authorizeExecution(store, target, {
    operation: "request-pbir-review",
    taskId: "task-focus",
  });
  assert.equal(manualReview.status, "FOCUS_POLICY_BLOCKED");
});

test("launcher fallback mode seeds once and never overwrites an explicit change", (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\LauncherFallback.pbip";
  const seeded = authorizeExecution(store, target, {
    operation: "resolve",
    taskId: "launcher-task",
    fallbackMode: "attended",
  });
  assert.equal(seeded.execution.mode, "attended");
  assert.equal(seeded.execution.reused, false);

  const changed = authorizeExecution(store, target, {
    operation: "execution-mode",
    taskId: "launcher-task",
    mode: "background",
  });
  assert.equal(changed.execution.changed, true);
  assert.equal(changed.execution.mode, "background");

  const reused = authorizeExecution(store, target, {
    operation: "resolve",
    taskId: "launcher-task",
    fallbackMode: "attended",
  });
  assert.equal(reused.execution.reused, true);
  assert.equal(reused.execution.mode, "background");
});

test("requests refresh or Ctrl+S only once per manual checkpoint", (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Manual.pbip";
  const execution = { taskId: "task-manual", mode: "attended", focusBehavior: "FOREGROUND_REQUIRED" };
  const first = requestManualIntervention(store, target, "save", { execution, now: 1_000 });
  assert.equal(first.status, "MANUAL_ACTION_REQUIRED");
  assert.match(first.manualAction, /Ctrl\+S once/);

  const repeated = requestManualIntervention(store, target, "save", { execution, now: 2_000 });
  assert.equal(repeated.status, "WAITING_FOR_MANUAL_ACTION");
  assert.equal(repeated.manualAction, undefined);
  assert.equal(repeated.requestRepeated, false);

  const completed = resumeCheckpoint(first.checkpointPath, { completed: true, now: 3_000, store });
  assert.equal(completed.status, "READY_TO_RESUME");
  assert.equal(completed.manualActionRepeated, false);

  const next = requestManualIntervention(store, target, "save", { execution, now: 4_000 });
  assert.equal(next.status, "MANUAL_ACTION_REQUIRED");
  assert.notEqual(next.checkpointPath, first.checkpointPath);

  const lockedTarget = path.join(store.root, "Locked.pbip");
  const lockKey = `task-manual|${path.resolve(lockedTarget).toLocaleLowerCase("en-US")}|refresh`;
  store.acquire("manual-lock", lockKey, { pid: process.pid, uncertain: false });
  const locked = requestManualIntervention(store, lockedTarget, "refresh", { execution });
  assert.equal(locked.status, "MANUAL_ACTION_IN_PROGRESS");
  assert.equal(locked.manualAction, undefined);
  store.release("manual-lock", lockKey);
});

test("prepares a closed PBIR target for one offline disk batch", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ClosedDuringEdit.pbip";
  const runtime = mockRuntime({ statusSequence: [[], [connected(409, target)], []] });
  const result = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "closed-edit", mode: "background" },
  });
  assert.equal(result.status, "PBIR_EDIT_OFFLINE_READY");
  assert.equal(result.desktop.open, false);
  assert.match(result.detail, /entire disk batch before opening/i);
  assert.equal(runtime.statusCount, 1);

  const validationRequired = completePbirEditBatch(store, result.checkpointPath);
  assert.equal(validationRequired.status, "BATCH_VALIDATION_REQUIRED");
  const completed = completePbirEditBatch(store, result.checkpointPath, { validated: true });
  assert.equal(completed.status, "BATCH_VALIDATED");
  const validatedReuse = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "closed-edit", mode: "background" },
  });
  assert.equal(validatedReuse.status, "BATCH_VALIDATED");
  assert.equal(validatedReuse.editAllowed, false);
  assert.equal(runtime.statusCount, 1);
  const noNotice = requestPbirReviewIntervention(store, result.checkpointPath, "none");
  assert.equal(noNotice.status, "TARGET_CONFIRMATION_REQUIRED");
  const repeatedNoNotice = requestPbirReviewIntervention(store, result.checkpointPath, "none");
  assert.equal(repeatedNoNotice.status, "TARGET_CONFIRMATION_REQUIRED");
  assert.equal(repeatedNoNotice.manualAction, undefined);
  const pendingTarget = await resumePbirReview(runtime, store, result.checkpointPath);
  assert.equal(pendingTarget.status, "TARGET_CONFIRMATION_REQUIRED");
  assert.equal(runtime.statusCount, 1);
  const confirmedTarget = await resumePbirReview(runtime, store, result.checkpointPath, {
    completed: true,
    pid: 409,
  });
  assert.equal(confirmedTarget.status, "READY_TO_TEST");
  assert.equal(confirmedTarget.targetReadChecks, 1);

  const readyReuse = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "closed-edit", mode: "background" },
  });
  assert.equal(readyReuse.status, "READY_TO_TEST");
  assert.equal(readyReuse.reused, true);
  assert.equal(readyReuse.editAllowed, false);
  assert.equal(runtime.statusCount, 2);

  const replacement = await preparePbirEdit(runtime, store, target, {
    newBatch: true,
    execution: { taskId: "closed-edit", mode: "background" },
  });
  assert.equal(replacement.reused, false);
  assert.notEqual(replacement.batchId, result.batchId);
  assert.equal(runtime.statusCount, 3);
});

test("does not classify an unobservable Desktop target as closed", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Disconnected.pbip";
  const runtime = mockRuntime({
    statusSequence: [[{
      pid: 410,
      sessionId: 6,
      bridgeStatus: "disconnected",
      currentFilePath: null,
      reportDir: null,
    }]],
  });
  const result = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "disconnected-edit", mode: "background" },
  });
  assert.equal(result.status, "PBIR_EDIT_STATE_UNKNOWN");
  assert.equal(result.checkpointPath, undefined);
});

test("does not classify an explicit wrong PID as a closed target", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\WrongPid.pbip";
  const runtime = mockRuntime({ statusSequence: [[connected(410, target)]] });
  const result = await preparePbirEdit(runtime, store, target, {
    pid: 999,
    execution: { taskId: "wrong-pid-edit", mode: "background" },
  });
  assert.equal(result.status, "TARGET_NOT_READY");
  assert.equal(result.checkpointPath, undefined);
});

test("preserves a validated batch when explicit replacement discovery fails", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Replacement.pbip";
  const diagnostics = [];
  const runtime = mockRuntime({ statusSequence: [[], []], diagnostics });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "replacement-edit", mode: "background" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  diagnostics.push({ code: "STATUS_QUERY_TIMEOUT", message: "discovery failed" });

  const replacement = await preparePbirEdit(runtime, store, target, {
    newBatch: true,
    execution: { taskId: "replacement-edit", mode: "background" },
  });
  assert.equal(replacement.status, "PBIR_EDIT_STATE_UNKNOWN");
  const preserved = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  assert.equal(preserved.status, "BATCH_VALIDATED");
});

test("requests one confirmed external apply and resumes with one target read", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ExternalReview.pbip";
  const instance = connected(411, target);
  const runtime = mockRuntime({ statusSequence: [[instance], [instance]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "external-edit", mode: "attended" },
  });
  assert.equal(prepared.status, "PBIR_EDIT_TARGET_OPEN");
  assert.match(prepared.detail, /one confirmed external-change apply/i);

  const beforeValidation = requestPbirReviewIntervention(store, prepared.checkpointPath, "external", {
    noticeConfirmed: true,
  });
  assert.equal(beforeValidation.status, "BATCH_VALIDATION_REQUIRED");
  assert.equal(beforeValidation.manualAction, undefined);
  assert.equal(completePbirEditBatch(store, prepared.checkpointPath, { validated: true }).status, "BATCH_VALIDATED");

  const requested = requestPbirReviewIntervention(store, prepared.checkpointPath, "external", {
    noticeConfirmed: true,
  });
  assert.equal(requested.status, "EXTERNAL_CHANGES_ACTION_REQUIRED");
  assert.match(requested.manualAction, /ExternalReview/);
  assert.match(requested.manualAction, /Confirmar e aplicar/);
  assert.doesNotMatch(requested.manualAction, /Ctrl\+S/);

  const repeated = requestPbirReviewIntervention(store, prepared.checkpointPath, "external", {
    noticeConfirmed: true,
  });
  assert.equal(repeated.status, "WAITING_FOR_MANUAL_ACTION");
  assert.equal(repeated.manualAction, undefined);

  const pendingPreparation = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "external-edit", mode: "attended" },
  });
  assert.equal(pendingPreparation.status, "WAITING_FOR_MANUAL_ACTION");
  assert.equal(pendingPreparation.editAllowed, false);

  const readsBeforeResume = runtime.statusCount;
  const resumed = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 411,
  });
  assert.equal(resumed.status, "READY_TO_TEST");
  assert.equal(resumed.targetReadChecks, 1);
  assert.equal(resumed.reloadAttempted, false);
  assert.equal(runtime.statusCount - readsBeforeResume, 1);

  const readsBeforeRepeat = runtime.statusCount;
  const resumedAgain = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 411,
  });
  assert.equal(resumedAgain.status, "READY_TO_TEST");
  assert.equal(resumedAgain.targetReadChecks, 0);
  assert.equal(runtime.statusCount, readsBeforeRepeat);
});

test("keeps Power Query notice separate and does not repeat its action", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\QueryNotice.pbip";
  const runtime = mockRuntime({ statusSequence: [[connected(412, target)]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "query-edit", mode: "attended" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  const requested = requestPbirReviewIntervention(store, prepared.checkpointPath, "power-query");
  assert.equal(requested.status, "POWER_QUERY_ACTION_REQUIRED");
  assert.match(requested.manualAction, /Power Query/);
  assert.doesNotMatch(requested.manualAction, /Confirmar e aplicar/);
  assert.doesNotMatch(requested.manualAction, /Ctrl\+S/);

  const repeated = requestPbirReviewIntervention(store, prepared.checkpointPath, "power-query");
  assert.equal(repeated.status, "WAITING_FOR_MANUAL_ACTION");
  assert.equal(repeated.manualAction, undefined);

  const resolvedQuery = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 412,
  });
  assert.equal(resolvedQuery.status, "BATCH_VALIDATED");
  const externalStillRequired = requestPbirReviewIntervention(store, prepared.checkpointPath, "external", {
    noticeConfirmed: true,
  });
  assert.equal(externalStillRequired.status, "EXTERNAL_CHANGES_ACTION_REQUIRED");
  assert.match(externalStillRequired.manualAction, /Confirmar e aplicar/);
});

test("reports an unknown PBIR notice without generic Apply or save guidance", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\UnknownNotice.pbip";
  const unsaved = { ...connected(413, target), hasUnsavedChanges: true };
  const runtime = mockRuntime({ statusSequence: [[unsaved]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "unknown-edit", mode: "attended" },
  });
  assert.equal(prepared.desktop.noticeType, "SESSION_UNSAVED");
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });

  const unknown = requestPbirReviewIntervention(store, prepared.checkpointPath, "unknown");
  assert.equal(unknown.status, "NOTICE_TYPE_UNKNOWN");
  assert.equal(unknown.manualAction, undefined);
  assert.match(unknown.detail, /No Apply or Ctrl\+S instruction/);

  const unsavedWithoutIntent = requestPbirReviewIntervention(
    store,
    prepared.checkpointPath,
    "session-unsaved",
  );
  assert.equal(unsavedWithoutIntent.status, "SESSION_CHANGES_DETECTED");
  assert.equal(unsavedWithoutIntent.manualAction, undefined);
  assert.match(unsavedWithoutIntent.detail, /No Ctrl\+S or Apply instruction/);

  const unconfirmedExternal = requestPbirReviewIntervention(
    store,
    prepared.checkpointPath,
    "external",
  );
  assert.equal(unconfirmedExternal.status, "NOTICE_TYPE_UNKNOWN");
  assert.equal(unconfirmedExternal.manualAction, undefined);
});

test("does not repeat a failed one-time target read", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ReadOnce.pbip";
  const instance = connected(414, target);
  const runtime = mockRuntime({ statusSequence: [[instance], []] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "read-once", mode: "attended" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  requestPbirReviewIntervention(store, prepared.checkpointPath, "external", { noticeConfirmed: true });

  const readsBefore = runtime.statusCount;
  const first = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 414,
  });
  assert.equal(first.status, "TARGET_NOT_READY");
  assert.equal(first.targetReadChecks, 1);
  assert.equal(runtime.statusCount - readsBefore, 1);

  const readsBeforeRepeat = runtime.statusCount;
  const repeated = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 414,
  });
  assert.equal(repeated.status, "TARGET_NOT_READY");
  assert.equal(repeated.targetReadChecks, 0);
  assert.equal(runtime.statusCount, readsBeforeRepeat);
});

test("serializes PBIR transitions and rejects a tampered checkpoint identity", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Serialized.pbip";
  const runtime = mockRuntime({ statusSequence: [[]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "serialized-edit", mode: "attended" },
  });
  const lockKey = path.resolve(target).toLocaleLowerCase("en-US");
  store.acquire("pbir-edit-lock", lockKey, { pid: process.pid, uncertain: false });
  const blocked = completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  assert.equal(blocked.status, "PBIR_EDIT_TRANSITION_IN_PROGRESS");
  store.release("pbir-edit-lock", lockKey);

  const checkpoint = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  checkpoint.targetPath = "C:\\Demos\\Other.pbip";
  fs.writeFileSync(prepared.checkpointPath, JSON.stringify(checkpoint), "utf8");
  const tampered = completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  assert.equal(tampered.status, "INVALID_CHECKPOINT");
});

test("allows only one task to own an active PBIR batch per target", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ExclusiveTarget.pbip";
  const runtime = mockRuntime({ statusSequence: [[]] });
  const first = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "first-owner", mode: "background" },
  });
  assert.equal(first.status, "PBIR_EDIT_OFFLINE_READY");

  const conflicting = await preparePbirEdit(runtime, store, target, {
    newBatch: true,
    execution: { taskId: "second-owner", mode: "background" },
  });
  assert.equal(conflicting.status, "PBIR_EDIT_OWNED_BY_ANOTHER_TASK");
  assert.equal(conflicting.checkpointPath, undefined);
  assert.equal(runtime.statusCount, 1);
});

test("keeps target ownership while a batch is ready for interaction tests", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ReadyOwner.pbip";
  const instance = connected(416, target);
  const runtime = mockRuntime({ statusSequence: [[instance], [instance]] });
  const first = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "ready-owner", mode: "attended" },
  });
  completePbirEditBatch(store, first.checkpointPath, { validated: true });
  requestPbirReviewIntervention(store, first.checkpointPath, "external", { noticeConfirmed: true });
  const ready = await resumePbirReview(runtime, store, first.checkpointPath, {
    completed: true,
    pid: 416,
  });
  assert.equal(ready.status, "READY_TO_TEST");

  const conflicting = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "other-ready-task", mode: "attended" },
  });
  assert.equal(conflicting.status, "PBIR_EDIT_OWNED_BY_ANOTHER_TASK");
  assert.equal(requestPbirReviewIntervention(store, first.checkpointPath, "external", {
    noticeConfirmed: true,
  }).status, "READY_TO_TEST");

  const validationRequired = completePbirReview(store, first.checkpointPath);
  assert.equal(validationRequired.status, "INTERACTION_VALIDATION_REQUIRED");
  const completed = completePbirReview(store, first.checkpointPath, { tested: true });
  assert.equal(completed.status, "COMPLETE");
  const completedAgain = completePbirReview(store, first.checkpointPath, { tested: true });
  assert.equal(completedAgain.status, "COMPLETE");
  assert.equal(completedAgain.reused, true);

  const nextOwner = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "other-ready-task", mode: "attended" },
  });
  assert.equal(nextOwner.status, "PBIR_EDIT_TARGET_OPEN");
  const staleCompletion = completePbirReview(store, first.checkpointPath, { tested: true });
  assert.equal(staleCompletion.status, "BATCH_SUPERSEDED");
  assert.equal(staleCompletion.supersededByCheckpointPath, nextOwner.checkpointPath);

  const terminalReplacement = JSON.parse(fs.readFileSync(nextOwner.checkpointPath, "utf8"));
  terminalReplacement.status = "COMPLETE";
  terminalReplacement.completedAt = new Date().toISOString();
  fs.writeFileSync(nextOwner.checkpointPath, JSON.stringify(terminalReplacement), "utf8");
  const staleAfterReplacementCrash = completePbirReview(store, first.checkpointPath, { tested: true });
  assert.equal(staleAfterReplacementCrash.status, "BATCH_SUPERSEDED");
  assert.equal(staleAfterReplacementCrash.supersededByCheckpointPath, nextOwner.checkpointPath);
  const ownerKey = path.resolve(target).toLocaleLowerCase("en-US");
  assert.equal(store.read("pbir-edit-owner", ownerKey), null);
});

test("rejects an invalid active checkpoint instead of reusing it", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\InvalidActive.pbip";
  const runtime = mockRuntime({ statusSequence: [[]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "invalid-active", mode: "background" },
  });
  const checkpoint = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  checkpoint.checkpointId = "";
  fs.writeFileSync(prepared.checkpointPath, JSON.stringify(checkpoint), "utf8");

  const reused = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "invalid-active", mode: "background" },
  });
  assert.equal(reused.status, "INVALID_CHECKPOINT");
  assert.equal(runtime.statusCount, 1);
});

test("rejects intervention state and notice-type mismatches", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\InvalidIntervention.pbip";
  const runtime = mockRuntime({ statusSequence: [[]] });
  const prepared = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "invalid-intervention", mode: "background" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  requestPbirReviewIntervention(store, prepared.checkpointPath, "none");
  const checkpoint = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  checkpoint.intervention.noticeType = "external";
  fs.writeFileSync(prepared.checkpointPath, JSON.stringify(checkpoint), "utf8");

  const invalid = await resumePbirReview(runtime, store, prepared.checkpointPath, {
    completed: true,
    pid: 417,
  });
  assert.equal(invalid.status, "INVALID_CHECKPOINT");
  assert.equal(runtime.statusCount, 1);
});

test("normalizes task IDs for direct PBIR API callers", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\NormalizedOwner.pbip";
  const prepared = await preparePbirEdit(mockRuntime({ statusSequence: [[]] }), store, target, {
    execution: { taskId: " normalized-owner ", mode: "background" },
  });
  const checkpoint = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  assert.equal(checkpoint.taskId, "normalized-owner");
  assert.equal(checkpoint.execution.taskId, "normalized-owner");
});

test("reports a stale PBIR lock and requires guarded manual cleanup", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\StaleLock.pbip";
  const key = path.resolve(target).toLocaleLowerCase("en-US");
  store.write("pbir-edit-lock", key, { pid: 2147483647, uncertain: false });
  const runtime = mockRuntime({ statusSequence: [[]] });
  const blocked = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "stale-lock", mode: "background" },
  });
  assert.equal(blocked.status, "PBIR_EDIT_STALE_LOCK");
  assert.equal(blocked.staleOwnerPid, 2147483647);
  assert.match(blocked.detail, /remove this exact lock file/i);
  assert.equal(JSON.parse(fs.readFileSync(blocked.lockPath, "utf8")).pid, 2147483647);
  store.release("pbir-edit-lock", key);
  const retried = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "stale-lock", mode: "background" },
  });
  assert.equal(retried.status, "PBIR_EDIT_OFFLINE_READY");
});

test("supersedes an active PBIR batch with a distinct managed checkpoint", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\AtomicReplacement.pbip";
  const runtime = mockRuntime({ statusSequence: [[], []] });
  const first = await preparePbirEdit(runtime, store, target, {
    execution: { taskId: "atomic-replacement", mode: "background" },
  });
  completePbirEditBatch(store, first.checkpointPath, { validated: true });
  const second = await preparePbirEdit(runtime, store, target, {
    newBatch: true,
    execution: { taskId: "atomic-replacement", mode: "background" },
  });
  assert.equal(second.status, "PBIR_EDIT_OFFLINE_READY");
  assert.notEqual(second.checkpointPath, first.checkpointPath);
  assert.notEqual(second.batchId, first.batchId);
  const superseded = JSON.parse(fs.readFileSync(first.checkpointPath, "utf8"));
  assert.equal(superseded.status, "SUPERSEDED");
  assert.equal(superseded.supersededByCheckpointPath, second.checkpointPath);
  superseded.status = "BATCH_VALIDATED";
  delete superseded.supersededByCheckpointPath;
  delete superseded.supersededByBatchId;
  fs.writeFileSync(first.checkpointPath, JSON.stringify(superseded), "utf8");
  const staleCompletion = completePbirEditBatch(store, first.checkpointPath, { validated: true });
  assert.equal(staleCompletion.status, "BATCH_SUPERSEDED");
  const stored = JSON.parse(fs.readFileSync(second.checkpointPath, "utf8"));
  assert.equal(stored.batchId, second.batchId);
  assert.equal(stored.status, "EDITING_OFFLINE");
});

test("refuses the first PBIR checkpoint write through a junction", async (t) => {
  const store = withStore(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pbi-safe-junction-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(store.root, "pbir-edit"), "junction");
  const result = await preparePbirEdit(mockRuntime({ statusSequence: [[]] }), store, "C:\\Demos\\Junction.pbip", {
    execution: { taskId: "junction-edit", mode: "background" },
  });
  assert.equal(result.status, "INVALID_CHECKPOINT");
  assert.equal(fs.readdirSync(outside).length, 0);
});

test("CLI rejects false-like confirmation values and mismatched PBIR task IDs", async (t) => {
  const store = withStore(t);
  const report = path.join(store.root, "CliReview.pbip");
  fs.writeFileSync(report, "{}", "utf8");
  const runtime = mockRuntime({ statusSequence: [[]] });
  const prepared = await preparePbirEdit(runtime, store, report, {
    execution: { taskId: "cli-review", mode: "attended" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  const adapterPath = fileURLToPath(new URL("../bin/powerbi-desktop-safe.mjs", import.meta.url));

  const falseConfirmation = spawnSync(process.execPath, [
    adapterPath,
    "request-pbir-review",
    prepared.checkpointPath,
    "--notice-type",
    "external",
    "--notice-confirmed",
    "false",
    "--state-dir",
    store.root,
  ], { encoding: "utf8" });
  assert.equal(falseConfirmation.status, 1);
  assert.equal(JSON.parse(falseConfirmation.stdout).status, "COMMAND_FAILED");

  const normalizedTask = spawnSync(process.execPath, [
    adapterPath,
    "request-pbir-review",
    prepared.checkpointPath,
    "--notice-type",
    "unknown",
    "--task-id",
    " cli-review ",
    "--execution-mode",
    "attended",
    "--state-dir",
    store.root,
  ], { encoding: "utf8" });
  assert.equal(normalizedTask.status, 0);
  assert.equal(JSON.parse(normalizedTask.stdout).status, "NOTICE_TYPE_UNKNOWN");

  const omittedTask = spawnSync(process.execPath, [
    adapterPath,
    "request-pbir-review",
    prepared.checkpointPath,
    "--notice-type",
    "unknown",
    "--state-dir",
    store.root,
  ], {
    encoding: "utf8",
    env: { ...process.env, POWERBI_EXECUTION_TASK_ID: "cli-review" },
  });
  assert.equal(omittedTask.status, 0);
  assert.equal(JSON.parse(omittedTask.stdout).status, "TASK_ID_REQUIRED");

  const wrongTask = spawnSync(process.execPath, [
    adapterPath,
    "request-pbir-review",
    prepared.checkpointPath,
    "--notice-type",
    "unknown",
    "--task-id",
    "another-task",
    "--execution-mode",
    "attended",
    "--state-dir",
    store.root,
  ], { encoding: "utf8" });
  assert.equal(wrongTask.status, 0);
  assert.equal(JSON.parse(wrongTask.stdout).status, "TASK_ID_MISMATCH");
});

test("persists a failed target read and requires an explicit recovery retry", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ReadCrash.pbip";
  const preparedRuntime = mockRuntime({ statusSequence: [[connected(415, target)]] });
  const prepared = await preparePbirEdit(preparedRuntime, store, target, {
    execution: { taskId: "read-crash", mode: "attended" },
  });
  completePbirEditBatch(store, prepared.checkpointPath, { validated: true });
  requestPbirReviewIntervention(store, prepared.checkpointPath, "external", { noticeConfirmed: true });

  const failedRuntime = mockRuntime({ statusError: new Error("bridge process stopped") });
  const failed = await resumePbirReview(failedRuntime, store, prepared.checkpointPath, {
    completed: true,
    pid: 415,
  });
  assert.equal(failed.status, "TARGET_READ_FAILED");
  assert.equal(failed.retryAvailable, true);
  const persisted = JSON.parse(fs.readFileSync(prepared.checkpointPath, "utf8"));
  assert.equal(persisted.intervention.targetReadStatus, "TARGET_READ_FAILED");

  const readsBeforeRetry = failedRuntime.statusCount;
  const blockedRetry = await resumePbirReview(failedRuntime, store, prepared.checkpointPath, {
    completed: true,
    pid: 415,
  });
  assert.equal(blockedRetry.status, "TARGET_READ_FAILED");
  assert.equal(blockedRetry.targetReadChecks, 0);
  assert.equal(failedRuntime.statusCount, readsBeforeRetry);

  const recoveredRuntime = mockRuntime({ statusSequence: [[connected(415, target)]] });
  const recovered = await resumePbirReview(recoveredRuntime, store, prepared.checkpointPath, {
    completed: true,
    pid: 415,
    retryTargetRead: true,
  });
  assert.equal(recovered.status, "READY_TO_TEST");
  assert.equal(recovered.targetReadChecks, 1);
});

test("PBIX resume requires a mode choice for the destination target", (t) => {
  const store = withStore(t);
  const source = path.join(store.root, "Source.pbix");
  const destination = path.join(store.root, "Destination.pbix");
  fs.writeFileSync(source, "source", "utf8");
  const saved = unsupportedSaveAs(store, source, destination, {
    execution: { taskId: "source-task", mode: "attended" },
  });
  fs.writeFileSync(destination, "destination", "utf8");
  const oldTime = new Date(Date.now() - 5_000);
  fs.utimesSync(destination, oldTime, oldTime);

  const adapterPath = fileURLToPath(new URL("../bin/powerbi-desktop-safe.mjs", import.meta.url));
  const invoked = spawnSync(process.execPath, [
    adapterPath,
    "resume",
    saved.checkpointPath,
    "--pid",
    "1234",
    "--state-dir",
    store.root,
  ], {
    encoding: "utf8",
    env: { ...process.env, POWERBI_EXECUTION_TASK_ID: "" },
  });
  assert.equal(invoked.status, 0);
  const result = JSON.parse(invoked.stdout);
  assert.equal(result.status, "EXECUTION_MODE_REQUIRED");
  assert.equal(result.target.normalizedPath, path.resolve(destination));
});

test("CLI accepts an execution mode propagated through the launcher environment", (t) => {
  const store = withStore(t);
  const report = path.join(store.root, "Environment.pbip");
  fs.writeFileSync(report, "{}", "utf8");
  const adapterPath = fileURLToPath(new URL("../bin/powerbi-desktop-safe.mjs", import.meta.url));
  const invoked = spawnSync(process.execPath, [
    adapterPath,
    "execution-mode",
    report,
    "--task-id",
    "environment-task",
    "--state-dir",
    store.root,
  ], {
    encoding: "utf8",
    env: { ...process.env, POWERBI_EXECUTION_MODE: "background" },
  });
  assert.equal(invoked.status, 0);
  const result = JSON.parse(invoked.stdout);
  assert.equal(result.status, "EXECUTION_MODE_READY");
  assert.equal(result.execution.mode, "background");
});

test("CLI rejects a Windows session ID different from its caller session", (t) => {
  const store = withStore(t);
  const report = path.join(store.root, "ForeignSession.pbip");
  fs.writeFileSync(report, "{}", "utf8");
  const adapterPath = fileURLToPath(new URL("../bin/powerbi-desktop-safe.mjs", import.meta.url));
  const invoked = spawnSync(process.execPath, [
    adapterPath,
    "resolve",
    report,
    "--task-id",
    "foreign-session-task",
    "--execution-mode",
    "attended",
    "--session-id",
    "999999",
    "--state-dir",
    store.root,
  ], { encoding: "utf8" });
  assert.equal(invoked.status, 1);
  const result = JSON.parse(invoked.stdout);
  assert.equal(result.status, "COMMAND_FAILED");
  assert.equal(result.error.code, "SESSION_ID_MISMATCH");
});

test("rejects checkpoints outside the active state store without modifying them", (t) => {
  const store = withStore(t);
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbi-safe-outside-"));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const checkpointPath = path.join(outsideRoot, "unmanaged.json");
  const original = JSON.stringify({
    schemaVersion: 1,
    operation: "manual-intervention",
    kind: "save",
    status: "WAITING_FOR_MANUAL_ACTION",
    taskId: "task-outside",
    targetPath: "C:\\Demos\\Outside.pbip",
  });
  fs.writeFileSync(checkpointPath, original, "utf8");

  const result = resumeCheckpoint(checkpointPath, { completed: true, store });
  assert.equal(result.status, "INVALID_CHECKPOINT");
  assert.equal(fs.readFileSync(checkpointPath, "utf8"), original);
});

test("opens when no Desktop instance exists and confirms only the target", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Sales.pbip";
  const runtime = mockRuntime({ statusSequence: [[], [], [connected(900, target)]] });
  const result = await openTarget(runtime, store, target, { waitMs: 1_000 });
  assert.equal(result.status, "READY");
  assert.equal(result.desktop.pid, 900);
  assert.equal(result.launch.launchedProcessId, 777);
  assert.equal(result.launch.pidIsCandidateOnly, true);
  assert.equal(runtime.launchCount, 1);
});

test("does not launch when the correct instance is already open", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Sales.pbip";
  const runtime = mockRuntime({ statusSequence: [[connected(101, target)]] });
  const result = await openTarget(runtime, store, target);
  assert.equal(result.status, "READY");
  assert.equal(result.launch.reason, "TARGET_ALREADY_OPEN");
  assert.equal(runtime.launchCount, 0);
});

test("never substitutes an unrelated connected Bridge", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Requested.pbip";
  const other = connected(201, "C:\\Other\\Unrelated.pbip");
  const runtime = mockRuntime({ statusSequence: [[other], [other], [other, connected(202, target)]] });
  const result = await openTarget(runtime, store, target, { waitMs: 1_000 });
  assert.equal(result.status, "READY");
  assert.equal(result.desktop.pid, 202);
  assert.notEqual(result.desktop.pid, other.pid);
});

test("requires an explicit PID when the same target is open twice", async () => {
  const target = "C:\\Demos\\Sales.pbip";
  const instances = [connected(301, target), connected(302, target)];
  const runtime = mockRuntime({ statusSequence: [instances, instances] });
  const ambiguous = await resolveTarget(runtime, target);
  assert.equal(ambiguous.status, "AMBIGUOUS_TARGET");
  assert.deepEqual(ambiguous.candidates.map((item) => item.pid), [301, 302]);
  const selected = await resolveTarget(runtime, target, { pid: 302 });
  assert.equal(selected.status, "READY");
  assert.equal(selected.desktop.pid, 302);
});

test("ignores a matching Desktop process from another Windows session", async () => {
  const target = "C:\\Demos\\SessionScoped.pbip";
  const otherSession = { ...connected(303, target), sessionId: 3 };
  const currentSession = connected(304, target);
  const runtime = mockRuntime({ sessionId: 6, statusSequence: [[otherSession, currentSession]] });
  const result = await resolveTarget(runtime, target);
  assert.equal(result.status, "READY");
  assert.equal(result.desktop.pid, 304);
  assert.equal(result.desktop.sessionId, 6);
});

test("normalizes Windows paths with spaces, accents, case, and separators", () => {
  const target = "C:\\Relatorios\\Vendas São Paulo\\Relatório.pbip";
  const instancePath = "c:\\RELATORIOS\\Vendas São Paulo\\Relatório.pbip\\";
  assert.equal(pathsEqual(target, instancePath, "win32"), true);
  const selection = selectTarget([connected(401, instancePath)], target, {
    platform: "win32",
    resolveReportDir: reportDirFor,
  });
  assert.equal(selection.matches[0].pid, 401);
});

test("launcher timeout records OPENING and a repeated open does not duplicate", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Slow.pbix";
  const runtime = mockRuntime({ statusSequence: [[], [], [], []] });
  const first = await openTarget(runtime, store, target, { waitMs: 500 });
  assert.equal(first.status, "TARGET_NOT_READY");
  assert.equal(first.launch.launchedProcessId, 777);
  const second = await openTarget(runtime, store, target, { waitMs: 0 });
  assert.equal(second.launch.reason, "PREVIOUS_LAUNCH_PENDING");
  assert.equal(runtime.launchCount, 1);
});

test("serializes concurrent open requests before launch", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Concurrent.pbix";
  const runtime = mockRuntime({ statusSequence: [[], [], [], []] });
  const firstPromise = openTarget(runtime, store, target, { waitMs: 500 });
  const second = await openTarget(runtime, store, target, { waitMs: 0 });
  const first = await firstPromise;
  assert.equal(first.status, "TARGET_NOT_READY");
  assert.equal(second.status, "OPEN_IN_PROGRESS");
  assert.equal(runtime.launchCount, 1);
});

test("does not launch when status discovery is inconclusive", async (t) => {
  const store = withStore(t);
  const runtime = mockRuntime({
    statusSequence: [[]],
    diagnostics: [{ code: "STATUS_QUERY_TIMEOUT", message: "bounded worker timed out" }],
  });
  const result = await openTarget(runtime, store, "C:\\Demos\\Unknown.pbix");
  assert.equal(result.status, "TARGET_NOT_READY");
  assert.equal(result.launch.reason, "DISCOVERY_INCONCLUSIVE");
  assert.equal(runtime.launchCount, 0);
});

test("does not launch when partial discovery finds only an unrelated instance", async (t) => {
  const store = withStore(t);
  const unrelated = connected(305, "C:\\Demos\\Unrelated.pbip");
  const runtime = mockRuntime({
    statusSequence: [[unrelated]],
    diagnostics: [{ code: "STATUS_QUERY_TIMEOUT", message: "another candidate timed out" }],
  });
  const result = await openTarget(runtime, store, "C:\\Demos\\Requested.pbip");
  assert.equal(result.status, "TARGET_NOT_READY");
  assert.equal(result.launch.reason, "DISCOVERY_INCONCLUSIVE");
  assert.equal(runtime.launchCount, 0);
});

test("launches when discovery only ignored Desktop instances from other sessions", async (t) => {
  const store = withStore(t);
  const runtime = mockRuntime({
    statusSequence: [[]],
    diagnostics: [{
      code: "CROSS_SESSION_INSTANCES_IGNORED",
      message: "1 Desktop Bridge instance outside interactive session 6 was ignored.",
    }],
  });
  const result = await openTarget(runtime, store, "C:\\Demos\\SessionScoped.pbip", { waitMs: 0 });
  assert.equal(result.status, "OPENING");
  assert.equal(result.launch.attempted, true);
  assert.equal(runtime.launchCount, 1);
});

test("keeps offline work available when Desktop is unavailable", async () => {
  const runtime = mockRuntime({ statusSequence: [[]] });
  const result = await resolveTarget(runtime, "C:\\Demos\\Offline.pbip");
  assert.equal(result.status, "TARGET_NOT_READY");
  assert.equal(result.offlineWorkCanContinue, true);
  assert.equal(runtime.launchCount, 0);
});

test("reports a real launch failure without claiming success", async (t) => {
  const store = withStore(t);
  const error = Object.assign(new Error("Power BI Desktop executable was not found"), { code: "DESKTOP_EXE_NOT_FOUND" });
  const runtime = mockRuntime({ openError: error });
  const result = await openTarget(runtime, store, "C:\\Demos\\Missing.pbix");
  assert.equal(result.status, "OPEN_FAILED");
  assert.equal(result.error.code, "DESKTOP_EXE_NOT_FOUND");
  assert.equal(result.ok, false);
});

test("quarantines the PID after partial timeout and never repeats an unknown page", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Capture.pbip";
  const pages = [
    { id: "page-one", displayName: "One" },
    { id: "page-two", displayName: "Two" },
    { id: "page-three", displayName: "Three" },
  ];
  const instance = connected(501, target, pages);
  const runtime = mockRuntime({
    statusSequence: [[instance], [instance]],
    capture: { "page-two": "pending" },
  });
  const outputDir = path.join(store.root, "captures");
  const first = await captureAll(runtime, store, target, {
    pid: 501,
    outputDir,
    totalMs: 100,
    pageMs: 10,
  });
  assert.equal(first.status, "PARTIAL_TIMEOUT");
  assert.equal(first.operationStateUnknown, true);
  assert.deepEqual(runtime.captureCalls, ["page-one", "page-two"]);

  const second = await captureAll(runtime, store, target, {
    pid: 501,
    outputDir,
    totalMs: 100,
    pageMs: 10,
  });
  assert.equal(second.status, "HOST_STATE_UNKNOWN");
  assert.deepEqual(runtime.captureCalls, ["page-one", "page-two"]);
  assert.equal(runtime.captureCalls.filter((page) => page === "page-two").length, 1);
});

test("revalidates path on the selected session before screenshot", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Expected.pbip";
  const instance = connected(551, target, [{ id: "page-one", displayName: "One" }]);
  const runtime = mockRuntime({
    statusSequence: [[instance]],
    identity: "C:\\Other\\Changed.pbip",
  });
  const result = await captureAll(runtime, store, target, {
    pid: 551,
    outputDir: path.join(store.root, "captures"),
    totalMs: 100,
    pageMs: 20,
  });
  assert.equal(result.status, "TARGET_NOT_READY");
  assert.equal(runtime.captureCalls.length, 0);
});

test("recaptures a completed page when its PBIR definition changes", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\ChangedPage.pbip";
  const pageRoot = path.join(store.root, "ChangedPage.Report", "definition", "pages", "page-one");
  const pagePath = path.join(pageRoot, "page.json");
  fs.mkdirSync(pageRoot, { recursive: true });
  fs.writeFileSync(pagePath, "{\"displayName\":\"Before\"}", "utf8");
  const page = { id: "page-one", displayName: "One", pagePath };
  const instance = connected(553, target, [page]);
  const runtime = mockRuntime({ statusSequence: [[instance], [instance]], writeCaptures: true });
  const outputDir = path.join(store.root, "captures");
  const first = await captureAll(runtime, store, target, { pid: 553, outputDir, totalMs: 100, pageMs: 20 });
  assert.equal(first.status, "COMPLETE");
  fs.writeFileSync(pagePath, "{\"displayName\":\"After\"}", "utf8");
  const second = await captureAll(runtime, store, target, { pid: 553, outputDir, totalMs: 100, pageMs: 20 });
  assert.equal(second.status, "COMPLETE");
  assert.deepEqual(runtime.captureCalls, ["page-one", "page-one"]);
});

test("captures one page, checkpoints, then resumes remaining pages", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Incremental.pbip";
  const pages = [
    { id: "page-one", displayName: "One" },
    { id: "page-two", displayName: "Two" },
    { id: "page-three", displayName: "Three" },
  ];
  const instance = connected(554, target, pages);
  const runtime = mockRuntime({ statusSequence: [[instance], [instance]], writeCaptures: true });
  const outputDir = path.join(store.root, "captures");
  const first = await captureAll(runtime, store, target, {
    pid: 554,
    outputDir,
    totalMs: 100,
    pageMs: 20,
    maxPages: 1,
  });
  assert.equal(first.status, "PARTIAL_CHECKPOINT");
  assert.equal(first.progress.completed, 1);
  const resumed = await captureAll(runtime, store, target, {
    pid: 554,
    outputDir,
    totalMs: 100,
    pageMs: 20,
  });
  assert.equal(resumed.status, "COMPLETE");
  assert.equal(resumed.progress.completed, 3);
  assert.deepEqual(runtime.captureCalls, ["page-one", "page-two", "page-three"]);
});

test("labels captures from an unsaved Desktop session as different from disk", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\UnsavedCapture.pbip";
  const instance = {
    ...connected(555, target, [{ id: "page-one", displayName: "One" }]),
    hasUnsavedChanges: true,
  };
  const runtime = mockRuntime({ statusSequence: [[instance]], writeCaptures: true });
  const result = await captureAll(runtime, store, target, {
    pid: 555,
    outputDir: path.join(store.root, "captures"),
    totalMs: 100,
    pageMs: 20,
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.sourceEvidence.captureRepresents, "DESKTOP_SESSION");
  assert.equal(result.sourceEvidence.hasUnsavedChanges, true);
  assert.equal(result.sourceEvidence.diskAlignment, "SESSION_DIFFERS_FROM_DISK");
  assert.equal(result.captures[0].sourceEvidence.diskAlignment, "SESSION_DIFFERS_FROM_DISK");
});

test("reads source evidence immediately before each page capture", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\MixedCapture.pbip";
  const pages = [
    { id: "page-one", displayName: "One" },
    { id: "page-two", displayName: "Two" },
  ];
  const saved = connected(556, target, pages);
  const runtime = mockRuntime({
    statusSequence: [[saved]],
    writeCaptures: true,
    applicationStateSequence: [
      { currentFilePath: target, hasUnsavedChanges: true },
      { currentFilePath: target, hasUnsavedChanges: false },
    ],
  });
  const outputDir = path.join(store.root, "captures");
  const result = await captureAll(runtime, store, target, {
    pid: 556,
    outputDir,
    totalMs: 100,
    pageMs: 20,
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.captures[0].sourceEvidence.diskAlignment, "SESSION_DIFFERS_FROM_DISK");
  assert.equal(result.captures[1].sourceEvidence.diskAlignment, "REPORTED_SAVED");
  assert.equal(result.sourceEvidence.diskAlignment, "MIXED");
});

test("an uncertain PID lock blocks capture before any status query", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Locked.pbip";
  store.acquire("host-lock", "552", {
    pid: 999999,
    desktopPid: 552,
    uncertain: true,
    operation: "capture-all",
  });
  const runtime = mockRuntime({ statusSequence: [[connected(552, target)]] });
  const result = await captureAll(runtime, store, target, {
    pid: 552,
    outputDir: path.join(store.root, "captures"),
    totalMs: 100,
    pageMs: 20,
  });
  assert.equal(result.status, "HOST_STATE_UNKNOWN");
  assert.equal(runtime.statusCount ?? 0, 0);
});

test("caches capabilities and rejects Save As without probing again", async (t) => {
  const store = withStore(t);
  const target = "C:\\Demos\\Capabilities.pbip";
  const runtime = mockRuntime({
    statusSequence: [[connected(601, target)], [connected(601, target)]],
    methods: Object.values(BRIDGE_METHODS),
  });
  const first = await inspectCapabilities(runtime, store, target, { pid: 601 });
  const second = await inspectCapabilities(runtime, store, target, { pid: 601 });
  assert.equal(first.capabilities.saveAs, false);
  assert.equal(first.capabilities.exportCompletePbip, false);
  assert.equal(second.cached, true);
  assert.equal(runtime.sessionCount, 1);

  const unsupported = unsupportedSaveAs(store, target, "C:\\Demos\\Converted.pbip");
  assert.equal(unsupported.status, "UNSUPPORTED_CAPABILITY");
  assert.match(unsupported.manualAction, /File > Save as/);
  assert.equal(runtime.sessionCount, 1);
});

test("capability discovery requires a PID before any host query", async (t) => {
  const store = withStore(t);
  const runtime = mockRuntime({ statusSequence: [[connected(602, "C:\\Demos\\Capabilities.pbip")]] });
  const result = await inspectCapabilities(runtime, store, "C:\\Demos\\Capabilities.pbip");
  assert.equal(result.status, "PID_REQUIRED");
  assert.equal(runtime.statusCount ?? 0, 0);
  assert.equal(runtime.sessionCount, 0);
});

test("resumes after a manual checkpoint without launching another instance", async (t) => {
  const store = withStore(t);
  const source = path.join(store.root, "Source.pbix");
  const destination = path.join(store.root, "Manual", "Target.pbip");
  const unsupported = unsupportedSaveAs(store, source, destination);
  assert.equal(resumeCheckpoint(unsupported.checkpointPath, { store }).status, "WAITING_FOR_MANUAL_SAVE_AS");
  const reportDir = path.join(path.dirname(destination), "Target.Report");
  const modelDir = path.join(path.dirname(destination), "Target.SemanticModel");
  fs.mkdirSync(path.join(reportDir, "definition"), { recursive: true });
  fs.mkdirSync(path.join(modelDir, "definition"), { recursive: true });
  fs.writeFileSync(path.join(reportDir, "definition.pbir"), JSON.stringify({
    datasetReference: { byPath: { path: "../Target.SemanticModel" } },
  }), "utf8");
  fs.writeFileSync(path.join(reportDir, "definition", "report.json"), JSON.stringify({ $schema: "https://example/report" }), "utf8");
  fs.writeFileSync(path.join(reportDir, "definition", "version.json"), JSON.stringify({ $schema: "https://example/version", version: "1.0" }), "utf8");
  fs.writeFileSync(path.join(modelDir, "definition.pbism"), JSON.stringify({ $schema: "https://example/model", version: "1.0" }), "utf8");
  fs.writeFileSync(destination, JSON.stringify({ artifacts: [{ report: { path: "Target.Report" } }] }), "utf8");
  const oldTime = new Date(Date.now() - 5_000);
  for (const filePath of [
    destination,
    path.join(reportDir, "definition.pbir"),
    path.join(reportDir, "definition", "report.json"),
    path.join(reportDir, "definition", "version.json"),
    path.join(modelDir, "definition.pbism"),
  ]) fs.utimesSync(filePath, oldTime, oldTime);
  const resumed = resumeCheckpoint(unsupported.checkpointPath, { store });
  assert.equal(resumed.status, "READY_TO_RESUME");
  assert.equal(resumed.openedAnotherInstance, false);
});

test("refuses a pre-existing manual Save As destination", (t) => {
  const store = withStore(t);
  const destination = path.join(store.root, "Existing.pbix");
  fs.writeFileSync(destination, "existing", "utf8");
  const result = unsupportedSaveAs(store, path.join(store.root, "Source.pbix"), destination);
  assert.equal(result.status, "INVALID_DESTINATION");
});

test("refuses an unsupported manual Save As destination extension", (t) => {
  const store = withStore(t);
  const result = unsupportedSaveAs(store, path.join(store.root, "Source.pbix"), path.join(store.root, "Target.txt"));
  assert.equal(result.status, "INVALID_DESTINATION");
});

test("confirms PBIX Save As only from matching public Desktop state", async (t) => {
  const store = withStore(t);
  const source = path.join(store.root, "Source.pbip");
  const destination = path.join(store.root, "Saved.pbix");
  const unsupported = unsupportedSaveAs(store, source, destination);
  fs.writeFileSync(destination, "opaque-pbix", "utf8");
  const oldTime = new Date(Date.now() - 5_000);
  fs.utimesSync(destination, oldTime, oldTime);
  assert.equal(resumeCheckpoint(unsupported.checkpointPath, { store }).status, "DESTINATION_APPEARED");

  const runtime = mockRuntime({ statusSequence: [[connected(701, destination)]] });
  const confirmed = await confirmPbixSaveWithDesktop(runtime, store, unsupported.checkpointPath, 701);
  assert.equal(confirmed.status, "READY_TO_RESUME");
  assert.equal(confirmed.saveCompletionProven, true);
  assert.equal(confirmed.publicDesktopEvidence.hasUnsavedChanges, false);
});

test("keeps PBIX confirmation pending when Desktop reports unsaved changes", async (t) => {
  const store = withStore(t);
  const source = path.join(store.root, "Source.pbip");
  const destination = path.join(store.root, "Unsaved.pbix");
  const unsupported = unsupportedSaveAs(store, source, destination);
  fs.writeFileSync(destination, "opaque-pbix", "utf8");
  const oldTime = new Date(Date.now() - 5_000);
  fs.utimesSync(destination, oldTime, oldTime);
  const instance = { ...connected(702, destination), hasUnsavedChanges: true };
  const runtime = mockRuntime({ statusSequence: [[instance]] });
  const pending = await confirmPbixSaveWithDesktop(runtime, store, unsupported.checkpointPath, 702);
  assert.equal(pending.status, "MANUAL_CONFIRMATION_PENDING");
  assert.equal(pending.saveCompletionProven, false);
  assert.equal(pending.manualConfirmationRequired, true);
});

test("keeps PBIX confirmation pending when the public unsaved flag is omitted", async (t) => {
  const store = withStore(t);
  const source = path.join(store.root, "Source.pbip");
  const destination = path.join(store.root, "UnknownState.pbix");
  const unsupported = unsupportedSaveAs(store, source, destination);
  fs.writeFileSync(destination, "opaque-pbix", "utf8");
  const oldTime = new Date(Date.now() - 5_000);
  fs.utimesSync(destination, oldTime, oldTime);
  const instance = connected(703, destination);
  delete instance.hasUnsavedChanges;
  const runtime = mockRuntime({ statusSequence: [[instance]] });
  const pending = await confirmPbixSaveWithDesktop(runtime, store, unsupported.checkpointPath, 703);
  assert.equal(pending.status, "MANUAL_CONFIRMATION_PENDING");
  assert.equal(pending.publicDesktopEvidence.hasUnsavedChangesAvailable, false);
  assert.equal(pending.saveCompletionProven, false);
});
