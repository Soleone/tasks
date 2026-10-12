import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const project = path.resolve(import.meta.dirname, "..");
execFileSync("pnpm", ["build:backend"], { cwd: project, stdio: "inherit" });
async function startDevServer(options) {
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    import(workerData.moduleUrl).then(async ({ startDevServer }) => {
      const dev = await startDevServer(workerData.options);
      parentPort.postMessage({ url: dev.url, port: dev.port });
      parentPort.on("message", () => dev.server.close(() => { parentPort.postMessage({ closed: true }); parentPort.close(); }));
    });
  `, { eval: true, workerData: { options, moduleUrl: pathToFileURL(path.join(project, "dist/backend/devServer.js")).href } });
  const ready = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  return { ...ready, worker, listening: true };
}
const { inspectV2CanonicalRoot } = await import("../dist/backend/v2CanonicalReader.js");
const { pendingV2Path } = await import("../dist/backend/v2LocalDomain.js");
const scratch = mkdtempSync(path.join(tmpdir(), "taskdb-v2-ui-"));
const profile = path.join(scratch, "profile");
const root = path.join(scratch, "root");
const cache = path.join(scratch, "cache.db");
cpSync("scripts/fixtures/taskdb-v2/root", root, { recursive: true });
const originalXdg = process.env.XDG_DATA_HOME;
const originalRegistry = process.env.TASKS_SOURCE_REGISTRY_PATH;
const originalSyncRoot = process.env.TASKS_SYNC_ROOT;
delete process.env.TASKS_SOURCE_REGISTRY_PATH;
process.env.XDG_DATA_HOME = profile;
const session = `taskdb-v2-ui-${process.pid}`;
const webChildren = [];
const servers = [];
let logs = "";
function bytes(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const filename = path.join(entry.parentPath, entry.name);
    return [path.relative(directory, filename), readFileSync(filename, "base64")];
  }));
}
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function startWeb(backendUrl, v2) {
  const port = await freePort();
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: project, env: { ...process.env, VITE_DEV_BACKEND_URL: backendUrl, VITE_TASKDB_V2: v2 ? "1" : "0", VITE_TASKDB_V2_EDIT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  webChildren.push(child);
  child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(url)).ok) return url; } catch { /* Vite has not bound yet. */ }
    await delay(100);
  }
  throw new Error("Vite startup timed out: " + logs);
}
function browser(...args) { return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 35_000 }); }
function evaluate(script) { const reply = JSON.parse(browser("--json", "eval", script)); assert.equal(reply.success, true, reply.error); return reply.data.result; }
function check(script) { assert.equal(evaluate(script), true, script); }
function wait(script) { browser("wait", "--fn", script); }
function click(name) { browser("find", "role", "button", "click", "--name", name, "--exact"); }
function cli(...args) {
  return JSON.parse(execFileSync(process.execPath, ["dist/backend/tasks-cli.js", "--v2-root", root, "--database", cache, ...args, "--json"], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
async function closeServer(dev) {
  if (!dev.listening) return;
  dev.listening = false;
  await new Promise(resolve => { dev.worker.once("message", resolve); dev.worker.postMessage("close"); });
  await dev.worker.terminate();
}

try {
  const original = bytes(root);
  let dev = await startDevServer({ port: 0, v2Root: root, databasePath: cache }); servers.push(dev);
  const url = await startWeb(dev.url, true);
  browser("open", url); browser("snapshot", "-i");
  wait('document.activeElement?.textContent === "Browse this v2 folder"');
  check(`document.querySelector("#v2-root").value === ${JSON.stringify(root)}`);
  check('document.querySelector("[role=listbox]") === null');
  assert.equal(existsSync(cache), false, "confirmation must precede domain queries/cache creation");
  assert.deepEqual(bytes(root), original);
  evaluate('window.__readerRequests = []; const originalFetch = window.fetch.bind(window); window.fetch = (...args) => { if (String(args[0]).endsWith("/command")) window.__readerRequests.push(JSON.parse(args[1].body)); return originalFetch(...args); }; true');
  click("Browse this v2 folder");
  wait('document.activeElement?.getAttribute("aria-label") === "V2 tasks"');
  check('document.querySelectorAll("[role=option]").length === 4');
  browser("press", "ArrowDown");
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === document.querySelectorAll("[role=option]")[1].id');
  browser("press", "Enter");
  wait('document.querySelector("[role=dialog]") !== null');
  check('document.querySelector("[role=dialog]").textContent.includes("Read-only snapshot")');
  browser("press", "Escape");
  wait('document.querySelector("[role=dialog]") === null && document.activeElement?.getAttribute("aria-label") === "V2 tasks"');
  for (const key of ["c", "Space", "Delete", "p"]) browser("press", key);
  assert.deepEqual(bytes(root), original, "v1 mutation shortcuts must not be active");
  const captured = cli("add", "--title", "Call @alice #literal", "--category", "WORK", "--tag", "TODO", "--description", "## @literal\n#not-classification");
  wait(`document.getElementById("v2-task-${captured.task.id}")?.textContent.includes("Call @alice #literal")`);
  check('document.activeElement?.getAttribute("aria-label") === "V2 tasks"');
  browser("click", `#v2-task-${captured.task.id}`); click("Show details");
  wait('document.querySelector("[role=dialog]")?.textContent.includes("## @literal")');
  check('document.querySelector("[role=dialog]").textContent.includes("#not-classification")');
  check('document.querySelector("[role=dialog]").textContent.includes("work") && document.querySelector("[role=dialog]").textContent.includes("todo")');
  wait('document.activeElement?.closest("[role=dialog]") !== null');
  evaluate('window.__dialogFocused = document.activeElement; true');
  cli("add", "--title", "Visible after dialog refresh");
  wait('document.querySelectorAll("[role=option]").length === 6');
  check('document.activeElement === window.__dialogFocused && document.activeElement?.closest("[role=dialog]") !== null');
  browser("press", "Escape");
  wait('document.querySelector("[role=dialog]") === null');
  browser("fill", "#v2-search", "Unsaved search @literal");
  cli("add", "--title", "Refresh while typing");
  wait('document.querySelectorAll("[role=option]").length === 7');
  check('document.activeElement?.id === "v2-search" && document.querySelector("#v2-search").value === "Unsaved search @literal"');
  browser("fill", "#v2-search", "Call @alice"); browser("press", "Enter");
  wait('document.querySelectorAll("[role=option]").length === 1');
  check('document.activeElement?.id === "v2-search"');
  browser("fill", "#v2-search", "Nothing matches this"); browser("press", "Enter");
  wait('document.body.textContent.includes("No matching tasks")');
  browser("focus", "#v2-search"); browser("press", "Control+a"); browser("press", "Backspace"); browser("press", "Enter");
  wait('document.querySelectorAll("[role=option]").length === 7');
  const alternateId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const conflict = path.join(root, "tasks", `${alternateId}.sync-conflict-20261004-000000-ABCDEF.json`);
  writeFileSync(conflict, readFileSync(path.join(root, "tasks", `${alternateId}.json`)));
  click("Refresh"); wait('document.body.textContent.includes("Collection issues need review")');
  assert.ok(existsSync(conflict)); rmSync(conflict);
  click("Refresh"); wait('!document.body.textContent.includes("Collection issues need review")');
  const malformedPending = pendingV2Path(inspectV2CanonicalRoot(root));
  writeFileSync(malformedPending, "{incomplete");
  wait('document.body.textContent.includes("Pending recovery: task browsing is paused")');
  assert.equal(readFileSync(malformedPending, "utf8"), "{incomplete");
  rmSync(malformedPending);
  wait('document.querySelectorAll("[role=option]").length === 7');
  const recoveryTask = cli("add", "--title", "Before interrupted update").task;
  const loader = path.join(scratch, "cut.mjs");
  const marker = 'renameSync(temporary, pending);';
  writeFileSync(loader, `import { registerHooks } from "node:module"; registerHooks({ load(url, context, next) { const result = next(url, context); if (url.endsWith("/v2LocalDomain.js")) { const source = String(result.source); const marker = ${JSON.stringify(marker)}; if (source.split(marker).length !== 2) throw new Error("fault boundary missing"); return { ...result, source: source.replace(marker, marker + '\\nprocess.kill(process.pid, "SIGKILL");') }; } return result; } });\n`);
  const interrupted = spawnSync(process.execPath, ["--import", loader, "dist/backend/tasks-cli.js", "--v2-root", root, "--database", cache, "update", recoveryTask.id, "--title", "Explicit recovery becomes visible"], { encoding: "utf8", env: process.env });
  assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
  const pendingPath = pendingV2Path(inspectV2CanonicalRoot(root));
  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  assert.equal(pending.format, "taskdb.pending-update");
  assert.equal(pending.taskId, recoveryTask.id);
  wait('document.body.textContent.includes("Pending recovery: task browsing is paused")');
  check('document.querySelectorAll("[role=option]").length === 0');
  check('document.body.textContent.includes("This app never completes recovery automatically")');
  assert.ok(existsSync(pendingPath));
  cli("recover", pending.operationId);
  click("Retry"); wait('document.querySelectorAll("[role=option]").length === 8');
  check('document.body.textContent.includes("Explicit recovery becomes visible")');
  const pageTemplate = JSON.parse(readFileSync(path.join(root, "tasks", `${alternateId}.json`), "utf8"));
  const pageFiles = Array.from({ length: 54 }, (_, index) => {
    const id = randomUUID();
    const filename = path.join(root, "tasks", `${id}.json`);
    writeFileSync(filename, JSON.stringify({ ...pageTemplate, id, title: `Pagination fixture ${index}`, description: "", category: null, tags: [], parentId: null, dependencyIds: [], orderKey: "a3" }) + "\n");
    return filename;
  });
  wait('document.querySelectorAll("[role=option]").length === 50 && document.body.textContent.includes("62 matching tasks")');
  click("Next page");
  wait('document.querySelectorAll("[role=option]").length === 12 && document.body.textContent.includes("51–62 of 62")');
  for (const filename of pageFiles) rmSync(filename);
  wait('document.querySelectorAll("[role=option]").length === 0 && document.body.textContent.includes("8 matching tasks")');
  click("Previous page");
  wait('document.querySelectorAll("[role=option]").length === 8');
  const traces = evaluate('window.__readerRequests');
  assert.ok(traces.length > 0);
  assert.ok(traces.every(item => item.version === 2 && item.readOnly === true && ["workspace.info", "task.list"].includes(item.command)));
  assert.ok(traces.every(item => item.idempotencyKey === undefined && item.writeContext === undefined));
  browser("set", "viewport", "390", "844");
  check('document.documentElement.scrollWidth <= window.innerWidth');
  browser("screenshot", "/tmp/taskdb-v2-reader-mobile.png");
  browser("set", "viewport", "1280", "900");
  browser("screenshot", "/tmp/taskdb-v2-reader-desktop.png");
  evaluate('window.__TAURI_INTERNALS__ = {}; true');
  click("Leave folder");
  wait('document.body.textContent.includes("The native v2 reader is unavailable")');
  check('document.querySelector("#v2-root") === null');
  evaluate('delete window.__TAURI_INTERNALS__; true');
  browser("reload"); browser("snapshot", "-i");
  wait('document.activeElement?.textContent === "Browse this v2 folder"');
  click("Browse this v2 folder");
  wait('document.activeElement?.getAttribute("aria-label") === "V2 tasks"');
  const port = dev.port;
  await closeServer(dev);
  wait('document.body.textContent.includes("Could not read the selected folder")');
  const foreignRoot = path.join(scratch, "foreign-root"); cpSync("scripts/fixtures/taskdb-v2/root", foreignRoot, { recursive: true });
  const foreignCache = path.join(scratch, "foreign-cache.db");
  dev = await startDevServer({ port, v2Root: foreignRoot, databasePath: foreignCache }); servers.push(dev);
  click("Retry"); wait('document.body.textContent.includes("STALE_DEV_SELECTION")');
  assert.equal(existsSync(foreignCache), false, "old UI must not query the replacement selection");
  browser("reload"); browser("snapshot", "-i");
  wait('document.activeElement?.textContent === "Browse this v2 folder"');
  assert.equal(existsSync(foreignCache), false);
  check(`document.querySelector("#v2-root").value === ${JSON.stringify(foreignRoot)}`);
  const legacyRoot = path.join(scratch, "preserved-v1"); cpSync("scripts/fixtures/taskdb-v1/sync", legacyRoot, { recursive: true });
  const legacyBytes = bytes(legacyRoot);
  process.env.TASKS_SYNC_ROOT = legacyRoot;
  const legacyDev = await startDevServer({ port: 0, databasePath: path.join(scratch, "legacy.db") }); servers.push(legacyDev);
  const legacyUrl = await startWeb(legacyDev.url, false);
  browser("open", legacyUrl); browser("snapshot", "-i");
  wait('document.activeElement?.getAttribute("role") === "listbox" && document.querySelector(\'section[aria-label="Saved tasks"]\') !== null');
  check('document.querySelectorAll("[role=option]").length > 0');
  check('!document.body.textContent.includes("v2 reader")');
  assert.deepEqual(bytes(legacyRoot), legacyBytes, "returning to v1 is explicit and does not reverse-convert v2 edits");
  assert.ok(readdirSync(path.join(root, "tasks")).length === 8);
  assert.equal(browser("errors").trim(), "", "unexpected browser JavaScript errors");
  console.log("V2 browser reader passed: confirmation, query-only traces, literal fields, CLI visibility, keyboard/mouse/details, focus-preserving refresh, pagination after removal, empty/conflict/pending/explicit recovery, restart refusal, reconfirmation, responsive widths and explicit preserved-v1 return. Browser evidence only, not native acceptance.");
} catch (error) {
  try { console.error(browser("snapshot")); console.error(browser("errors")); console.error(evaluate('({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label"),role:document.activeElement?.getAttribute("role"),html:document.activeElement?.outerHTML.slice(0,400)})')); } catch { /* Browser may have failed to start. */ }
  console.error(logs);
  throw error;
} finally {
  try { browser("close"); } catch { /* Browser may already be closed. */ }
  await Promise.all(servers.filter(dev => dev.listening).map(closeServer));
  await Promise.all(webChildren.map(child => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once("close", resolve); child.kill("SIGTERM"); })));
  if (originalSyncRoot === undefined) delete process.env.TASKS_SYNC_ROOT; else process.env.TASKS_SYNC_ROOT = originalSyncRoot;
  if (originalRegistry === undefined) delete process.env.TASKS_SOURCE_REGISTRY_PATH; else process.env.TASKS_SOURCE_REGISTRY_PATH = originalRegistry;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(scratch, { recursive: true, force: true });
}
