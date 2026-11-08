import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const EXECUTION_MODES = Object.freeze({
  attended: "attended",
  background: "background",
});
export const FOCUS_BEHAVIORS = Object.freeze({
  backgroundSafe: "BACKGROUND_SAFE",
  foregroundRequired: "FOREGROUND_REQUIRED",
  offline: "OFFLINE",
  unknown: "UNKNOWN",
});
export const BRIDGE_METHODS = Object.freeze({
  applicationState: "application.state.get/v1",
  reload: "file.reload/v1",
  snapshot: "report.snapshot.capture/v1",
});

const OPERATION_FOCUS_BEHAVIOR = Object.freeze({
  "execution-mode": FOCUS_BEHAVIORS.offline,
  open: FOCUS_BEHAVIORS.foregroundRequired,
  resolve: FOCUS_BEHAVIORS.backgroundSafe,
  capabilities: FOCUS_BEHAVIORS.backgroundSafe,
  "capture-all": FOCUS_BEHAVIORS.backgroundSafe,
  "save-as": FOCUS_BEHAVIORS.foregroundRequired,
  "request-refresh": FOCUS_BEHAVIORS.foregroundRequired,
  "request-save": FOCUS_BEHAVIORS.foregroundRequired,
  "prepare-pbir-edit": FOCUS_BEHAVIORS.backgroundSafe,
  "complete-pbir-edit": FOCUS_BEHAVIORS.offline,
  "complete-pbir-review": FOCUS_BEHAVIORS.offline,
  "request-pbir-review": FOCUS_BEHAVIORS.foregroundRequired,
  "resume-pbir-review": FOCUS_BEHAVIORS.backgroundSafe,
  "resume-desktop-confirmation": FOCUS_BEHAVIORS.backgroundSafe,
  resume: FOCUS_BEHAVIORS.offline,
});

function executionModePrompt() {
  return [
    "Como você quer executar?",
    "1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas.",
    "2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco.",
  ];
}

export function authorizeExecution(store, targetPath, options = {}) {
  const operation = options.operation;
  const taskId = typeof options.taskId === "string" ? options.taskId.trim() : "";
  const requestedMode = options.mode;
  const fallbackMode = options.fallbackMode;
  const focusBehavior = OPERATION_FOCUS_BEHAVIOR[operation] ?? FOCUS_BEHAVIORS.unknown;
  if (!taskId) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "EXECUTION_MODE_REQUIRED",
      target: targetSummary(targetPath),
      prompt: executionModePrompt(),
      detail: "Pass --task-id and --execution-mode after the user chooses. No Desktop or Bridge call was made.",
      offlineWorkCanContinue: true,
    };
  }
  if (requestedMode !== undefined && !Object.values(EXECUTION_MODES).includes(requestedMode)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "INVALID_EXECUTION_MODE",
      target: targetSummary(targetPath),
      taskId,
      allowedModes: Object.values(EXECUTION_MODES),
    };
  }
  if (fallbackMode !== undefined && !Object.values(EXECUTION_MODES).includes(fallbackMode)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "INVALID_EXECUTION_MODE",
      target: targetSummary(targetPath),
      taskId,
      allowedModes: Object.values(EXECUTION_MODES),
    };
  }

  const key = `${taskId}|${normalizeForComparison(targetPath)}`;
  const previous = store.read("execution-mode", key);
  const previousIsValid = previous !== null &&
    previous.schemaVersion === SCHEMA_VERSION &&
    previous.operation === "execution-mode" &&
    previous.taskId === taskId &&
    pathsEqual(previous.targetPath, targetPath) &&
    Object.values(EXECUTION_MODES).includes(previous.mode);
  if (requestedMode === undefined && previous !== null && !previousIsValid) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "INVALID_EXECUTION_CHECKPOINT",
      target: targetSummary(targetPath),
      taskId,
      checkpointPath: store.keyPath("execution-mode", key),
      detail: "The stored execution checkpoint is invalid. No Desktop or Bridge call was made.",
      action: "Select an execution mode explicitly to replace this checkpoint.",
      offlineWorkCanContinue: true,
    };
  }
  if (requestedMode === undefined && !previous && fallbackMode === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "EXECUTION_MODE_REQUIRED",
      target: targetSummary(targetPath),
      taskId,
      prompt: executionModePrompt(),
      detail: "No execution choice is stored for this task and target. No Desktop or Bridge call was made.",
      offlineWorkCanContinue: true,
    };
  }

  const trustedPrevious = previousIsValid ? previous : null;
  const mode = requestedMode ?? trustedPrevious?.mode ?? fallbackMode;
  const now = new Date(options.now ?? Date.now()).toISOString();
  const checkpoint = {
    schemaVersion: SCHEMA_VERSION,
    operation: "execution-mode",
    taskId,
    targetPath: path.resolve(targetPath),
    mode,
    selectedAt: trustedPrevious?.selectedAt ?? now,
    updatedAt: now,
  };
  const checkpointPath = requestedMode === undefined && trustedPrevious !== null
    ? store.keyPath("execution-mode", key)
    : store.write("execution-mode", key, checkpoint);
  const execution = {
    taskId,
    mode,
    focusBehavior,
    checkpointPath,
    reused: requestedMode === undefined && trustedPrevious !== null,
    changed: trustedPrevious !== null && trustedPrevious.mode !== mode,
  };

  if (mode === EXECUTION_MODES.background &&
      ![FOCUS_BEHAVIORS.backgroundSafe, FOCUS_BEHAVIORS.offline].includes(focusBehavior)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation,
      status: "FOCUS_POLICY_BLOCKED",
      target: targetSummary(targetPath),
      execution,
      detail: focusBehavior === FOCUS_BEHAVIORS.unknown
        ? "This operation has unknown focus behavior and is blocked in background mode."
        : "This operation may open or activate Power BI Desktop and is blocked in background mode.",
      offlineWorkCanContinue: true,
    };
  }
  return { ok: true, status: "EXECUTION_MODE_READY", execution };
}

function normalizeForComparison(value, platform = process.platform) {
  let normalized = path.resolve(value);
  try { normalized = fs.realpathSync.native(normalized); } catch {}
  normalized = normalized.replace(/[\\/]+$/, "");
  if (platform === "win32") normalized = normalized.toLocaleLowerCase("en-US");
  return normalized;
}

export function pathsEqual(left, right, platform = process.platform) {
  if (!left || !right) return false;
  return normalizeForComparison(left, platform) === normalizeForComparison(right, platform);
}

export function selectTarget(instances, targetPath, options = {}) {
  const expectedReportDir = options.resolveReportDir?.(targetPath) ?? null;
  const connected = instances.filter((instance) =>
    instance.bridgeStatus === "connected" &&
    (options.sessionId === undefined || Number(instance.sessionId) === Number(options.sessionId))
  );
  const matches = connected.filter((instance) =>
    pathsEqual(instance.currentFilePath, targetPath, options.platform) ||
    (expectedReportDir && pathsEqual(instance.reportDir, expectedReportDir, options.platform))
  );
  const requestedPid = options.pid === undefined ? undefined : Number(options.pid);
  if (requestedPid !== undefined) {
    const selected = matches.filter((instance) => instance.pid === requestedPid);
    return { connected, matches: selected, pathMatches: matches, expectedReportDir };
  }
  return { connected, matches, pathMatches: matches, expectedReportDir };
}

function targetSummary(targetPath) {
  return {
    requestedPath: targetPath,
    normalizedPath: path.resolve(targetPath),
  };
}

function observedSummary(selection) {
  return selection.connected.map((instance) => ({
    pid: instance.pid,
    bridgeStatus: instance.bridgeStatus,
    targetMatch: selection.pathMatches.some((match) => match.pid === instance.pid),
  }));
}

function readyResult(operation, targetPath, instance, extra = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    operation,
    status: "READY",
    target: targetSummary(targetPath),
    desktop: {
      status: "FILE_OPEN",
      pid: instance.pid,
      sessionId: instance.sessionId,
      currentFilePath: instance.currentFilePath,
    },
    bridge: { status: "CONNECTED", pid: instance.pid, sessionId: instance.sessionId },
    engine: {
      status: "NOT_EXPOSED",
      code: "UNSUPPORTED_CAPABILITY",
      detail: "The Desktop Bridge manifest does not expose an Analysis Services engine endpoint.",
    },
    mcp: {
      status: "NOT_CHECKED",
      detail: "Connect MCP only after verifying its selected model belongs to this Desktop target.",
    },
    ...extra,
  };
}

function ambiguousResult(operation, targetPath, selection) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation,
    status: "AMBIGUOUS_TARGET",
    target: targetSummary(targetPath),
    candidates: selection.pathMatches.map((instance) => ({
      pid: instance.pid,
      bridgeStatus: instance.bridgeStatus,
      currentFilePath: instance.currentFilePath,
    })),
    action: "Pass --pid with one listed PID. No target was selected.",
  };
}

function notReadyResult(operation, targetPath, selection, extra = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation,
    status: "TARGET_NOT_READY",
    target: targetSummary(targetPath),
    observedInstances: observedSummary(selection),
    offlineWorkCanContinue: true,
    ...extra,
  };
}

function errorPayload(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
    retryable: error?.retryable === true,
  };
}

function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, resolved);
}

export class FileStateStore {
  constructor(root) {
    this.root = path.resolve(root);
  }

  keyPath(kind, key) {
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(this.root, kind, `${digest}.json`);
  }

  read(kind, key) {
    const filePath = this.keyPath(kind, key);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  find(kind, predicate) {
    const directory = path.join(this.root, kind);
    if (!fs.existsSync(directory)) return null;
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".json")) continue;
      try {
        const value = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
        if (predicate(value)) return { value, path: path.join(directory, name) };
      } catch {}
    }
    return null;
  }

  write(kind, key, value) {
    const filePath = this.keyPath(kind, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
    return filePath;
  }

  remove(kind, key) {
    fs.rmSync(this.keyPath(kind, key), { force: true });
  }

  acquire(kind, key, value) {
    const filePath = this.keyPath(kind, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lockId = crypto.randomUUID();
    const lockValue = { ...value, lockId };
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(lockValue, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { acquired: true, path: filePath, lockId };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (existing.uncertain === true) return { acquired: false, path: filePath, uncertain: true };
        if (Number.isInteger(existing.pid)) {
          try {
            process.kill(existing.pid, 0);
          } catch (processError) {
            if (processError?.code === "ESRCH") {
              return { acquired: false, path: filePath, stale: true, existingPid: existing.pid };
            }
          }
        }
      } catch {
        // An unreadable lock remains conservative: never overlap host commands.
      }
      return { acquired: false, path: filePath };
    }
  }

  release(kind, key, lockId) {
    const filePath = this.keyPath(kind, key);
    if (lockId !== undefined) {
      try {
        const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (current.lockId !== lockId) return false;
      } catch {
        return false;
      }
    }
    fs.rmSync(filePath, { force: true });
    return true;
  }
}

