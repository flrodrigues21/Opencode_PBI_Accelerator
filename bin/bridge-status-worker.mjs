#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(
  installRoot,
  "node",
  "node_modules",
  "@microsoft",
  "powerbi-desktop-bridge-cli",
  "dist",
  "index.js",
);
const pid = process.argv[2] || undefined;
const timeoutMs = Math.max(1, Math.min(5_000, Number(process.argv[3]) || 5_000));
const waitMs = Math.max(0, Math.min(timeoutMs, Number(process.argv[4]) || 0));

const watchdog = setTimeout(() => {
  process.stderr.write(`Desktop Bridge status worker exceeded ${timeoutMs}ms.\n`);
  process.exit(124);
}, timeoutMs);

try {
  if (!fs.existsSync(modulePath)) throw new Error(`Desktop Bridge library not found: ${modulePath}`);
  const bridge = await import(pathToFileURL(modulePath).href);
  const result = await bridge.readDesktopStatus({
    pid,
    waitMs,
    applicationStateWaitMs: 0,
  });
  clearTimeout(watchdog);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  clearTimeout(watchdog);
  process.stdout.write(`${JSON.stringify({
    instances: [],
    diagnostics: [{
      code: typeof error?.code === "string" ? error.code : "STATUS_QUERY_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }],
  })}\n`);
  process.exitCode = 1;
}
