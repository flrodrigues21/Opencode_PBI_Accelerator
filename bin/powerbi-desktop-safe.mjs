#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FileStateStore,
  captureAll,
  confirmPbixSaveWithDesktop,
  inspectCapabilities,
  openTarget,
  resolveTarget,
  resumeCheckpoint,
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

async function loadRuntime() {
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modulePath = path.join(installRoot, "node", "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "dist", "index.js");
  if (!fs.existsSync(modulePath)) throw new Error(`Desktop Bridge library not found: ${modulePath}`);
  const bridge = await import(pathToFileURL(modulePath).href);
  const statusWorkerPath = path.join(installRoot, "bin", "bridge-status-worker.mjs");
  const packageJson = JSON.parse(fs.readFileSync(path.join(path.dirname(modulePath), "..", "package.json"), "utf8"));
  return {
    bridgeVersion: packageJson.version,
    platform: process.platform,
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    isProcessRunning: (pid) => {
      try { process.kill(Number(pid), 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
    },
    openDesktop: bridge.openDesktop,
    openSession: bridge.openSession,
    readDesktopStatus: (options) => readDesktopStatusBounded(statusWorkerPath, options),
    resolveReportDir: bridge.resolveReportDir,
  };
}

function readDesktopStatusBounded(statusWorkerPath, options = {}) {
  const timeoutMs = Math.max(1, Math.min(5_000, options.hardTimeoutMs ?? 5_000));
  const args = [
    statusWorkerPath,
    options.pid === undefined ? "" : String(options.pid),
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
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs + 500);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        instances: [],
        diagnostics: [{ code: "STATUS_QUERY_FAILED", message: error.message }],
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut || exitCode === 124) {
        resolve({
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
          resolve({ instances: parsed.instances, diagnostics: parsed.diagnostics ?? [] });
          return;
        }
        resolve({
          instances: [],
          diagnostics: [{
            code: "STATUS_QUERY_FAILED",
            message: "Desktop Bridge status returned a non-success result.",
            details: { exitCode, stderr: stderr.trim().slice(0, 1_000) },
          }],
        });
      } catch (error) {
        resolve({
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
  if (positional.length < count) throw new Error(`Usage: ${usage}`);
}

async function main() {
  const command = process.argv[2];
  const { positional, options } = parseArguments(process.argv.slice(3));
  const store = new FileStateStore(options["state-dir"] || defaultStateDir());
  if (command === "save-as") {
    requirePositionals(positional, 2, "powerbi-desktop-safe save-as <source> <destination>");
    const source = reportTarget(positional[0], [".pbix", ".pbip"]);
    return unsupportedSaveAs(store, source, positional[1]);
  }
  if (command === "resume") {
    requirePositionals(positional, 1, "powerbi-desktop-safe resume <checkpoint.json>");
    const base = resumeCheckpoint(positional[0]);
    if (base.status === "DESTINATION_APPEARED" && options.pid) {
      const runtime = await loadRuntime();
      return confirmPbixSaveWithDesktop(runtime, store, positional[0], options.pid);
    }
    return base;
  }

  const runtime = await loadRuntime();
  if (command === "open") {
    requirePositionals(positional, 1, "powerbi-desktop-safe open <report.pbip|report.pbix>");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    return openTarget(runtime, store, target, {
      waitMs: numberOption(options, "wait-seconds", 15) * 1000,
      newAttempt: options.newAttempt === true,
    });
  }
  if (command === "resolve") {
    requirePositionals(positional, 1, "powerbi-desktop-safe resolve <report> [--pid <pid>]");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    return resolveTarget(runtime, target, {
      pid: options.pid,
      waitMs: numberOption(options, "wait-seconds", 0) * 1000,
      store,
    });
  }
  if (command === "capabilities") {
    requirePositionals(positional, 1, "powerbi-desktop-safe capabilities <report> [--pid <pid>]");
    if (!options.pid) throw new Error("--pid is required for capabilities.");
    const target = reportTarget(positional[0], [".pbip", ".pbix"]);
    return inspectCapabilities(runtime, store, target, { pid: options.pid });
  }
  if (command === "capture-all") {
    requirePositionals(positional, 1, "powerbi-desktop-safe capture-all <report> --output-dir <directory> [--pid <pid>]");
    if (!options["output-dir"]) throw new Error("--output-dir is required.");
    if (!options.pid) throw new Error("--pid is required for capture-all.");
    const target = reportTarget(positional[0], [".pbip"]);
    const maxPages = options["max-pages"] === undefined ? undefined : numberOption(options, "max-pages", undefined);
    if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
      throw new Error("--max-pages must be a positive integer.");
    }
    return captureAll(runtime, store, target, {
      pid: options.pid,
      outputDir: options["output-dir"],
      totalMs: numberOption(options, "total-seconds", 20) * 1000,
      pageMs: numberOption(options, "page-seconds", 10) * 1000,
      scale: numberOption(options, "scale", 2),
      maxPages,
    });
  }
  throw new Error("Commands: open, resolve, capabilities, capture-all, save-as, resume.");
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "OPEN_FAILED" || result.status === "INVALID_DESTINATION" || result.status === "INVALID_CHECKPOINT") {
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