async function readSelection(runtime, targetPath, options = {}) {
  const status = await runtime.readDesktopStatus({
    pid: options.pid === undefined ? undefined : String(options.pid),
    waitMs: options.waitMs ?? 0,
    applicationStateWaitMs: 0,
    hardTimeoutMs: options.hardTimeoutMs,
  });
  return {
    status,
    selection: selectTarget(status.instances, targetPath, {
      pid: options.pid,
      platform: runtime.platform,
      sessionId: runtime.sessionId,
      resolveReportDir: runtime.resolveReportDir,
    }),
  };
}

export async function resolveTarget(runtime, targetPath, options = {}) {
  let quarantine = options.store?.find("host-lock", (lock) =>
    lock.uncertain === true && pathsEqual(lock.targetPath, targetPath, runtime.platform)
  );
  if (quarantine && runtime.isProcessRunning?.(quarantine.value.desktopPid) === false &&
      typeof quarantine.value.lockId === "string" &&
      options.store.release("host-lock", String(quarantine.value.desktopPid), quarantine.value.lockId)) {
    quarantine = null;
  }
  if (quarantine) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resolve",
      status: "HOST_STATE_UNKNOWN",
      target: targetSummary(targetPath),
      desktopPid: quarantine.value.desktopPid,
      lockPath: quarantine.path,
      offlineWorkCanContinue: true,
    };
  }
  const resolved = await readSelection(runtime, targetPath, options);
  if (resolved.selection.pathMatches.length > 1 && options.pid === undefined) {
    return ambiguousResult("resolve", targetPath, resolved.selection);
  }
  if (resolved.selection.matches.length === 1) {
    return readyResult("resolve", targetPath, resolved.selection.matches[0], {
      diagnostics: resolved.status.diagnostics ?? [],
    });
  }
  return notReadyResult("resolve", targetPath, resolved.selection, {
    requestedPid: options.pid,
    diagnostics: resolved.status.diagnostics ?? [],
    detail: options.pid !== undefined && resolved.selection.pathMatches.length > 0
      ? "The requested PID does not own the target path."
      : "No connected Desktop Bridge instance reports the target path.",
  });
}

function invalidPbirEditCheckpoint(detail) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation: "pbir-edit",
    status: "INVALID_CHECKPOINT",
    detail,
  };
}

function pbirStatePathContainsLink(store) {
  return [store.root, path.join(store.root, "pbir-edit"), path.join(store.root, "pbir-edit-lock"),
    path.join(store.root, "pbir-edit-owner")]
    .some((candidate) => {
      try { return fs.lstatSync(candidate).isSymbolicLink(); } catch { return false; }
    });
}

function pbirTargetLockKey(targetPath, platform = process.platform) {
  return normalizeForComparison(targetPath, platform);
}

function supersededPbirResult(operation, inspected, execution, replacementCheckpointPath) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation,
    status: "BATCH_SUPERSEDED",
    target: targetSummary(inspected.checkpoint.targetPath),
    checkpointPath: inspected.checkpointPath,
    supersededByCheckpointPath: replacementCheckpointPath ?? inspected.checkpoint.supersededByCheckpointPath,
    detail: "This PBIR batch was superseded. Use the checkpoint returned by the newer prepare-pbir-edit call.",
    execution: execution ?? inspected.checkpoint.execution,
  };
}

export function inspectPbirEditCheckpoint(store, checkpointPath) {
  const resolvedCheckpointPath = path.resolve(checkpointPath);
  const managedDirectory = path.resolve(store.root, "pbir-edit");
  const linkedStatePath = pbirStatePathContainsLink(store) || (() => {
    try { return fs.lstatSync(resolvedCheckpointPath).isSymbolicLink(); } catch { return false; }
  })();
  if (linkedStatePath) {
    return invalidPbirEditCheckpoint("The PBIR edit state path contains a symbolic link or junction.");
  }
  if (!pathsEqual(path.dirname(resolvedCheckpointPath), managedDirectory) ||
      path.extname(resolvedCheckpointPath).toLowerCase() !== ".json") {
    return invalidPbirEditCheckpoint("The checkpoint is not a managed PBIR edit file in the active state store.");
  }
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(resolvedCheckpointPath, "utf8"));
  } catch {
    return invalidPbirEditCheckpoint("The PBIR edit checkpoint is missing or is not valid JSON.");
  }
  if (checkpoint?.schemaVersion !== SCHEMA_VERSION || checkpoint.operation !== "pbir-edit" ||
      typeof checkpoint.taskId !== "string" || !checkpoint.taskId.trim() ||
      typeof checkpoint.targetPath !== "string" || !checkpoint.targetPath.trim() ||
      path.extname(checkpoint.targetPath).toLowerCase() !== ".pbip" ||
      typeof checkpoint.checkpointId !== "string" || !checkpoint.checkpointId.trim() ||
      typeof checkpoint.batchId !== "string" || !checkpoint.batchId.trim() ||
      !["EDITING_WITH_DESKTOP_OPEN", "EDITING_OFFLINE", "BATCH_VALIDATED",
        "WAITING_FOR_MANUAL_ACTION", "WAITING_FOR_TARGET_CONFIRMATION", "READY_TO_TEST",
        "COMPLETE", "SUPERSEDED"].includes(checkpoint.status)) {
    return invalidPbirEditCheckpoint("The PBIR edit checkpoint is incomplete or invalid.");
  }
  const expectedPath = store.keyPath(
    "pbir-edit",
    `${checkpoint.taskId}|${normalizeForComparison(checkpoint.targetPath, checkpoint.platform)}|${checkpoint.checkpointId}`,
  );
  if (!pathsEqual(resolvedCheckpointPath, expectedPath)) {
    return invalidPbirEditCheckpoint("The PBIR edit checkpoint filename does not match its task and batch identity.");
  }
  if (checkpoint.intervention !== undefined &&
      (typeof checkpoint.intervention !== "object" || checkpoint.intervention === null ||
       !["external", "power-query", "session-unsaved", "none"].includes(checkpoint.intervention.noticeType))) {
    return invalidPbirEditCheckpoint("The PBIR intervention state is invalid.");
  }
  const manualResultStatuses = {
    external: "EXTERNAL_CHANGES_ACTION_REQUIRED",
    "power-query": "POWER_QUERY_ACTION_REQUIRED",
    "session-unsaved": "SESSION_SAVE_ACTION_REQUIRED",
  };
  const waitingForManual = checkpoint.status === "WAITING_FOR_MANUAL_ACTION";
  const waitingForTarget = checkpoint.status === "WAITING_FOR_TARGET_CONFIRMATION";
  if (waitingForManual &&
      (!Object.hasOwn(manualResultStatuses, checkpoint.intervention?.noticeType) ||
       checkpoint.intervention.resultStatus !== manualResultStatuses[checkpoint.intervention.noticeType])) {
    return invalidPbirEditCheckpoint("The PBIR manual intervention does not match its checkpoint state.");
  }
  if (waitingForTarget &&
      (checkpoint.intervention?.noticeType !== "none" ||
       checkpoint.intervention.resultStatus !== "TARGET_CONFIRMATION_REQUIRED")) {
    return invalidPbirEditCheckpoint("The PBIR target confirmation does not match its checkpoint state.");
  }
  if ((waitingForManual || waitingForTarget) &&
      (typeof checkpoint.intervention.requestedAt !== "string" ||
       typeof checkpoint.intervention.targetReadCompleted !== "boolean" ||
       !Number.isInteger(checkpoint.intervention.targetReadAttempts) ||
       checkpoint.intervention.targetReadAttempts < 0)) {
    return invalidPbirEditCheckpoint("The PBIR intervention progress is incomplete or invalid.");
  }
  if (!waitingForManual && !waitingForTarget && checkpoint.intervention !== undefined) {
    return invalidPbirEditCheckpoint("The PBIR checkpoint has an intervention outside a waiting state.");
  }
  return { ok: true, checkpoint, checkpointPath: resolvedCheckpointPath };
}

function inspectPbirEditOwner(store, targetPath, platform = process.platform) {
  const key = pbirTargetLockKey(targetPath, platform);
  let owner;
  try {
    owner = store.read("pbir-edit-owner", key);
  } catch {
    return invalidPbirEditCheckpoint("The PBIR target owner checkpoint is not valid JSON.");
  }
  if (owner === null) return { ok: true, active: null };
  if (owner.schemaVersion !== SCHEMA_VERSION || owner.operation !== "pbir-edit-owner" ||
      typeof owner.taskId !== "string" || !owner.taskId.trim() ||
      typeof owner.batchId !== "string" || !owner.batchId.trim() ||
      typeof owner.checkpointPath !== "string" || !owner.checkpointPath.trim() ||
      !pathsEqual(owner.targetPath, targetPath, platform)) {
    return invalidPbirEditCheckpoint("The PBIR target owner checkpoint is incomplete or invalid.");
  }
  const inspected = inspectPbirEditCheckpoint(store, owner.checkpointPath);
  if (!inspected.ok) return inspected;
  if (inspected.checkpoint.taskId !== owner.taskId || inspected.checkpoint.batchId !== owner.batchId ||
      !pathsEqual(inspected.checkpoint.targetPath, targetPath, platform)) {
    return invalidPbirEditCheckpoint("The PBIR target owner does not match its active edit checkpoint.");
  }
  return { ok: true, active: inspected };
}

function writePbirEditOwner(store, checkpointPath, checkpoint) {
  const key = pbirTargetLockKey(checkpoint.targetPath, checkpoint.platform);
  return store.write("pbir-edit-owner", key, {
    schemaVersion: SCHEMA_VERSION,
    operation: "pbir-edit-owner",
    taskId: checkpoint.taskId,
    batchId: checkpoint.batchId,
    targetPath: checkpoint.targetPath,
    checkpointPath: path.resolve(checkpointPath),
    updatedAt: new Date().toISOString(),
  });
}

function verifyPbirEditOwnership(store, inspected, operation, execution) {
  const owner = inspectPbirEditOwner(
    store,
    inspected.checkpoint.targetPath,
    inspected.checkpoint.platform,
  );
  if (!owner.ok) return owner;
  if (inspected.checkpoint.status === "SUPERSEDED" || !owner.active ||
      !pathsEqual(owner.active.checkpointPath, inspected.checkpointPath)) {
    return supersededPbirResult(operation, inspected, execution, owner.active?.checkpointPath);
  }
  return { ok: true };
}

function pbirNoticeType(instance) {
  if (!Object.prototype.hasOwnProperty.call(instance, "hasUnsavedChanges")) return "UNKNOWN";
  return instance.hasUnsavedChanges === true ? "SESSION_UNSAVED" : "NONE_REPORTED";
}

