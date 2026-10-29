import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BRIDGE_METHODS,
  FileStateStore,
  captureAll,
  confirmPbixSaveWithDesktop,
  inspectCapabilities,
  openTarget,
  pathsEqual,
  resolveTarget,
  resumeCheckpoint,
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
  const statusSequence = options.statusSequence ?? [[]];
  const runtime = {
    platform: "win32",
    bridgeVersion: "1.0.0",
    launchCount: 0,
    captureCalls: [],
    sessionCount: 0,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    resolveReportDir: reportDirFor,
    readDesktopStatus: async ({ pid } = {}) => {
      runtime.statusCount = (runtime.statusCount ?? 0) + 1;
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
  assert.equal(resumeCheckpoint(unsupported.checkpointPath).status, "WAITING_FOR_MANUAL_SAVE_AS");
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
  const resumed = resumeCheckpoint(unsupported.checkpointPath);
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
  assert.equal(resumeCheckpoint(unsupported.checkpointPath).status, "DESTINATION_APPEARED");

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
