import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const BRIDGE_METHODS = Object.freeze({
  applicationState: "application.state.get/v1",
  reload: "file.reload/v1",
  snapshot: "report.snapshot.capture/v1",
});

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
  const connected = instances.filter((instance) => instance.bridgeStatus === "connected");
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
      currentFilePath: instance.currentFilePath,
    },
    bridge: { status: "CONNECTED", pid: instance.pid },
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
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { acquired: true, path: filePath };
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
              fs.rmSync(filePath, { force: true });
              fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
              return { acquired: true, path: filePath, recoveredStaleLock: true };
            }
          }
        }
      } catch {
        // An unreadable lock remains conservative: never overlap host commands.
      }
      return { acquired: false, path: filePath };
    }
  }

  release(kind, key) {
    fs.rmSync(this.keyPath(kind, key), { force: true });
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
      resolveReportDir: runtime.resolveReportDir,
    }),
  };
}

export async function resolveTarget(runtime, targetPath, options = {}) {
  let quarantine = options.store?.find("host-lock", (lock) =>
    lock.uncertain === true && pathsEqual(lock.targetPath, targetPath, runtime.platform)
  );
  if (quarantine && runtime.isProcessRunning?.(quarantine.value.desktopPid) === false) {
    options.store.release("host-lock", String(quarantine.value.desktopPid));
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

export async function openTarget(runtime, store, targetPath, options = {}) {
  const stateKey = normalizeForComparison(targetPath, runtime.platform);
  let quarantine = store.find("host-lock", (lock) =>
    lock.uncertain === true && pathsEqual(lock.targetPath, targetPath, runtime.platform)
  );
  if (quarantine && runtime.isProcessRunning?.(quarantine.value.desktopPid) === false) {
    store.release("host-lock", String(quarantine.value.desktopPid));
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
  if ((resolved.status.diagnostics ?? []).length > 0 && resolved.status.instances.length === 0) {
    return notReadyResult("open", targetPath, resolved.selection, {
      diagnostics: resolved.status.diagnostics,
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
    store.release("open-lock", stateKey);
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
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: status === "COMPLETE",
    operation: "capture-all",
    status,
    target: targetSummary(state.targetPath),
    desktopPid: state.desktopPid,
    checkpointPath,
    progress: { completed: completed.length, total: state.pages.length },
    captures: completed.map((page) => ({ pageId: page.pageId, outputPath: page.outputPath })),
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
    return await captureAllLocked(runtime, store, targetPath, { ...options, deadline }, lockKey);
  } finally {
    const currentLock = store.read("host-lock", lockKey);
    if (currentLock?.uncertain !== true) store.release("host-lock", lockKey);
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
        bridgeStatus: "connected",
        currentFilePath: identity.value.currentFilePath,
        reportDir: runtime.resolveReportDir(identity.value.currentFilePath),
      }], targetPath, {
        pid: instance.pid,
        platform: runtime.platform,
        resolveReportDir: runtime.resolveReportDir,
      });
      if (sessionSelection.matches.length !== 1) {
        page.status = "pending";
        delete page.startedAt;
        delete page.outputPath;
        state.status = "TARGET_NOT_READY";
        store.write("capture", captureKey, state);
        store.write("host-lock", lockKey, {
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
      if (runtime.now() >= deadline) {
        page.status = "pending";
        delete page.startedAt;
        delete page.outputPath;
        state.status = "PARTIAL_TIMEOUT";
        store.write("capture", captureKey, state);
        store.write("host-lock", lockKey, {
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
      }
      store.write("capture", captureKey, state);
      store.write("host-lock", lockKey, {
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

export function unsupportedSaveAs(store, sourcePath, destinationPath) {
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
  };
}

export function resumeCheckpoint(checkpointPath) {
  const checkpoint = JSON.parse(fs.readFileSync(path.resolve(checkpointPath), "utf8"));
  if (checkpoint.operation !== "save-as") {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      operation: "resume",
      status: "INVALID_CHECKPOINT",
    };
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
  };
}

export async function confirmPbixSaveWithDesktop(runtime, store, checkpointPath, pid) {
  const base = resumeCheckpoint(checkpointPath);
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