export async function preparePbirEdit(runtime, store, targetPath, options = {}) {
  const taskId = typeof options.execution?.taskId === "string" ? options.execution.taskId.trim() : "";
  if (!taskId) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "prepare-pbir-edit",
      status: "EXECUTION_MODE_REQUIRED",
      target: targetSummary(targetPath),
      detail: "A stable task ID is required before preparing a PBIR edit batch.",
    };
  }
  const execution = { ...options.execution, taskId };
  if (pbirStatePathContainsLink(store)) {
    return invalidPbirEditCheckpoint("The PBIR edit state path contains a symbolic link or junction.");
  }
  const lockKey = pbirTargetLockKey(targetPath, runtime.platform);
  const lock = store.acquire("pbir-edit-lock", lockKey, {
    pid: process.pid,
    taskId,
    targetPath: path.resolve(targetPath),
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "prepare-pbir-edit",
      status: lock.stale ? "PBIR_EDIT_STALE_LOCK" : "PBIR_EDIT_PREPARATION_IN_PROGRESS",
      target: targetSummary(targetPath),
      lockPath: lock.path,
      staleOwnerPid: lock.existingPid,
      detail: lock.stale
        ? "A stale PBIR lock blocks this target. Verify that its recorded PID is not running and that no Accelerator process is using the target, then remove this exact lock file before retrying."
        : "Another process is preparing this PBIR edit batch. No second batch was created.",
      execution,
    };
  }
  try {
    const owner = inspectPbirEditOwner(store, targetPath, runtime.platform);
    if (!owner.ok) return owner;
    let inspectedActive = owner.active;
    if (inspectedActive && ["COMPLETE", "SUPERSEDED"].includes(inspectedActive.checkpoint.status)) {
      store.remove("pbir-edit-owner", lockKey);
      inspectedActive = null;
    }
    if (inspectedActive && inspectedActive.checkpoint.taskId !== taskId) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        operation: "prepare-pbir-edit",
        status: "PBIR_EDIT_OWNED_BY_ANOTHER_TASK",
        target: targetSummary(targetPath),
        detail: "Another task owns the active PBIR edit batch for this target. Finish or explicitly supersede it from that task before writing.",
        execution,
      };
    }
    if (inspectedActive && options.newBatch !== true) {
      const trustedActive = inspectedActive.checkpoint;
      const editable = ["EDITING_WITH_DESKTOP_OPEN", "EDITING_OFFLINE"].includes(trustedActive.status);
      const activeStatus = editable
        ? trustedActive.desktop?.open ? "PBIR_EDIT_TARGET_OPEN" : "PBIR_EDIT_OFFLINE_READY"
        : trustedActive.status;
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: true,
        operation: "prepare-pbir-edit",
        status: activeStatus,
        target: targetSummary(targetPath),
        batchId: trustedActive.batchId,
        checkpointPath: inspectedActive.checkpointPath,
        reused: true,
        desktop: trustedActive.desktop,
        editAllowed: editable,
        detail: editable
          ? "The active PBIR edit batch was reused; Desktop state was not queried again."
          : "This batch is no longer editable. Finish its pending review or start an explicit new batch before writing again.",
        execution,
      };
    }
    const resolved = await readSelection(runtime, targetPath, { pid: options.pid });
  if (resolved.selection.pathMatches.length > 1 && options.pid === undefined) {
    return ambiguousResult("prepare-pbir-edit", targetPath, resolved.selection);
  }
    const diagnostics = resolved.status.diagnostics ?? [];
    const blockingDiagnostics = diagnostics
    .filter((diagnostic) => diagnostic.code !== "CROSS_SESSION_INSTANCES_IGNORED");
    const crossSessionUnknown = diagnostics.some((diagnostic) => diagnostic.code === "CROSS_SESSION_INSTANCES_IGNORED");
    const hasUnobservableDesktop = (resolved.status.instances ?? []).some((instance) =>
      Number(instance.sessionId) === Number(runtime.sessionId) && instance.bridgeStatus !== "connected"
    );
    if ((blockingDiagnostics.length > 0 || hasUnobservableDesktop) && resolved.selection.matches.length === 0) {
    return {
      ...notReadyResult("prepare-pbir-edit", targetPath, resolved.selection),
      status: "PBIR_EDIT_STATE_UNKNOWN",
      detail: "Desktop discovery was inconclusive. No assumption was made about whether the project is open.",
      diagnostics: resolved.status.diagnostics,
    };
  }
  if (options.pid !== undefined && resolved.selection.matches.length === 0) {
    return notReadyResult("prepare-pbir-edit", targetPath, resolved.selection, {
      requestedPid: options.pid,
      detail: "The requested PID does not own the target path. No PBIR edit batch was prepared.",
    });
  }

    const instance = resolved.selection.matches.length === 1 ? resolved.selection.matches[0] : null;
    const now = new Date(options.now ?? Date.now()).toISOString();
    const checkpoint = {
    schemaVersion: SCHEMA_VERSION,
    operation: "pbir-edit",
    status: instance ? "EDITING_WITH_DESKTOP_OPEN" : "EDITING_OFFLINE",
    taskId,
    checkpointId: crypto.randomUUID(),
    batchId: crypto.randomUUID(),
    targetPath: path.resolve(targetPath),
    platform: runtime.platform,
    preparedAt: now,
    desktop: instance ? {
      open: true,
      pid: instance.pid,
      sessionId: instance.sessionId,
      noticeType: pbirNoticeType(instance),
      hasUnsavedChanges: Object.prototype.hasOwnProperty.call(instance, "hasUnsavedChanges")
        ? instance.hasUnsavedChanges
        : null,
    } : { open: false, noticeType: "NONE", crossSessionUnknown },
    execution,
  };
    const checkpointPath = store.keyPath(
      "pbir-edit",
      `${taskId}|${normalizeForComparison(targetPath, runtime.platform)}|${checkpoint.checkpointId}`,
    );
    writeJsonAtomic(checkpointPath, checkpoint);
    writePbirEditOwner(store, checkpointPath, checkpoint);
    if (inspectedActive) {
      const superseded = {
        ...inspectedActive.checkpoint,
        status: "SUPERSEDED",
        supersededAt: now,
        supersededByCheckpointPath: checkpointPath,
        supersededByBatchId: checkpoint.batchId,
      };
      try {
        writeJsonAtomic(inspectedActive.checkpointPath, superseded);
      } catch {
        // The owner pointer already makes the old checkpoint inactive.
      }
    }
    return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    operation: "prepare-pbir-edit",
    status: instance ? "PBIR_EDIT_TARGET_OPEN" : "PBIR_EDIT_OFFLINE_READY",
    target: targetSummary(targetPath),
    batchId: checkpoint.batchId,
    checkpointPath,
    reused: false,
    desktop: checkpoint.desktop,
    detail: instance
      ? "The target is open. Finish and validate the disk batch first; one confirmed external-change apply may be needed before visual testing."
      : crossSessionUnknown
        ? "The target was not observed in this interactive session. Other Windows sessions could not be inspected; confirm they do not own this project before editing, then validate the entire disk batch before opening Power BI Desktop."
        : "The target was not observed in this interactive session. Finish and validate the entire disk batch before opening Power BI Desktop.",
    diagnostics: crossSessionUnknown ? diagnostics : undefined,
    execution,
    };
  } finally {
    store.release("pbir-edit-lock", lockKey, lock.lockId);
  }
}

export function completePbirEditBatch(store, checkpointPath, options = {}) {
  const initial = inspectPbirEditCheckpoint(store, checkpointPath);
  if (!initial.ok) return initial;
  const lockKey = pbirTargetLockKey(initial.checkpoint.targetPath, initial.checkpoint.platform);
  const lock = store.acquire("pbir-edit-lock", lockKey, {
    pid: process.pid,
    taskId: initial.checkpoint.taskId,
    batchId: initial.checkpoint.batchId,
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "complete-pbir-edit",
      status: lock.stale ? "PBIR_EDIT_STALE_LOCK" : "PBIR_EDIT_TRANSITION_IN_PROGRESS",
      target: targetSummary(initial.checkpoint.targetPath),
      checkpointPath: initial.checkpointPath,
      lockPath: lock.path,
      staleOwnerPid: lock.existingPid,
      detail: lock.stale
        ? "A stale PBIR lock blocks this target. Verify that its recorded PID is not running and that no Accelerator process is using the target, then remove this exact lock file before retrying."
        : undefined,
      execution: options.execution ?? initial.checkpoint.execution,
    };
  }
  try {
    const inspected = inspectPbirEditCheckpoint(store, checkpointPath);
    if (!inspected.ok) return inspected;
    const { checkpoint } = inspected;
  const ownership = verifyPbirEditOwnership(store, inspected, "complete-pbir-edit", options.execution);
  if (!ownership.ok) return ownership;
  if (checkpoint.status === "BATCH_VALIDATED" || checkpoint.status === "READY_TO_TEST") {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      operation: "complete-pbir-edit",
      status: checkpoint.status,
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      reused: true,
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (!["EDITING_WITH_DESKTOP_OPEN", "EDITING_OFFLINE"].includes(checkpoint.status)) {
    return invalidPbirEditCheckpoint("The PBIR edit batch is not in an editable state.");
  }
  if (options.validated !== true) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "complete-pbir-edit",
      status: "BATCH_VALIDATION_REQUIRED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      detail: "Finish the disk batch and validate PBIR before marking it ready for Desktop review.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  checkpoint.status = "BATCH_VALIDATED";
  checkpoint.validatedAt = new Date(options.now ?? Date.now()).toISOString();
  writeJsonAtomic(inspected.checkpointPath, checkpoint);
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    operation: "complete-pbir-edit",
    status: "BATCH_VALIDATED",
    target: targetSummary(checkpoint.targetPath),
    checkpointPath: inspected.checkpointPath,
    reused: false,
    detail: "The disk batch is marked validated and can now be classified for one Desktop review action.",
    execution: options.execution ?? checkpoint.execution,
  };
  } finally {
    store.release("pbir-edit-lock", lockKey, lock.lockId);
  }
}

function pbirInterventionAction(targetPath, noticeType) {
  const projectName = path.basename(targetPath, path.extname(targetPath));
  if (noticeType === "external") {
    return `A revisão está pronta em disco no arquivo ${targetPath}. Na janela ${projectName}, clique em 'Confirmar e aplicar' no aviso de alterações externas. Isso carrega a revisão para o teste visual. Se você fez ajustes manuais que deseja guardar, preserve-os em uma cópia separada antes de continuar.`;
  }
  if (noticeType === "power-query") {
    return `O arquivo ${targetPath} tem alterações pendentes do Power Query. Na janela ${projectName}, conclua esse aviso escolhendo 'Aplicar alterações' para mantê-las ou 'Descartar alterações' para removê-las antes de testar o lote PBIR. O Accelerator não escolherá por você.`;
  }
  return `Foram confirmadas alterações novas na sessão do arquivo ${targetPath} que precisam ser persistidas. Na janela ${projectName}, pressione Ctrl+S uma vez e aguarde a conclusão antes de continuar.`;
}

