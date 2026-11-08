#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FileStateStore,
  authorizeExecution,
  captureAll,
  completePbirEditBatch,
  completePbirReview,
  confirmPbixSaveWithDesktop,
  inspectPbirEditCheckpoint,
  inspectCapabilities,
  openTarget,
  preparePbirEdit,
  requestManualIntervention,
  requestPbirReviewIntervention,
  resolveTarget,
  resumeCheckpoint,
  resumePbirReview,
  unsupportedSaveAs,
} from "../lib/powerbi-desktop-safe.mjs";

function parseArguments(values) {
  const positional = [];
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "new-attempt") {
      options.newAttempt = true;
      continue;
    }
    if (["completed", "new-batch", "notice-confirmed", "retry-target-read", "session-changes-need-save", "tested", "validated"].includes(name)) {
      options[name] = true;
      continue;
    }
    if (index + 1 >= values.length) throw new Error(`Missing value for --${name}.`);
    options[name] = values[++index];
  }
  return { positional, options };
}

function numberOption(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  const parsed = Number(options[name]);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative number.`);
  return parsed;
}

function defaultStateDir() {
  const parent = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "state");
  return path.join(parent, "PowerBI-OpenCode-Accelerator");
}

function processSessionIds(pids) {
  const numericPids = [...new Set(pids.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (numericPids.length === 0) return new Map();
  const script = [
    `$ids = @(${numericPids.join(",")})`,
    "@((Get-Process -Id $ids -ErrorAction SilentlyContinue) | ForEach-Object { [ordered]@{ pid = $_.Id; sessionId = $_.SessionId } }) | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3_000,
  });
  if (result.status !== 0 || result.error || !result.stdout.trim()) return new Map();
  try {
    const parsed = JSON.parse(result.stdout);
    return new Map((Array.isArray(parsed) ? parsed : [parsed]).map((item) => [Number(item.pid), Number(item.sessionId)]));
  } catch {
    return new Map();
  }
}

function interactiveSessionId(requestedSessionId) {
  const detected = processSessionIds([process.pid]).get(process.pid);
  if (!Number.isInteger(detected)) {
    const error = new Error("Could not determine the interactive Windows session. No Desktop operation was attempted.");
    error.code = "SESSION_ID_UNAVAILABLE";
    throw error;
  }
  if (requestedSessionId !== undefined) {
    const parsed = Number(requestedSessionId);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--session-id must be a non-negative integer.");
    if (parsed !== detected) {
      const error = new Error(`Requested Windows session ${parsed} does not match the caller session ${detected}. No Desktop operation was attempted.`);
      error.code = "SESSION_ID_MISMATCH";
      throw error;
    }
    return parsed;
  }
  return detected;
}

function desktopProcessSessions() {
  const script = "@((Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue) | ForEach-Object { [ordered]@{ pid = $_.Id; sessionId = $_.SessionId } }) | ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3_000,
  });
  if (result.status !== 0 || result.error) {
    return {
      processes: [],
      diagnostics: [{
        code: "DESKTOP_PROCESS_ENUMERATION_FAILED",
        message: "Power BI Desktop process enumeration failed; no Bridge operation was attempted.",
        details: { exitCode: result.status, cause: result.error?.message },
      }],
    };
  }
  if (!result.stdout.trim()) return { processes: [], diagnostics: [] };
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      processes: (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
        pid: Number(item.pid),
        sessionId: Number(item.sessionId),
      })),
      diagnostics: [],
    };
  } catch (error) {
    return {
      processes: [],
      diagnostics: [{
        code: "DESKTOP_PROCESS_ENUMERATION_FAILED",
        message: "Power BI Desktop process enumeration returned invalid JSON; no Bridge operation was attempted.",
        details: { cause: error.message },
      }],
    };
  }
}

async function loadRuntime(requestedSessionId) {
  const sessionId = interactiveSessionId(requestedSessionId);
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modulePath = path.join(installRoot, "node", "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "dist", "index.js");
  if (!fs.existsSync(modulePath)) throw new Error(`Desktop Bridge library not found: ${modulePath}`);
  const bridge = await import(pathToFileURL(modulePath).href);
  const statusWorkerPath = path.join(installRoot, "bin", "bridge-status-worker.mjs");
  const packageJson = JSON.parse(fs.readFileSync(path.join(path.dirname(modulePath), "..", "package.json"), "utf8"));
  return {
    bridgeVersion: packageJson.version,
    platform: process.platform,
    sessionId,
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    isProcessRunning: (pid) => {
      try { process.kill(Number(pid), 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
    },
    openDesktop: bridge.openDesktop,
    openSession: bridge.openSession,
    readDesktopStatus: (options) => readDesktopStatusBounded(statusWorkerPath, options, sessionId),
    resolveReportDir: bridge.resolveReportDir,
  };
}

async function readDesktopStatusBounded(statusWorkerPath, options = {}, sessionId) {
  const timeoutMs = Math.max(1, Math.min(5_000, options.hardTimeoutMs ?? 5_000));
  const requestedPid = options.pid === undefined ? undefined : Number(options.pid);
  const discoveryDeadline = Date.now() + Math.min(timeoutMs, Math.max(0, options.waitMs ?? 0));
  let discovery = { processes: [], diagnostics: [] };
  do {
    discovery = desktopProcessSessions();
    if (discovery.diagnostics.length > 0) {
      return { instances: [], diagnostics: discovery.diagnostics };
    }
    const discovered = discovery.processes;
    const hasCandidate = requestedPid === undefined
      ? discovered.some((process) => process.sessionId === sessionId)
      : discovered.some((process) => process.pid === requestedPid);
    if (hasCandidate || Date.now() >= discoveryDeadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, discoveryDeadline - Date.now())));
  } while (Date.now() < discoveryDeadline);

  const discovered = discovery.processes;
  const unresolved = discovered.filter((process) => !Number.isInteger(process.sessionId));
  const ignored = discovered.filter((process) =>
    Number.isInteger(process.sessionId) && process.sessionId !== sessionId
  );
  let candidates = discovered.filter((process) => process.sessionId === sessionId);
  if (requestedPid !== undefined) candidates = candidates.filter((process) => process.pid === requestedPid);

  const diagnostics = [...discovery.diagnostics];
  if (unresolved.length > 0) {
    diagnostics.push({
      code: "INSTANCE_SESSION_ID_UNAVAILABLE",
      message: `${unresolved.length} Power BI Desktop process(es) could not be assigned to a Windows session.`,
      details: unresolved.map((process) => ({ pid: process.pid })),
    });
  }
  if (ignored.length > 0) {
    diagnostics.push({
      code: "CROSS_SESSION_INSTANCES_IGNORED",
      message: `${ignored.length} Power BI Desktop process(es) outside interactive session ${sessionId} were ignored before Bridge discovery.`,
      details: ignored.map((process) => ({ pid: process.pid, sessionId: process.sessionId })),
    });
  }
  if (candidates.length === 0) return { instances: [], diagnostics };

  const results = await Promise.all(candidates.map((candidate) => readTargetedDesktopStatusBounded(
    statusWorkerPath,
    { ...options, pid: candidate.pid, waitMs: Math.min(timeoutMs, Math.max(0, options.waitMs ?? 0)) },
    timeoutMs,
  )));
  const instances = results.flatMap((result, index) => result.instances
      .filter((instance) => Number(instance.pid) === candidates[index].pid)
      .map((instance) => ({ ...instance, sessionId })));
  const unresolvedCandidates = candidates.filter((candidate) =>
    !instances.some((instance) => Number(instance.pid) === candidate.pid)
  );
  if (unresolvedCandidates.length > 0) {
    diagnostics.push({
      code: "DESKTOP_BRIDGE_UNAVAILABLE",
      message: `${unresolvedCandidates.length} Power BI Desktop process(es) in the interactive session could not be identified through the Bridge.`,
      details: unresolvedCandidates.map((candidate) => ({ pid: candidate.pid, sessionId: candidate.sessionId })),
    });
  }
  return {
    instances,
    diagnostics: [...diagnostics, ...results.flatMap((result) => result.diagnostics ?? [])],
  };
}

function readTargetedDesktopStatusBounded(statusWorkerPath, options, timeoutMs) {
  const args = [
    statusWorkerPath,
    String(options.pid),
    String(timeoutMs),
    String(Math.max(0, options.waitMs ?? 0)),
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      settle({
        instances: [],
        diagnostics: [{
          code: "STATUS_QUERY_TIMEOUT",
          message: `Desktop Bridge status exceeded ${timeoutMs}ms. Only the status worker was stopped.`,
          details: { exitCode: null },
        }],
      });
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill();
      child.unref();
    }, timeoutMs + 500);
    child.on("error", (error) => {
      clearTimeout(timer);
      settle({
        instances: [],
        diagnostics: [{ code: "STATUS_QUERY_FAILED", message: error.message }],
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut || exitCode === 124) {
        settle({
          instances: [],
          diagnostics: [{
            code: "STATUS_QUERY_TIMEOUT",
            message: `Desktop Bridge status exceeded ${timeoutMs}ms. Only the status worker was stopped.`,
            details: { exitCode },
          }],
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (exitCode === 0 && Array.isArray(parsed.instances)) {
          settle({ instances: parsed.instances, diagnostics: parsed.diagnostics ?? [] });
          return;
        }
        settle({
          instances: [],
          diagnostics: [{
            code: "STATUS_QUERY_FAILED",
            message: "Desktop Bridge status returned a non-success result.",
            details: { exitCode, stderr: stderr.trim().slice(0, 1_000) },
          }],
        });
      } catch (error) {
        settle({
          instances: [],
          diagnostics: [{
            code: "STATUS_RESPONSE_INVALID",
            message: "Desktop Bridge status did not return valid JSON.",
            details: { exitCode, cause: error.message, stderr: stderr.trim().slice(0, 1_000) },
          }],
        });
      }
    });
  });
}

function reportTarget(value, allowedExtensions) {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Report file not found: ${resolved}`);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new Error(`Expected ${allowedExtensions.join(" or ")} report file: ${resolved}`);
  }
  return resolved;
}