export function requestPbirReviewIntervention(store, checkpointPath, noticeType, options = {}) {
  const initial = inspectPbirEditCheckpoint(store, checkpointPath);
  if (!initial.ok) return initial;
  const lockKey = pbirTargetLockKey(initial.checkpoint.targetPath, initial.checkpoint.platform);
  const lock = store.acquire("pbir-edit-lock", lockKey, {
    pid: process.pid,
    taskId: initial.checkpoint.taskId,
    batchId: initial.checkpoint.batchId,
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: lock.stale ? "PBIR_EDIT_STALE_LOCK" : "PBIR_EDIT_TRANSITION_IN_PROGRESS",
      target: targetSummary(initial.checkpoint.targetPath),
      checkpointPath: initial.checkpointPath,
      lockPath: lock.path,
      staleOwnerPid: lock.existingPid,
      detail: lock.stale
        ? "A stale PBIR lock blocks this target. Verify that its recorded PID is not running and that no Accelerator process is using the target, then remove this exact lock file before retrying."
        : "Another process is updating this batch. No manual action was requested.",
      execution: options.execution ?? initial.checkpoint.execution,
    };
  }
  try {
    const inspected = inspectPbirEditCheckpoint(store, checkpointPath);
    if (!inspected.ok) return inspected;
    const { checkpoint } = inspected;
  const ownership = verifyPbirEditOwnership(store, inspected, "request-pbir-review", options.execution);
  if (!ownership.ok) return ownership;
  if (checkpoint.status === "READY_TO_TEST") {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      operation: "request-pbir-review",
      status: "READY_TO_TEST",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      manualActionRepeated: false,
      detail: "This batch is already ready for interaction tests. No reload or manual action was requested.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (checkpoint.intervention) {
    if (checkpoint.intervention.noticeType !== noticeType) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        operation: "request-pbir-review",
        status: "NOTICE_TYPE_UNKNOWN",
        target: targetSummary(checkpoint.targetPath),
        checkpointPath: inspected.checkpointPath,
        detail: "Conflicting notice types were reported for the same batch. No Apply or Ctrl+S instruction was issued.",
        execution: options.execution ?? checkpoint.execution,
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: noticeType === "none" ? "TARGET_CONFIRMATION_REQUIRED" : "WAITING_FOR_MANUAL_ACTION",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      noticeType,
      manualActionRepeated: false,
      detail: noticeType === "none"
        ? "Target confirmation was already requested for this batch and was not requested again."
        : "The exact action was already requested for this batch and was not requested again.",
      execution: options.execution ?? checkpoint.execution,
    };
  }

  if (checkpoint.status !== "BATCH_VALIDATED") {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: "BATCH_VALIDATION_REQUIRED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      detail: "Complete and validate the disk batch before classifying a Desktop notice.",
      execution: options.execution ?? checkpoint.execution,
    };
  }

  if (noticeType === "none") {
    checkpoint.status = "WAITING_FOR_TARGET_CONFIRMATION";
    checkpoint.intervention = {
      noticeType,
      resultStatus: "TARGET_CONFIRMATION_REQUIRED",
      requestedAt: new Date(options.now ?? Date.now()).toISOString(),
      targetReadCompleted: false,
      targetReadAttempts: 0,
    };
    writeJsonAtomic(inspected.checkpointPath, checkpoint);
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: "TARGET_CONFIRMATION_REQUIRED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      manualActionRepeated: false,
      detail: "No notice was reported. Resume with the resolved Desktop PID to confirm the exact target before interaction tests.",
      execution: options.execution ?? checkpoint.execution,
    };
  }

  if (noticeType === "external" && options.noticeConfirmed !== true) noticeType = "unknown";
  if (noticeType === "unknown" || !["external", "power-query", "session-unsaved"].includes(noticeType)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: "NOTICE_TYPE_UNKNOWN",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      noticeType: "unknown",
      detail: "The tool could not distinguish external PBIP changes, pending Power Query changes, or unsaved session changes. No Apply or Ctrl+S instruction was issued.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (noticeType === "session-unsaved" && options.sessionChangesNeedSave !== true) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "request-pbir-review",
      status: "SESSION_CHANGES_DETECTED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      noticeType,
      detail: "Desktop reports unsaved session work, but there is no evidence that new work must be persisted. No Ctrl+S or Apply instruction was issued.",
      execution: options.execution ?? checkpoint.execution,
    };
  }

  const resultStatus = noticeType === "external"
    ? "EXTERNAL_CHANGES_ACTION_REQUIRED"
    : noticeType === "power-query"
      ? "POWER_QUERY_ACTION_REQUIRED"
      : "SESSION_SAVE_ACTION_REQUIRED";
  checkpoint.status = "WAITING_FOR_MANUAL_ACTION";
  checkpoint.intervention = {
    noticeType,
    resultStatus,
    requestedAt: new Date(options.now ?? Date.now()).toISOString(),
    targetReadCompleted: false,
    targetReadAttempts: 0,
  };
  writeJsonAtomic(inspected.checkpointPath, checkpoint);
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation: "request-pbir-review",
    status: resultStatus,
    target: targetSummary(checkpoint.targetPath),
    checkpointPath: inspected.checkpointPath,
    noticeType,
    reason: noticeType === "external"
      ? "An external-change notice was explicitly confirmed for this PBIR batch."
      : noticeType === "power-query"
        ? "Pending Power Query changes were identified and must be resolved separately from the PBIR batch."
        : "New session changes were explicitly identified as needing persistence.",
    manualAction: pbirInterventionAction(checkpoint.targetPath, noticeType),
    manualActionRepeated: false,
    resumeCondition: "Resume this PBIR checkpoint with --completed after the exact action is complete.",
    execution: options.execution ?? checkpoint.execution,
  };
  } finally {
    store.release("pbir-edit-lock", lockKey, lock.lockId);
  }
}

export async function resumePbirReview(runtime, store, checkpointPath, options = {}) {
  const initial = inspectPbirEditCheckpoint(store, checkpointPath);
  if (!initial.ok) return initial;
  const lockKey = pbirTargetLockKey(initial.checkpoint.targetPath, initial.checkpoint.platform);
  const lock = store.acquire("pbir-edit-lock", lockKey, {
    pid: process.pid,
    taskId: initial.checkpoint.taskId,
    batchId: initial.checkpoint.batchId,
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: lock.stale ? "PBIR_EDIT_STALE_LOCK" : "PBIR_EDIT_TRANSITION_IN_PROGRESS",
      target: targetSummary(initial.checkpoint.targetPath),
      checkpointPath: initial.checkpointPath,
      lockPath: lock.path,
      staleOwnerPid: lock.existingPid,
      targetReadChecks: 0,
      reloadAttempted: false,
      detail: lock.stale
        ? "A stale PBIR lock blocks this target. Verify that its recorded PID is not running and that no Accelerator process is using the target, then remove this exact lock file before retrying."
        : undefined,
      execution: options.execution ?? initial.checkpoint.execution,
    };
  }
  try {
    const inspected = inspectPbirEditCheckpoint(store, checkpointPath);
    if (!inspected.ok) return inspected;
    const { checkpoint } = inspected;
  const ownership = verifyPbirEditOwnership(store, inspected, "resume-pbir-review", options.execution);
  if (!ownership.ok) return ownership;
  if (checkpoint.status === "READY_TO_TEST") {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      operation: "resume-pbir-review",
      status: "READY_TO_TEST",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 0,
      reloadAttempted: false,
      detail: "The target was already checked for this batch. No reload or duplicate read was performed.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (!["WAITING_FOR_MANUAL_ACTION", "WAITING_FOR_TARGET_CONFIRMATION"].includes(checkpoint.status) ||
      !checkpoint.intervention) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: "NO_MANUAL_ACTION_PENDING",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 0,
      reloadAttempted: false,
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (checkpoint.intervention.targetReadCompleted === true && options.retryTargetRead !== true) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: checkpoint.intervention.targetReadStatus ?? "TARGET_READ_ALREADY_ATTEMPTED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 0,
      reloadAttempted: false,
       detail: "The target read was already attempted for this intervention and was not repeated. Use an explicit recovery retry only after correcting the PID or Bridge failure.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (options.completed !== true) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: checkpoint.intervention.noticeType === "none"
        ? "TARGET_CONFIRMATION_REQUIRED"
        : "WAITING_FOR_MANUAL_ACTION",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 0,
      reloadAttempted: false,
      execution: options.execution ?? checkpoint.execution,
    };
  }
  const pid = options.pid ?? checkpoint.desktop?.pid;
  if (pid === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: "PID_REQUIRED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 0,
      reloadAttempted: false,
      detail: "Pass the resolved Desktop PID for the one-time target read.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  checkpoint.intervention.targetReadCompleted = true;
  checkpoint.intervention.targetReadStatus = "TARGET_READ_IN_PROGRESS";
  checkpoint.intervention.targetReadAt = new Date(options.now ?? Date.now()).toISOString();
  checkpoint.intervention.targetReadAttempts = (checkpoint.intervention.targetReadAttempts ?? 0) + 1;
  writeJsonAtomic(inspected.checkpointPath, checkpoint);
  let resolved;
  try {
    resolved = await readSelection(runtime, checkpoint.targetPath, { pid });
  } catch (error) {
    checkpoint.intervention.targetReadStatus = "TARGET_READ_FAILED";
    checkpoint.intervention.targetReadError = errorPayload(error);
    checkpoint.intervention.targetReadAt = new Date(options.now ?? Date.now()).toISOString();
    writeJsonAtomic(inspected.checkpointPath, checkpoint);
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume-pbir-review",
      status: "TARGET_READ_FAILED",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 1,
      reloadAttempted: false,
      retryAvailable: true,
      error: errorPayload(error),
      detail: "The target read failed and was not retried automatically. Retry explicitly only after correcting the Bridge or PID problem.",
      execution: options.execution ?? checkpoint.execution,
    };
  }
  if (resolved.selection.matches.length !== 1) {
    checkpoint.intervention.targetReadCompleted = true;
    checkpoint.intervention.targetReadStatus = "TARGET_NOT_READY";
    checkpoint.intervention.targetReadAt = new Date(options.now ?? Date.now()).toISOString();
    writeJsonAtomic(inspected.checkpointPath, checkpoint);
    return {
      ...notReadyResult("resume-pbir-review", checkpoint.targetPath, resolved.selection, {
        requestedPid: pid,
        detail: "The exact target was not confirmed during the one-time resume read.",
      }),
      checkpointPath: inspected.checkpointPath,
      targetReadChecks: 1,
      reloadAttempted: false,
      execution: options.execution ?? checkpoint.execution,
    };
  }
  const readyAfterTargetRead = ["external", "none"].includes(checkpoint.intervention.noticeType);
  const completedIntervention = {
    ...checkpoint.intervention,
    completedAt: new Date(options.now ?? Date.now()).toISOString(),
    targetReadCompleted: true,
    targetReadStatus: "READY",
    resolvedPid: Number(pid),
  };
  checkpoint.interventionHistory = [...(checkpoint.interventionHistory ?? []), completedIntervention];
  checkpoint.status = readyAfterTargetRead ? "READY_TO_TEST" : "BATCH_VALIDATED";
  delete checkpoint.intervention;
  writeJsonAtomic(inspected.checkpointPath, checkpoint);
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    operation: "resume-pbir-review",
    status: checkpoint.status,
    target: targetSummary(checkpoint.targetPath),
    checkpointPath: inspected.checkpointPath,
    desktop: {
      pid: Number(pid),
      sessionId: resolved.selection.matches[0].sessionId,
      currentFilePath: resolved.selection.matches[0].currentFilePath,
    },
    targetReadChecks: 1,
    reloadAttempted: false,
    action: readyAfterTargetRead
      ? "Test the report interactions against this resolved target. Do not reload again when the revision is already applied."
      : "Reclassify any remaining Desktop notice for this validated batch. Do not infer an external-change notice from the completed action.",
    execution: options.execution ?? checkpoint.execution,
  };
  } finally {
    store.release("pbir-edit-lock", lockKey, lock.lockId);
  }
}

export function completePbirReview(store, checkpointPath, options = {}) {
  const initial = inspectPbirEditCheckpoint(store, checkpointPath);
  if (!initial.ok) return initial;
  const lockKey = pbirTargetLockKey(initial.checkpoint.targetPath, initial.checkpoint.platform);
  const lock = store.acquire("pbir-edit-lock", lockKey, {
    pid: process.pid,
    taskId: initial.checkpoint.taskId,
    batchId: initial.checkpoint.batchId,
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "complete-pbir-review",
      status: lock.stale ? "PBIR_EDIT_STALE_LOCK" : "PBIR_EDIT_TRANSITION_IN_PROGRESS",
      target: targetSummary(initial.checkpoint.targetPath),
      checkpointPath: initial.checkpointPath,
      lockPath: lock.path,
      staleOwnerPid: lock.existingPid,
      detail: lock.stale
        ? "A stale PBIR lock blocks this target. Verify that its recorded PID is not running and that no Accelerator process is using the target, then remove this exact lock file before retrying."
        : undefined,
      execution: options.execution ?? initial.checkpoint.execution,
    };
  }
  try {
    const inspected = inspectPbirEditCheckpoint(store, checkpointPath);
    if (!inspected.ok) return inspected;
    const { checkpoint } = inspected;
    if (checkpoint.status === "COMPLETE") {
      const owner = inspectPbirEditOwner(store, checkpoint.targetPath, checkpoint.platform);
      if (!owner.ok) return owner;
      if (owner.active && !pathsEqual(owner.active.checkpointPath, inspected.checkpointPath)) {
        if (["COMPLETE", "SUPERSEDED"].includes(owner.active.checkpoint.status)) {
          store.remove("pbir-edit-owner", lockKey);
        }
        return supersededPbirResult(
          "complete-pbir-review",
          inspected,
          options.execution,
          owner.active.checkpointPath,
        );
      }
      if (owner.active) store.remove("pbir-edit-owner", lockKey);
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: true,
        operation: "complete-pbir-review",
        status: "COMPLETE",
        target: targetSummary(checkpoint.targetPath),
        checkpointPath: inspected.checkpointPath,
        reused: true,
        execution: options.execution ?? checkpoint.execution,
      };
    }
    const ownership = verifyPbirEditOwnership(store, inspected, "complete-pbir-review", options.execution);
    if (!ownership.ok) return ownership;
    if (checkpoint.status !== "READY_TO_TEST" || options.tested !== true) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        operation: "complete-pbir-review",
        status: "INTERACTION_VALIDATION_REQUIRED",
        target: targetSummary(checkpoint.targetPath),
        checkpointPath: inspected.checkpointPath,
        detail: "Confirm that the revision and report interactions are visible without another notice, then pass --tested.",
        execution: options.execution ?? checkpoint.execution,
      };
    }
    checkpoint.status = "COMPLETE";
    checkpoint.completedAt = new Date(options.now ?? Date.now()).toISOString();
    writeJsonAtomic(inspected.checkpointPath, checkpoint);
    store.remove("pbir-edit-owner", pbirTargetLockKey(checkpoint.targetPath, checkpoint.platform));
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      operation: "complete-pbir-review",
      status: "COMPLETE",
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: inspected.checkpointPath,
      reused: false,
      detail: "The tested PBIR review is complete and no longer owns the target.",
      execution: options.execution ?? checkpoint.execution,
    };
  } finally {
    store.release("pbir-edit-lock", lockKey, lock.lockId);
  }
}

export async function openTarget(runtime, store, targetPath, options = {}) {
  const stateKey = normalizeForComparison(targetPath, runtime.platform);
  let quarantine = store.find("host-lock", (lock) =>
    lock.uncertain === true && pathsEqual(lock.targetPath, targetPath, runtime.platform)
  );
  if (quarantine && runtime.isProcessRunning?.(quarantine.value.desktopPid) === false &&
      typeof quarantine.value.lockId === "string" &&
      store.release("host-lock", String(quarantine.value.desktopPid), quarantine.value.lockId)) {
    quarantine = null;
  }
  if (quarantine) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "open",
      status: "HOST_STATE_UNKNOWN",
      target: targetSummary(targetPath),
      desktopPid: quarantine.value.desktopPid,
      lockPath: quarantine.path,
      launch: { attempted: false, reason: "UNCERTAIN_HOST_OPERATION" },
      offlineWorkCanContinue: true,
    };
  }
  let resolved = await readSelection(runtime, targetPath);
  const blockingDiagnostics = (resolved.status.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.code !== "CROSS_SESSION_INSTANCES_IGNORED");
  if (blockingDiagnostics.length > 0 && resolved.selection.matches.length === 0) {
    return notReadyResult("open", targetPath, resolved.selection, {
      diagnostics: blockingDiagnostics,
      launch: { attempted: false, reason: "DISCOVERY_INCONCLUSIVE" },
      action: "Resolve the discovery error before launching; no open was attempted.",
    });
  }
  if (resolved.selection.pathMatches.length > 1) return ambiguousResult("open", targetPath, resolved.selection);
  if (resolved.selection.matches.length === 1) {
    return readyResult("open", targetPath, resolved.selection.matches[0], {
      launch: { attempted: false, reason: "TARGET_ALREADY_OPEN" },
    });
  }

  const openLock = store.acquire("open-lock", stateKey, {
    pid: process.pid,
    targetPath: path.resolve(targetPath),
    acquiredAt: new Date(runtime.now()).toISOString(),
  });
  if (!openLock.acquired) {
    return notReadyResult("open", targetPath, resolved.selection, {
      status: "OPEN_IN_PROGRESS",
      launch: { attempted: false, reason: "CONCURRENT_OPEN_LOCK" },
      lockPath: openLock.path,
    });
  }

  try {
    const previous = store.read("open", stateKey);
    if (previous && !options.newAttempt) {
      return notReadyResult("open", targetPath, resolved.selection, {
        launch: {
          attempted: false,
          reason: "PREVIOUS_LAUNCH_PENDING",
          launchedProcessId: previous.launchedProcessId,
          startedAt: previous.startedAt,
        },
        action: "Run resolve for this target. Use --new-attempt only after proving the previous launch failed.",
      });
    }

    const startedAt = new Date(runtime.now()).toISOString();
    const reservedState = {
      schemaVersion: SCHEMA_VERSION,
      targetPath: path.resolve(targetPath),
      startedAt,
      status: "LAUNCH_RESERVED",
    };
    const checkpointPath = store.write("open", stateKey, reservedState);
    let launched;
    try {
      launched = runtime.openDesktop(targetPath);
    } catch (error) {
      store.write("open", stateKey, { ...reservedState, status: "OPEN_FAILED", error: errorPayload(error) });
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        operation: "open",
        status: "OPEN_FAILED",
        target: targetSummary(targetPath),
        checkpointPath,
        error: errorPayload(error),
      };
    }

    const operationState = {
      ...reservedState,
      launchedProcessId: launched.launchedProcessId,
      executablePath: launched.executablePath,
      status: "OPENING",
    };
    store.write("open", stateKey, operationState);
    const waitMs = Math.max(0, options.waitMs ?? 15_000);
    const deadline = runtime.now() + waitMs;
    do {
      if (runtime.now() < deadline) await runtime.sleep(Math.min(500, deadline - runtime.now()));
      resolved = await readSelection(runtime, targetPath);
      if (resolved.selection.pathMatches.length > 1) return ambiguousResult("open", targetPath, resolved.selection);
      if (resolved.selection.matches.length === 1) {
        store.write("open", stateKey, { ...operationState, status: "READY", desktopPid: resolved.selection.matches[0].pid });
        return readyResult("open", targetPath, resolved.selection.matches[0], {
          launch: {
            attempted: true,
            launchedProcessId: launched.launchedProcessId,
            pidIsCandidateOnly: true,
            startedAt,
          },
          checkpointPath,
        });
      }
    } while (runtime.now() < deadline);

    return notReadyResult("open", targetPath, resolved.selection, {
      status: waitMs === 0 ? "OPENING" : "TARGET_NOT_READY",
      launch: {
        attempted: true,
        launchedProcessId: launched.launchedProcessId,
        pidIsCandidateOnly: true,
        startedAt,
      },
      checkpointPath,
      action: "Run resolve for this target; do not repeat open automatically.",
    });
  } finally {
    store.release("open-lock", stateKey, openLock.lockId);
  }
}

function safeFilePart(value) {
  return String(value || "page")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "") || "page";
}