function requirePositionals(positional, count, usage) {
  if (positional.length !== count) throw new Error(`Usage: ${usage}`);
}

async function main() {
  const command = process.argv[2];
  const { positional, options } = parseArguments(process.argv.slice(3));
  const store = new FileStateStore(options["state-dir"] || defaultStateDir());
  const requestedSessionId = options["session-id"] ?? process.env.POWERBI_INTERACTIVE_SESSION_ID;
  const explicitTaskId = typeof options["task-id"] === "string" ? options["task-id"].trim() : "";
  const rawTaskId = explicitTaskId || process.env.POWERBI_EXECUTION_TASK_ID;
  const taskId = typeof rawTaskId === "string" ? rawTaskId.trim() : rawTaskId;
  const executionMode = options["execution-mode"];
  const fallbackExecutionMode = process.env.POWERBI_EXECUTION_MODE;
  const authorize = (operation, target) => authorizeExecution(store, target, {
    operation,
    taskId,
    mode: executionMode,
    fallbackMode: fallbackExecutionMode,
  });
  const includeExecution = (result, authorization) => ({
    ...result,
    execution: result.execution ?? authorization.execution,
  });

  if (command === "execution-mode") {
    requirePositionals(positional, 1, "powerbi-desktop-safe execution-mode <report> --task-id <id> [--execution-mode attended|background]");
    const target = reportTarget(positional[0], [".pbix", ".pbip"]);
    const authorization = authorize("execution-mode", target);
    if (!authorization.ok) return authorization;
    return {
      schemaVersion: 1,
      ok: true,
      operation: "execution-mode",
      status: "EXECUTION_MODE_READY",
      target: { requestedPath: target, normalizedPath: target },
      execution: authorization.execution,
    };
  }
  if (command === "save-as") {
    requirePositionals(positional, 2, "powerbi-desktop-safe save-as <source> <destination>");
    const source = reportTarget(positional[0], [".pbix", ".pbip"]);
    const authorization = authorize("save-as", source);
    if (!authorization.ok) return authorization;
    return unsupportedSaveAs(store, source, positional[1], { execution: authorization.execution });
  }
  if (["request-refresh", "request-save"].includes(command)) {
    requirePositionals(positional, 1, `powerbi-desktop-safe ${command} <report>`);
    const target = reportTarget(positional[0], [".pbix", ".pbip"]);
    const authorization = authorize(command, target);
    if (!authorization.ok) return authorization;
    return requestManualIntervention(store, target, command === "request-refresh" ? "refresh" : "save", {
      execution: authorization.execution,
    });
  }
  if (command === "prepare-pbir-edit") {
    requirePositionals(positional, 1, "powerbi-desktop-safe prepare-pbir-edit <report.pbip> [--pid <pid>]");
    const target = reportTarget(positional[0], [".pbip"]);
    const authorization = authorize("prepare-pbir-edit", target);
    if (!authorization.ok) return authorization;
    const runtime = await loadRuntime(requestedSessionId);
    return includeExecution(await preparePbirEdit(runtime, store, target, {
      pid: options.pid,
      newBatch: options["new-batch"] === true,
      execution: authorization.execution,
    }), authorization);
  }
  if (["complete-pbir-edit", "request-pbir-review", "resume-pbir-review", "complete-pbir-review"].includes(command)) {
    requirePositionals(positional, 1, `powerbi-desktop-safe ${command} <checkpoint.json>`);
    const inspected = inspectPbirEditCheckpoint(store, positional[0]);
    if (!inspected.ok) return inspected;
    const target = reportTarget(inspected.checkpoint.targetPath, [".pbip"]);
    if (!explicitTaskId) {
      return {
        schemaVersion: 1,
        ok: false,
        operation: command,
        status: "TASK_ID_REQUIRED",
        target: { requestedPath: target, normalizedPath: target },
        detail: "Pass the task ID that owns this PBIR edit checkpoint.",
      };
    }
    if (explicitTaskId !== inspected.checkpoint.taskId) {
      return {
        schemaVersion: 1,
        ok: false,
        operation: command,
        status: "TASK_ID_MISMATCH",
        target: { requestedPath: target, normalizedPath: target },
        detail: "The supplied task ID does not own this PBIR edit checkpoint.",
      };
    }
    const authorization = authorizeExecution(store, target, {
      operation: command,
      taskId: explicitTaskId,
      mode: executionMode,
      fallbackMode: fallbackExecutionMode,
    });
    if (!authorization.ok) return authorization;
    if (command === "complete-pbir-edit") {
      return includeExecution(completePbirEditBatch(store, positional[0], {
        validated: options.validated === true,
        execution: authorization.execution,
      }), authorization);
    }
    if (command === "request-pbir-review") {
      return includeExecution(requestPbirReviewIntervention(
        store,
        positional[0],
        options["notice-type"] || "unknown",
        {
          noticeConfirmed: options["notice-confirmed"] === true,
          sessionChangesNeedSave: options["session-changes-need-save"] === true,
          execution: authorization.execution,
        },
      ), authorization);
    }
    if (command === "complete-pbir-review") {
      return includeExecution(completePbirReview(store, positional[0], {
        tested: options.tested === true,
        execution: authorization.execution,
      }), authorization);
    }
    const runtime = await loadRuntime(requestedSessionId);
    return includeExecution(await resumePbirReview(runtime, store, positional[0], {
      completed: options.completed === true,
      pid: options.pid,
      retryTargetRead: options["retry-target-read"] === true,
      execution: authorization.execution,
    }), authorization);
  }
  if (command === "resume") {
    requirePositionals(positional, 1, "powerbi-desktop-safe resume <checkpoint.json>");
    const base = resumeCheckpoint(positional[0], { completed: options.completed === true, store });
    if (base.status === "DESTINATION_APPEARED" && options.pid) {
      const authorization = authorizeExecution(store, base.destinationPath, {
        operation: "resume-desktop-confirmation",
        taskId: taskId || base.execution?.taskId,
        mode: executionMode,
        fallbackMode: fallbackExecutionMode,
      });
      if (!authorization.ok) return authorization;
      const runtime = await loadRuntime(requestedSessionId);
      return includeExecution(
        await confirmPbixSaveWithDesktop(runtime, store, positional[0], options.pid),
        authorization,
      );
    }
    return base;
  }

  if (command === "open") {
    requirePositionals(positional, 1, "powerbi-desktop-safe open <report.pbip|report.pbix>");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    const authorization = authorize("open", target);
    if (!authorization.ok) return authorization;
    const runtime = await loadRuntime(requestedSessionId);
    return includeExecution(await openTarget(runtime, store, target, {
      waitMs: numberOption(options, "wait-seconds", 15) * 1000,
      newAttempt: options.newAttempt === true,
    }), authorization);
  }
  if (command === "resolve") {
    requirePositionals(positional, 1, "powerbi-desktop-safe resolve <report> [--pid <pid>]");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    const authorization = authorize("resolve", target);
    if (!authorization.ok) return authorization;
    const runtime = await loadRuntime(requestedSessionId);
    return includeExecution(await resolveTarget(runtime, target, {
      pid: options.pid,
      waitMs: numberOption(options, "wait-seconds", 0) * 1000,
      store,
    }), authorization);
  }
  if (command === "capabilities") {
    requirePositionals(positional, 1, "powerbi-desktop-safe capabilities <report> [--pid <pid>]");
    if (!options.pid) throw new Error("--pid is required for capabilities.");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    const authorization = authorize("capabilities", target);
    if (!authorization.ok) return authorization;
    const runtime = await loadRuntime(requestedSessionId);
    return includeExecution(await inspectCapabilities(runtime, store, target, { pid: options.pid }), authorization);
  }
  if (command === "capture-all") {
    requirePositionals(positional, 1, "powerbi-desktop-safe capture-all <report> --output-dir <directory> [--pid <pid>]");
    if (!options["output-dir"]) throw new Error("--output-dir is required.");
    if (!options.pid) throw new Error("--pid is required for capture-all.");
    const target = reportTarget(positional[0], [".pbip"]);
    const authorization = authorize("capture-all", target);
    if (!authorization.ok) return authorization;
    const runtime = await loadRuntime(requestedSessionId);
    const maxPages = options["max-pages"] === undefined ? undefined : numberOption(options, "max-pages", undefined);
    if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
      throw new Error("--max-pages must be a positive integer.");
    }
    return includeExecution(await captureAll(runtime, store, target, {
      pid: options.pid,
      outputDir: options["output-dir"],
      totalMs: numberOption(options, "total-seconds", 20) * 1000,
      pageMs: numberOption(options, "page-seconds", 10) * 1000,
      scale: numberOption(options, "scale", 2),
      maxPages,
    }), authorization);
  }
  throw new Error("Commands: execution-mode, open, resolve, capabilities, capture-all, prepare-pbir-edit, complete-pbir-edit, request-pbir-review, resume-pbir-review, complete-pbir-review, request-refresh, request-save, save-as, resume.");
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (["OPEN_FAILED", "INVALID_DESTINATION", "INVALID_CHECKPOINT", "INVALID_EXECUTION_MODE",
    "INVALID_EXECUTION_CHECKPOINT", "INVALID_MANUAL_INTERVENTION"].includes(result.status)) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    status: "COMMAND_FAILED",
    error: {
      code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