function pageFingerprint(page) {
  if (!page?.pagePath || !fs.existsSync(page.pagePath)) return null;
  const root = path.dirname(page.pagePath);
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  const hash = crypto.createHash("sha256");
  for (const filePath of files.sort()) {
    hash.update(path.relative(root, filePath));
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const settled = promise.then(
    (value) => ({ type: "value", value }),
    (error) => ({ type: "error", error }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
  });
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}

function sourceEvidence(value) {
  const hasUnsavedChangesAvailable = Object.prototype.hasOwnProperty.call(value, "hasUnsavedChanges");
  return {
    captureRepresents: "DESKTOP_SESSION",
    hasUnsavedChangesAvailable,
    hasUnsavedChanges: hasUnsavedChangesAvailable ? value.hasUnsavedChanges : null,
    diskAlignment: hasUnsavedChangesAvailable
      ? (value.hasUnsavedChanges ? "SESSION_DIFFERS_FROM_DISK" : "REPORTED_SAVED")
      : "UNKNOWN",
  };
}

function initialCaptureState(targetPath, instance, outputDir, pages, runtime) {
  return {
    schemaVersion: SCHEMA_VERSION,
    operation: "capture-all",
    status: "PENDING",
    targetPath: path.resolve(targetPath),
    desktopPid: instance.pid,
    outputDir: path.resolve(outputDir),
    startedAt: new Date(runtime.now()).toISOString(),
    hostOperationId: null,
    cancellationSupported: false,
    sourceEvidence: sourceEvidence(instance),
    pages: pages.map((page, index) => ({
      index,
      pageId: page.id,
      pageDisplayName: page.displayName ?? page.id,
      sourceFingerprint: pageFingerprint(page),
      status: "pending",
    })),
  };
}

function captureResult(state, checkpointPath, status, extra = {}) {
  const completed = state.pages.filter((page) => page.status === "completed");
  const failures = state.pages.filter((page) => page.status === "failed" || page.status === "unknown");
  const evidenceByCapture = completed.map((page) => page.sourceEvidence ?? {
    captureRepresents: "DESKTOP_SESSION",
    hasUnsavedChangesAvailable: false,
    hasUnsavedChanges: null,
    diskAlignment: "UNKNOWN",
  });
  const evidenceSignatures = new Set(evidenceByCapture.map((evidence) => JSON.stringify(evidence)));
  const aggregateEvidence = evidenceSignatures.size <= 1
    ? (evidenceByCapture[0] ?? state.sourceEvidence)
    : {
        captureRepresents: "MULTIPLE_DESKTOP_SESSION_STATES",
        hasUnsavedChangesAvailable: null,
        hasUnsavedChanges: null,
        diskAlignment: "MIXED",
      };
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: status === "COMPLETE",
    operation: "capture-all",
    status,
    target: targetSummary(state.targetPath),
    desktopPid: state.desktopPid,
    checkpointPath,
    progress: { completed: completed.length, total: state.pages.length },
    captures: completed.map((page, index) => ({
      pageId: page.pageId,
      outputPath: page.outputPath,
      sourceEvidence: evidenceByCapture[index],
    })),
    sourceEvidence: aggregateEvidence,
    currentSessionEvidence: state.sourceEvidence,
    failures: failures.map((page) => ({ pageId: page.pageId, status: page.status, error: page.error })),
    visualValidationBlocked: status !== "COMPLETE",
    offlineWorkCanContinue: status !== "COMPLETE",
    ...extra,
  };
}

export async function captureAll(runtime, store, targetPath, options) {
  if (options.pid === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "capture-all",
      status: "PID_REQUIRED",
      target: targetSummary(targetPath),
      detail: "Pass the Desktop PID returned by resolve. No host call was made.",
    };
  }
  const lockKey = String(options.pid);
  const deadline = runtime.now() + Math.max(1, options.totalMs ?? 20_000);
  const lock = store.acquire("host-lock", lockKey, {
    pid: process.pid,
    desktopPid: Number(options.pid),
    targetPath: path.resolve(targetPath),
    operation: "capture-all",
    uncertain: false,
    acquiredAt: new Date(runtime.now()).toISOString(),
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "capture-all",
      status: lock.uncertain ? "HOST_STATE_UNKNOWN" : "HOST_BUSY",
      desktopPid: Number(options.pid),
      lockPath: lock.path,
      offlineWorkCanContinue: true,
    };
  }
  try {
    return await captureAllLocked(runtime, store, targetPath, { ...options, deadline, lockId: lock.lockId }, lockKey);
  } finally {
    const currentLock = store.read("host-lock", lockKey);
    if (currentLock?.uncertain !== true) store.release("host-lock", lockKey, lock.lockId);
  }
}

async function captureAllLocked(runtime, store, targetPath, options, lockKey) {
  const resolved = await readSelection(runtime, targetPath, {
    pid: options.pid,
    hardTimeoutMs: Math.max(1, options.deadline - runtime.now()),
  });
  if (resolved.selection.pathMatches.length > 1 && options.pid === undefined) {
    return ambiguousResult("capture-all", targetPath, resolved.selection);
  }
  if (resolved.selection.matches.length !== 1) {
    return notReadyResult("capture-all", targetPath, resolved.selection, {
      requestedPid: options.pid,
      detail: "Capture did not start because the target path and Desktop PID were not verified.",
    });
  }
  const instance = resolved.selection.matches[0];
  if (!Array.isArray(instance.pages)) {
    return notReadyResult("capture-all", targetPath, resolved.selection, {
      status: "VISUAL_VALIDATION_BLOCKED",
      detail: "The target page list is unavailable.",
      pagesError: instance.pagesError ? errorPayload(instance.pagesError) : undefined,
    });
  }

  const captureKey = `${normalizeForComparison(targetPath, runtime.platform)}|${path.resolve(options.outputDir)}`;
  let session;
  try {
    let state = store.read("capture", captureKey);
    if (state && state.desktopPid !== instance.pid) {
      if (runtime.isProcessRunning?.(state.desktopPid) !== false) {
        return captureResult(state, store.keyPath("capture", captureKey), "TARGET_NOT_READY", {
          detail: "The checkpoint belongs to another Desktop PID that may still be running.",
        });
      }
      state.previousDesktopPid = state.desktopPid;
      state.desktopPid = instance.pid;
      state.resumedAfterHostRestart = true;
    }
    if (!state) state = initialCaptureState(targetPath, instance, options.outputDir, instance.pages, runtime);
    else {
      state.sourceEvidence = sourceEvidence(instance);
      const previousById = new Map(state.pages.map((page) => [page.pageId, page]));
      const currentIds = new Set(instance.pages.map((page) => page.id));
      const removed = state.pages.filter((page) => !currentIds.has(page.pageId));
      if (removed.length > 0) {
        state.removedPages = [
          ...(state.removedPages ?? []),
          ...removed.map((page) => ({ ...page, removedAt: new Date(runtime.now()).toISOString() })),
        ];
      }
      state.pages = instance.pages.map((page, index) => {
        const previous = previousById.get(page.id);
        if (!previous) {
          return {
            index,
            pageId: page.id,
            pageDisplayName: page.displayName ?? page.id,
            sourceFingerprint: pageFingerprint(page),
            status: "pending",
          };
        }
        const reconciled = {
          ...previous,
          index,
          pageDisplayName: page.displayName ?? page.id,
        };
        if (reconciled.status === "failed") {
          reconciled.status = "pending";
          delete reconciled.error;
        }
        const currentFingerprint = pageFingerprint(page);
        if (reconciled.status === "completed" && currentFingerprint && reconciled.sourceFingerprint !== currentFingerprint) {
          reconciled.status = "pending";
          delete reconciled.completedAt;
          delete reconciled.outputPath;
        }
        reconciled.sourceFingerprint = currentFingerprint;
        if (reconciled.status === "completed" && (!reconciled.outputPath || !fs.existsSync(reconciled.outputPath))) {
          reconciled.status = "pending";
          delete reconciled.completedAt;
          delete reconciled.outputPath;
        }
        return reconciled;
      });
    }
    let pagesAttemptedThisRun = 0;
    for (const page of state.pages) {
      if (page.status === "in_flight") {
        page.status = "unknown";
        page.error = {
          code: "OPERATION_STATE_UNKNOWN",
          message: "The previous adapter process ended while this page request was in flight.",
        };
      }
    }
    const checkpointPath = store.write("capture", captureKey, state);
    const deadline = options.deadline;
    if (runtime.now() >= deadline) {
      state.status = "PARTIAL_TIMEOUT";
      store.write("capture", captureKey, state);
      return captureResult(state, checkpointPath, "PARTIAL_TIMEOUT", {
        detail: "The total deadline expired during target verification; no screenshot request started.",
      });
    }
    const sessionPromise = runtime.openSession({ pid: String(instance.pid), waitMs: 0 });
    const sessionBudget = Math.max(1, Math.min(5_000, deadline - runtime.now()));
    const opened = await settleWithin(sessionPromise, sessionBudget);
    if (opened.type === "timeout") {
      sessionPromise.then((lateSession) => lateSession.dispose(), () => {});
      state.status = "TARGET_NOT_READY";
      store.write("capture", captureKey, state);
      return captureResult(state, checkpointPath, "TARGET_NOT_READY", {
        detail: "Timed out while establishing the selected Bridge session; no screenshot request started.",
      });
    }
    if (opened.type === "error") throw opened.error;
    session = opened.value;
    const methods = new Set((session.manifest.methods ?? []).map((method) => method.name));
    if (!methods.has(BRIDGE_METHODS.snapshot)) {
      state.status = "UNSUPPORTED_CAPABILITY";
      store.write("capture", captureKey, state);
      return captureResult(state, checkpointPath, "UNSUPPORTED_CAPABILITY", {
        requiredMethod: BRIDGE_METHODS.snapshot,
        availableMethods: [...methods].sort(),
      });
    }

    for (const page of state.pages) {
      if (page.status === "completed" || page.status === "failed" || page.status === "unknown") continue;
      const remaining = deadline - runtime.now();
      if (remaining <= 0) {
        state.status = "PARTIAL_TIMEOUT";
        store.write("capture", captureKey, state);
        return captureResult(state, checkpointPath, "PARTIAL_TIMEOUT", {
          detail: "The total deadline expired before another page request started.",
        });
      }
      const outputPath = path.join(
        path.resolve(options.outputDir),
        `${String(page.index + 1).padStart(3, "0")}-${safeFilePart(page.pageDisplayName)}-${safeFilePart(page.pageId)}.png`,
      );
      page.status = "in_flight";
      page.startedAt = new Date(runtime.now()).toISOString();
      page.outputPath = outputPath;
      state.status = "RUNNING";
      store.write("capture", captureKey, state);
      store.write("host-lock", lockKey, {
        lockId: options.lockId,
        pid: process.pid,
        desktopPid: instance.pid,
        targetPath: path.resolve(targetPath),
        operation: "capture-all",
        pageId: page.pageId,
        uncertain: true,
        acquiredAt: page.startedAt,
      });

      const pageBudget = Math.max(1, Math.min(remaining, options.pageMs ?? 10_000));
      const identity = await settleWithin(session.getApplicationState({ waitMs: 0 }), Math.min(pageBudget, 5_000));
      if (identity.type === "timeout") {
        page.status = "unknown";
        page.error = { code: "OPERATION_STATE_UNKNOWN", message: "Target identity check timed out before capture." };
        state.status = "PARTIAL_TIMEOUT";
        store.write("capture", captureKey, state);
        return captureResult(state, checkpointPath, "PARTIAL_TIMEOUT", {
          operationStateUnknown: true,
          action: "No screenshot was submitted after the uncertain identity check. Do not issue another host command for this PID.",
        });
      }
      if (identity.type === "error") {
        page.status = "pending";
        delete page.startedAt;
        delete page.outputPath;
        state.status = "TARGET_NOT_READY";
        store.write("capture", captureKey, state);
        store.write("host-lock", lockKey, {
          lockId: options.lockId,
          pid: process.pid,
          desktopPid: instance.pid,
          targetPath: path.resolve(targetPath),
          operation: "capture-all",
          uncertain: false,
        });
        return captureResult(state, checkpointPath, "TARGET_NOT_READY", {
          detail: "The target identity check failed before screenshot submission.",
          error: errorPayload(identity.error),
        });
      }
      const sessionSelection = selectTarget([{
        pid: instance.pid,
        sessionId: instance.sessionId,
        bridgeStatus: "connected",
        currentFilePath: identity.value.currentFilePath,
        reportDir: runtime.resolveReportDir(identity.value.currentFilePath),
      }], targetPath, {
        pid: instance.pid,
        platform: runtime.platform,
        sessionId: runtime.sessionId,
        resolveReportDir: runtime.resolveReportDir,
      });
      if (sessionSelection.matches.length !== 1) {
        page.status = "pending";
        delete page.startedAt;
        delete page.outputPath;
        state.status = "TARGET_NOT_READY";
        store.write("capture", captureKey, state);
        store.write("host-lock", lockKey, {
          lockId: options.lockId,
          pid: process.pid,
          desktopPid: instance.pid,
          targetPath: path.resolve(targetPath),
          operation: "capture-all",
          uncertain: false,
        });
        return captureResult(state, checkpointPath, "TARGET_NOT_READY", {
          detail: "The selected Desktop PID changed files before capture. No screenshot request started.",
        });
      }
      state.sourceEvidence = sourceEvidence(identity.value);
      if (runtime.now() >= deadline) {
        page.status = "pending";
        delete page.startedAt;
        delete page.outputPath;
        state.status = "PARTIAL_TIMEOUT";
        store.write("capture", captureKey, state);
        store.write("host-lock", lockKey, {
          lockId: options.lockId,
          pid: process.pid,
          desktopPid: instance.pid,
          targetPath: path.resolve(targetPath),
          operation: "capture-all",
          uncertain: false,
        });
        return captureResult(state, checkpointPath, "PARTIAL_TIMEOUT", {
          detail: "The total deadline expired after identity verification and before screenshot submission.",
        });
      }
      const captureBudget = Math.max(1, Math.min(deadline - runtime.now(), options.pageMs ?? 10_000));
      const settled = await settleWithin(session.captureScreenshot({
        page: page.pageId,
        pageDisplayName: page.pageDisplayName,
        scale: options.scale ?? 2,
        waitMs: 0,
        outputPath,
      }), captureBudget);
      if (settled.type === "timeout") {
        page.status = "unknown";
        page.error = {
          code: "OPERATION_STATE_UNKNOWN",
          message: `No response within ${captureBudget}ms. The API exposes no operation id or cancellation method.`,
        };
        state.status = "PARTIAL_TIMEOUT";
        store.write("capture", captureKey, state);
        session.dispose();
        session = null;
        return captureResult(state, checkpointPath, "PARTIAL_TIMEOUT", {
          operationStateUnknown: true,
          action: "Do not repeat the unknown page request. Continue offline work or validate that page manually.",
        });
      }
      if (settled.type === "error") {
        page.status = "failed";
        page.error = errorPayload(settled.error);
      } else {
        page.status = "completed";
        page.completedAt = new Date(runtime.now()).toISOString();
        page.outputPath = settled.value.path ?? outputPath;
        page.sourceEvidence = { ...state.sourceEvidence };
      }
      store.write("capture", captureKey, state);
      store.write("host-lock", lockKey, {
        lockId: options.lockId,
        pid: process.pid,
        desktopPid: instance.pid,
        targetPath: path.resolve(targetPath),
        operation: "capture-all",
        uncertain: false,
      });
      pagesAttemptedThisRun += 1;
      if (options.maxPages !== undefined && pagesAttemptedThisRun >= options.maxPages &&
          state.pages.some((candidate) => candidate.status === "pending")) {
        state.status = "PARTIAL_CHECKPOINT";
        store.write("capture", captureKey, state);
        return captureResult(state, checkpointPath, "PARTIAL_CHECKPOINT", {
          detail: `Stopped after ${pagesAttemptedThisRun} page request(s) as requested.`,
        });
      }
    }

    state.status = state.pages.every((page) => page.status === "completed") ? "COMPLETE" : "PARTIAL";
    store.write("capture", captureKey, state);
    return captureResult(state, checkpointPath, state.status);
  } finally {
    session?.dispose();
  }
}

export async function inspectCapabilities(runtime, store, targetPath, options = {}) {
  if (options.pid === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "capabilities",
      status: "PID_REQUIRED",
      target: targetSummary(targetPath),
      detail: "Pass the Desktop PID returned by resolve. No host call was made.",
    };
  }
  const hostLock = store.read("host-lock", String(options.pid));
  if (hostLock?.uncertain === true) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "capabilities",
      status: "HOST_STATE_UNKNOWN",
      target: targetSummary(targetPath),
      desktopPid: Number(options.pid),
      lockPath: store.keyPath("host-lock", String(options.pid)),
      offlineWorkCanContinue: true,
    };
  }
  const resolved = await readSelection(runtime, targetPath, { pid: options.pid });
  if (resolved.selection.pathMatches.length > 1 && options.pid === undefined) {
    return ambiguousResult("capabilities", targetPath, resolved.selection);
  }
  if (resolved.selection.matches.length !== 1) {
    return notReadyResult("capabilities", targetPath, resolved.selection, { requestedPid: options.pid });
  }
  const instance = resolved.selection.matches[0];
  const cacheKey = `${runtime.bridgeVersion}|${instance.pid}`;
  const cached = store.read("capabilities", cacheKey);
  if (cached) return { ...cached, cached: true, checkpointPath: store.keyPath("capabilities", cacheKey) };

  const session = await runtime.openSession({ pid: String(instance.pid), waitMs: 0 });
  try {
    const methods = (session.manifest.methods ?? []).map((method) => method.name).filter(Boolean).sort();
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      operation: "capabilities",
      status: "READY",
      cached: false,
      bridgeVersion: runtime.bridgeVersion,
      desktopPid: instance.pid,
      methods,
      capabilities: {
        applicationState: methods.includes(BRIDGE_METHODS.applicationState),
        reload: methods.includes(BRIDGE_METHODS.reload),
        screenshot: methods.includes(BRIDGE_METHODS.snapshot),
        save: false,
        saveAs: false,
        exportCompletePbip: false,
      },
      notes: {
        exportTmdl: "Model metadata only; it is not a complete report or PBIP export.",
      },
    };
    const checkpointPath = store.write("capabilities", cacheKey, result);
    return { ...result, checkpointPath };
  } finally {
    session.dispose();
  }
}

export function unsupportedSaveAs(store, sourcePath, destinationPath, options = {}) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (pathsEqual(source, destination)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "save-as",
      status: "INVALID_DESTINATION",
      detail: "The destination must differ from the original file.",
    };
  }
  if (![".pbip", ".pbix"].includes(path.extname(destination).toLowerCase())) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "save-as",
      status: "INVALID_DESTINATION",
      detail: "The destination extension must be .pbip or .pbix.",
    };
  }
  if (fs.existsSync(destination)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "save-as",
      status: "INVALID_DESTINATION",
      detail: "The manual Save As destination must not already exist.",
    };
  }
  const checkpoint = {
    schemaVersion: SCHEMA_VERSION,
    operation: "save-as",
    status: "WAITING_FOR_MANUAL_SAVE_AS",
    sourcePath: source,
    destinationPath: destination,
    capability: "UNSUPPORTED_CAPABILITY",
    createdAt: new Date().toISOString(),
    execution: options.execution,
  };
  const checkpointPath = store.write("save-as", `${source}|${destination}`, checkpoint);
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation: "save-as",
    status: "UNSUPPORTED_CAPABILITY",
    capability: "SAVE_AS_OR_COMPLETE_PBIP_EXPORT",
    checkpointPath,
    manualAction: `In Power BI Desktop, use File > Save as once and save to: ${destination}`,
    resumeCondition: "Resume after the destination file or PBIP project appears.",
    originalPreserved: true,
    execution: options.execution,
  };
}

export function requestManualIntervention(store, targetPath, kind, options = {}) {
  if (!["refresh", "save"].includes(kind)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "manual-intervention",
      status: "INVALID_MANUAL_INTERVENTION",
      allowedKinds: ["refresh", "save"],
    };
  }
  const taskId = options.execution?.taskId;
  const normalizedTarget = normalizeForComparison(targetPath);
  const lockKey = `${taskId}|${normalizedTarget}|${kind}`;
  const lock = store.acquire("manual-lock", lockKey, {
    pid: process.pid,
    taskId,
    targetPath: path.resolve(targetPath),
    kind,
    uncertain: false,
  });
  if (!lock.acquired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: `request-${kind}`,
      status: "MANUAL_ACTION_IN_PROGRESS",
      target: targetSummary(targetPath),
      lockPath: lock.path,
      detail: "Another process is creating this manual checkpoint. No manual action was requested.",
      execution: options.execution,
    };
  }
  try {
    const existing = store.find("manual-intervention", (checkpoint) =>
      checkpoint.operation === "manual-intervention" &&
      checkpoint.taskId === taskId &&
      checkpoint.kind === kind &&
      checkpoint.status === "WAITING_FOR_MANUAL_ACTION" &&
      pathsEqual(checkpoint.targetPath, targetPath)
    );
    if (existing) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        operation: `request-${kind}`,
        status: existing.value.status,
        target: targetSummary(targetPath),
        checkpointPath: existing.path,
        requestRepeated: false,
        detail: "The manual action was already requested for this checkpoint; it was not requested again.",
        execution: options.execution,
      };
    }
    const checkpoint = {
      schemaVersion: SCHEMA_VERSION,
      operation: "manual-intervention",
      kind,
      status: "WAITING_FOR_MANUAL_ACTION",
      taskId,
      targetPath: path.resolve(targetPath),
      requestedAt: new Date(options.now ?? Date.now()).toISOString(),
      execution: options.execution,
    };
    const key = `${lockKey}|${crypto.randomUUID()}`;
    const checkpointPath = store.write("manual-intervention", key, checkpoint);
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: `request-${kind}`,
      status: "MANUAL_ACTION_REQUIRED",
      target: targetSummary(targetPath),
      checkpointPath,
      requestRepeated: false,
      manualAction: kind === "refresh"
        ? "In Power BI Desktop, run Refresh once, wait for it to finish, and then confirm completion."
        : "In Power BI Desktop, press Ctrl+S once, wait for it to finish, and then confirm completion.",
      resumeCondition: "Resume this checkpoint with --completed only after explicit user confirmation.",
      execution: options.execution,
    };
  } finally {
    store.release("manual-lock", lockKey, lock.lockId);
  }
}

function invalidCheckpoint(detail) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    operation: "resume",
    status: "INVALID_CHECKPOINT",
    detail,
  };
}

export function resumeCheckpoint(checkpointPath, options = {}) {
  const resolvedCheckpointPath = path.resolve(checkpointPath);
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(resolvedCheckpointPath, "utf8"));
  } catch {
    return invalidCheckpoint("The checkpoint is missing or is not valid JSON.");
  }
  if (checkpoint?.schemaVersion !== SCHEMA_VERSION ||
      !["manual-intervention", "save-as"].includes(checkpoint.operation)) {
    return invalidCheckpoint("The checkpoint schema or operation is invalid.");
  }
  const expectedDirectory = path.resolve(options.store?.root ?? "", checkpoint.operation);
  if (!options.store || path.dirname(resolvedCheckpointPath) !== expectedDirectory ||
      path.extname(resolvedCheckpointPath).toLowerCase() !== ".json") {
    return invalidCheckpoint("The checkpoint is not a managed file in the active state store.");
  }
  if (checkpoint.operation === "manual-intervention") {
    if (!["refresh", "save"].includes(checkpoint.kind) ||
        !["WAITING_FOR_MANUAL_ACTION", "READY_TO_RESUME"].includes(checkpoint.status) ||
        typeof checkpoint.taskId !== "string" || !checkpoint.taskId.trim() ||
        typeof checkpoint.targetPath !== "string" || !checkpoint.targetPath.trim()) {
      return invalidCheckpoint("The manual intervention checkpoint is incomplete or invalid.");
    }
    if (options.completed === true && checkpoint.status !== "READY_TO_RESUME") {
      checkpoint.status = "READY_TO_RESUME";
      checkpoint.completedAt = new Date(options.now ?? Date.now()).toISOString();
      writeJsonAtomic(resolvedCheckpointPath, checkpoint);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: checkpoint.status === "READY_TO_RESUME",
      operation: "resume",
      status: checkpoint.status,
      kind: checkpoint.kind,
      target: targetSummary(checkpoint.targetPath),
      checkpointPath: resolvedCheckpointPath,
      manualActionRepeated: false,
      execution: checkpoint.execution,
    };
  }
  if (checkpoint.status !== "WAITING_FOR_MANUAL_SAVE_AS" ||
      typeof checkpoint.sourcePath !== "string" || !checkpoint.sourcePath.trim() ||
      typeof checkpoint.destinationPath !== "string" || !checkpoint.destinationPath.trim()) {
    return invalidCheckpoint("The Save As checkpoint is incomplete or invalid.");
  }
  const validation = validateManualDestination(checkpoint.destinationPath);
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: validation.ready || validation.appeared === true,
    operation: "resume",
    status: validation.ready
      ? "READY_TO_RESUME"
      : validation.appeared
        ? "DESTINATION_APPEARED"
        : "WAITING_FOR_MANUAL_SAVE_AS",
    destinationPath: checkpoint.destinationPath,
    openedAnotherInstance: false,
    detail: validation.detail,
    saveCompletionProven: validation.ready,
    manualConfirmationRequired: validation.appeared === true && !validation.ready,
    execution: checkpoint.execution,
  };
}

export async function confirmPbixSaveWithDesktop(runtime, store, checkpointPath, pid) {
  const base = resumeCheckpoint(checkpointPath, { store });
  if (base.status !== "DESTINATION_APPEARED" || path.extname(base.destinationPath).toLowerCase() !== ".pbix") {
    return base;
  }
  const hostLock = store.read("host-lock", String(pid));
  if (hostLock?.uncertain === true) {
    return {
      ...base,
      status: "HOST_STATE_UNKNOWN",
      ok: false,
      desktopPid: Number(pid),
      lockPath: store.keyPath("host-lock", String(pid)),
      offlineWorkCanContinue: true,
    };
  }
  const resolved = await readSelection(runtime, base.destinationPath, { pid });
  if (resolved.selection.matches.length !== 1) {
    return {
      ...base,
      status: "MANUAL_CONFIRMATION_PENDING",
      ok: false,
      desktopPid: Number(pid),
      detail: "The selected Desktop PID does not publicly report the PBIX destination as its current file.",
      publicDesktopEvidence: {
        currentFilePathMatches: false,
        hasUnsavedChanges: null,
      },
    };
  }
  const instance = resolved.selection.matches[0];
  const sessionPromise = runtime.openSession({ pid: String(instance.pid), waitMs: 0 });
  const opened = await settleWithin(sessionPromise, 5_000);
  if (opened.type !== "value") {
    if (opened.type === "timeout") sessionPromise.then((lateSession) => lateSession.dispose(), () => {});
    return {
      ...base,
      status: "MANUAL_CONFIRMATION_PENDING",
      ok: false,
      desktopPid: instance.pid,
      detail: "The selected Bridge session could not provide direct public save evidence.",
      saveCompletionProven: false,
      manualConfirmationRequired: true,
    };
  }
  const session = opened.value;
  try {
    const stateResult = await settleWithin(session.getApplicationState({ waitMs: 0 }), 5_000);
    if (stateResult.type !== "value") {
      return {
        ...base,
        status: "MANUAL_CONFIRMATION_PENDING",
        ok: false,
        desktopPid: instance.pid,
        detail: "Direct application state was unavailable; manual save confirmation remains required.",
        saveCompletionProven: false,
        manualConfirmationRequired: true,
      };
    }
    const state = stateResult.value;
    const currentFilePathMatches = pathsEqual(state.currentFilePath, base.destinationPath, runtime.platform);
    const flagAvailable = Object.prototype.hasOwnProperty.call(state, "hasUnsavedChanges");
    const saved = currentFilePathMatches && flagAvailable && state.hasUnsavedChanges === false;
    return {
      ...base,
      status: saved ? "READY_TO_RESUME" : "MANUAL_CONFIRMATION_PENDING",
      ok: saved,
      desktopPid: instance.pid,
      saveCompletionProven: saved,
      manualConfirmationRequired: !saved,
      detail: saved
        ? "Desktop directly reports the destination as current and hasUnsavedChanges=false."
        : "Desktop did not provide both a matching current path and an explicit hasUnsavedChanges=false value.",
      publicDesktopEvidence: {
        currentFilePathMatches,
        currentFilePath: state.currentFilePath,
        hasUnsavedChangesAvailable: flagAvailable,
        hasUnsavedChanges: flagAvailable ? state.hasUnsavedChanges : null,
        bridgeStatus: instance.bridgeStatus,
      },
    };
  } finally {
    session.dispose();
  }
}

function validateManualDestination(destinationPath) {
  if (!fs.existsSync(destinationPath)) return { ready: false, detail: "The destination does not exist yet." };
  const extension = path.extname(destinationPath).toLowerCase();
  if (extension === ".pbip") {
    try {
      const definition = JSON.parse(fs.readFileSync(destinationPath, "utf8"));
      const reportRelative = definition?.artifacts?.[0]?.report?.path;
      if (typeof reportRelative !== "string" || path.isAbsolute(reportRelative)) {
        return { ready: false, detail: "The PBIP does not contain a valid relative report reference." };
      }
      const reportDir = path.resolve(path.dirname(destinationPath), reportRelative);
      const parent = path.dirname(destinationPath).replace(/[\\/]+$/, "") + path.sep;
      const pbirPath = path.join(reportDir, "definition.pbir");
      if (!reportDir.startsWith(parent) || !fs.existsSync(pbirPath)) {
        return { ready: false, detail: "The referenced report folder is incomplete." };
      }
      const pbir = JSON.parse(fs.readFileSync(pbirPath, "utf8"));
      const byPath = pbir?.datasetReference?.byPath?.path;
      const byConnection = pbir?.datasetReference?.byConnection?.connectionString;
      if (typeof byPath !== "string" && typeof byConnection !== "string") {
        return { ready: false, detail: "The report definition has no valid semantic model reference." };
      }
      if (typeof byPath === "string") {
        if (path.isAbsolute(byPath)) return { ready: false, detail: "The semantic model reference must be relative." };
        const modelDir = path.resolve(reportDir, byPath);
        if (!modelDir.startsWith(parent) || !fs.existsSync(path.join(modelDir, "definition.pbism"))) {
          return { ready: false, detail: "The referenced semantic model folder is incomplete." };
        }
      }
      const reportBody = path.join(reportDir, "definition", "report.json");
      const legacyReportBody = path.join(reportDir, "report.json");
      if (!fs.existsSync(reportBody) && !fs.existsSync(legacyReportBody)) {
        return { ready: false, detail: "The report body is incomplete." };
      }
      const effectiveReportBody = fs.existsSync(reportBody) ? reportBody : legacyReportBody;
      const reportJson = JSON.parse(fs.readFileSync(effectiveReportBody, "utf8"));
      if (typeof reportJson?.$schema !== "string") {
        return { ready: false, detail: "The report body is not a valid public project definition." };
      }
      const criticalFiles = [destinationPath, pbirPath, effectiveReportBody];
      if (typeof byPath === "string") {
        const modelDir = path.resolve(reportDir, byPath);
        const modelDefinition = path.join(modelDir, "definition.pbism");
        const modelJson = JSON.parse(fs.readFileSync(modelDefinition, "utf8"));
        if (typeof modelJson?.$schema !== "string" || typeof modelJson?.version !== "string" ||
            !fs.existsSync(path.join(modelDir, "definition"))) {
          return { ready: false, detail: "The semantic model definition is not complete." };
        }
        criticalFiles.push(modelDefinition);
      }
      if (fs.existsSync(path.join(reportDir, "definition"))) {
        const versionPath = path.join(reportDir, "definition", "version.json");
        if (!fs.existsSync(versionPath)) return { ready: false, detail: "The PBIR version metadata is missing." };
        const versionJson = JSON.parse(fs.readFileSync(versionPath, "utf8"));
        if (typeof versionJson?.$schema !== "string" || typeof versionJson?.version !== "string") {
          return { ready: false, detail: "The PBIR version metadata is invalid." };
        }
        criticalFiles.push(versionPath);
      }
      if (criticalFiles.some((filePath) => Date.now() - fs.statSync(filePath).mtimeMs < 2_000)) {
        return { ready: false, detail: "The PBIP project files may still be written. Retry the checkpoint shortly." };
      }
      return { ready: true, detail: "The PBIP and referenced report definition are present." };
    } catch {
      return { ready: false, detail: "The PBIP is not complete valid JSON yet." };
    }
  }
  if (extension === ".pbix") {
    const stat = fs.statSync(destinationPath);
    if (!stat.isFile() || stat.size === 0 || Date.now() - stat.mtimeMs < 2_000) {
      return { ready: false, detail: "The PBIX is empty or may still be written." };
    }
    return {
      ready: false,
      appeared: true,
      detail: "A non-empty PBIX appeared, but completion cannot be proven without inspecting its package. Confirm the Desktop save completed before host operations.",
    };
  }
  return { ready: false, detail: "The destination must be a PBIP or PBIX file." };
}
