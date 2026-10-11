import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const project = path.resolve(import.meta.dirname, "..");
execFileSync("pnpm", ["build:backend"], { cwd: project, stdio: "inherit" });
const { inspectV2CanonicalRoot } = await import("../dist/backend/v2CanonicalReader.js");
const { pendingV2Path } = await import("../dist/backend/v2LocalDomain.js");
const scratch = mkdtempSync(path.join(tmpdir(), "taskdb-v2-editor-ui-"));
const root = path.join(scratch, "root"), cache = path.join(scratch, "cache.db");
cpSync("scripts/fixtures/taskdb-v2/root", root, { recursive: true });
const originalXdg = process.env.XDG_DATA_HOME, originalRegistry = process.env.TASKS_SOURCE_REGISTRY_PATH;
process.env.XDG_DATA_HOME = path.join(scratch, "profile"); delete process.env.TASKS_SOURCE_REGISTRY_PATH;
const session = `taskdb-v2-editor-ui-${process.pid}`;
let dev, web, logs = "";
function browser(...args) { return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 35_000 }); }
function evaluate(source) { const result = JSON.parse(browser("--json", "eval", source)); assert.equal(result.success, true, result.error); return result.data.result; }
function check(source) { assert.equal(evaluate(source), true, source); }
function auditDialog() { const audit = JSON.parse(browser("--json", "a11y", "--selector", "[role=dialog]")); assert.equal(audit.success, true, audit.error); assert.deepEqual(audit.data.violations, []); }
function wait(source) { browser("wait", "--fn", source); }
function click(name) { evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(name)})?.scrollIntoView({block:'nearest'});true`); browser("find", "role", "button", "click", "--name", name, "--exact"); }
function fill(id, value) { if (value) browser("fill", id, value); else { browser("focus", id); browser("press", "Control+a"); browser("press", "Backspace"); } }
function files() { return Object.fromEntries(["workspace.json", ...readdirSync(path.join(root, "tasks")).map(name => `tasks/${name}`)].map(name => [name, readFileSync(path.join(root, name), "base64")])); }
function tasks() { return readdirSync(path.join(root, "tasks")).filter(name => name.endsWith(".json")).map(name => JSON.parse(readFileSync(path.join(root, "tasks", name), "utf8"))); }
function receipts() { const db = new DatabaseSync(cache, { readOnly: true }); try { return db.prepare("SELECT COUNT(*) AS n FROM v2_receipts").get().n; } finally { db.close(); } }
function operations() { const db = new DatabaseSync(cache, { readOnly: true }); try { return db.prepare("SELECT COUNT(*) AS n FROM v2_operations").get().n; } finally { db.close(); } }
function cli(...args) { return JSON.parse(execFileSync(process.execPath, ["dist/backend/tasks-cli.js", "--v2-root", root, "--database", cache, ...args, "--json"], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); }
async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function startBackend() {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); import(workerData.moduleUrl).then(async({startDevServer})=>{const dev=await startDevServer(workerData.options); parentPort.postMessage({url:dev.url}); parentPort.on('message',()=>dev.server.close(()=>{parentPort.postMessage('closed');parentPort.close();}));});`, { eval: true, workerData: { moduleUrl: pathToFileURL(path.join(project, "dist/backend/devServer.js")).href, options: { port: 0, v2Root: root, databasePath: cache, v2Edit: true } } });
  const ready = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  return { worker, url: ready.url };
}
async function startWeb(url) {
  const port = await freePort();
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: project, env: { ...process.env, VITE_DEV_BACKEND_URL: url, VITE_TASKDB_V2: "1", VITE_TASKDB_V2_EDIT: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
  web = child;
  const address = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) { if (child.exitCode !== null) throw new Error(logs); try { if ((await fetch(address)).ok) return address; } catch {} await delay(100); }
  throw new Error("Vite startup timed out: " + logs);
}
function openCapture() { browser("focus", '[role="listbox"]'); browser("press", "c"); wait('document.activeElement?.id === "v2-edit-title"'); }
function openEdit(id) { browser("click", `#v2-task-${id}`); browser("press", "Enter"); wait('document.activeElement?.id === "v2-edit-title"'); }
function openStatus(id, keyboard = true) { browser("click", `#v2-task-${id}`); if (keyboard) browser("press", "t"); else click("Change status"); wait('document.activeElement?.id === "v2-change-status"'); }
function statusAction(label) { browser("click", "#v2-change-status"); wait('document.querySelector("#v2-change-status")?.getAttribute("aria-expanded")==="true"'); browser("snapshot", "-i"); browser("find", "role", "option", "click", "--name", label, "--exact"); wait('Array.from(document.querySelectorAll("[data-slot=select-content]")).every(element=>element.getClientRects().length===0)'); }
function preview() { click("Preview changes"); wait('document.querySelector("[role=dialog]")?.textContent.includes("Preview only") || document.querySelector("[role=dialog]")?.textContent.includes("Preview: no content change") || document.querySelector("[role=dialog]")?.textContent.includes("Preview: no status change")'); }
function apply() { click("Apply original request"); wait('!document.querySelector("[role=dialog]")'); wait('document.activeElement?.getAttribute("aria-label") === "V2 tasks"'); }
function manualClose() { browser("scrollintoview", 'label[for="v2-manual-reconciliation"]'); browser("click", 'label[for="v2-manual-reconciliation"]'); click("Close for manual reconciliation"); wait('!document.querySelector("[role=dialog]")'); }

try {
  const original = files();
  dev = await startBackend(); const url = await startWeb(dev.url);
  browser("open", url); browser("snapshot", "-i");
  wait('document.activeElement?.textContent === "Enable editing and status changes in this folder"');
  assert.equal(existsSync(cache), false); assert.deepEqual(files(), original);
  check('document.body.textContent.includes("Capture, content editing and six single-task status commands are explicitly enabled")');
  evaluate('window.__editorRequests=[];window.__dropNextWrite=false;const base=window.fetch.bind(window);window.fetch=async(...args)=>{const request=args[1]?.body?JSON.parse(args[1].body):null;if(request)window.__editorRequests.push(request);const response=await base(...args);if(window.__dropNextWrite&&request?.command==="task.create"&&!request.dryRun&&!request.readOnly){window.__dropNextWrite=false;const body=await response.json();if(!body.ok)throw Error("Fault expected a committed success");window.__lostReplyResult=body.result;throw TypeError("Disposable lost reply after receipt commit");}return response;};true');
  click("Enable editing and status changes in this folder"); wait('document.activeElement?.getAttribute("aria-label") === "V2 tasks"');
  check('document.querySelectorAll("[role=option]").length===4');
  check('!Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="Change parent")');
  browser("focus", '[role="listbox"]'); browser("press", "m"); check('!document.querySelector("[role=dialog]")');
  check('!document.querySelector("h1").textContent.includes("v2")');
  check('Array.from(document.querySelectorAll("main > details")).every(element=>!element.open)');
  check('!document.querySelector("main").innerText.includes("Retained profile:") && !document.querySelector("main").innerText.includes("Refreshes never")');
  browser("focus", "main > details > summary"); browser("press", "Enter");
  check('document.querySelector("main > details").open && document.querySelector("main").innerText.includes("Retained profile:")');
  browser("press", "Enter"); browser("focus", '[role="listbox"]');
  browser("set", "viewport", "1100", "760"); browser("screenshot", "/tmp/tasks-calm-home-desktop.png");
  browser("set", "viewport", "720", "500"); check('document.documentElement.scrollWidth<=window.innerWidth'); browser("screenshot", "/tmp/tasks-calm-home-minimum.png");
  browser("set", "viewport", "1280", "900");
  check('document.querySelector("[role=listbox]").dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true,bubbles:true,cancelable:true}))'); check('!document.querySelector("[role=dialog]")');
  openCapture(); fill("#v2-edit-title", "Unsent @literal"); preview();
  assert.deepEqual(files(), original); assert.equal(operations(), 0);
  browser("press", "Escape"); wait('!document.querySelector("[role=dialog]")');
  click("New task"); wait('document.activeElement?.id === "v2-edit-title"');
  const title = "Call @alice #literal 😀";
  fill("#v2-edit-title", title); fill("#v2-edit-description", "## @literal\n#not-classification"); fill("#v2-edit-category", "WORK"); fill("#v2-edit-tags", "TODO, alpha");
  browser("focus", "#v2-edit-priority"); browser("press", "ArrowDown"); wait('document.querySelector("#v2-edit-priority")?.getAttribute("aria-expanded")==="true"'); browser("find", "role", "option", "click", "--name", "P3", "--exact"); wait('Array.from(document.querySelectorAll("[data-slot=select-content]")).every(element=>element.getClientRects().length===0)');
  preview(); assert.deepEqual(files(), original); assert.equal(operations(), 0);
  check('document.querySelector("[role=dialog]").textContent.includes("Category: work. Tags: alpha, todo. Priority: P3")');
  auditDialog();
  browser("set", "viewport", "390", "844"); check('document.documentElement.scrollWidth<=window.innerWidth'); evaluate('document.querySelector("[role=dialog]").scrollTop=0;true'); browser("screenshot", "/tmp/taskdb-v2-editor-mobile.png");
  browser("set", "viewport", "1280", "900"); browser("screenshot", "/tmp/taskdb-v2-editor-desktop.png");
  apply(); wait('document.querySelectorAll("[role=option]").length===5');
  const captured = tasks().find(task => task.title === title); assert.ok(captured); assert.equal(captured.category, "work"); assert.deepEqual(captured.tags, ["alpha", "todo"]); assert.equal(captured.priority, 3); assert.equal(captured.description, "## @literal\n#not-classification");
  openEdit(captured.id); fill("#v2-edit-category", ""); fill("#v2-edit-tags", ""); fill("#v2-edit-description", ""); preview(); apply();
  const cleared = tasks().find(task => task.id === captured.id); assert.equal(cleared.title, title); assert.equal(cleared.category, null); assert.deepEqual(cleared.tags, []); assert.equal(cleared.description, "");
  const closedId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32", beforeClosed = tasks().find(task => task.id === closedId);
  openEdit(closedId); fill("#v2-edit-title", "Closed @literal title"); preview(); apply();
  const afterClosed = tasks().find(task => task.id === closedId); assert.equal(afterClosed.closedAt, beforeClosed.closedAt); assert.equal(afterClosed.createdAt, beforeClosed.createdAt); assert.equal(afterClosed.status, "done");
  const beforeNoop = files(), groups = operations(); openEdit(closedId); click("Preview changes"); wait('document.querySelector("[role=dialog]")?.textContent.includes("Preview: no content change")'); apply();
  assert.deepEqual(files(), beforeNoop); assert.equal(operations(), groups);
  openEdit(closedId); fill("#v2-edit-title", "My draft should survive refresh"); evaluate('window.__editorFocused=document.activeElement;true');
  cli("update", closedId, "--title", "Concurrent CLI title");
  wait(`document.getElementById("v2-task-${closedId}")?.textContent.includes("Concurrent CLI title")`);
  check('document.activeElement===window.__editorFocused && document.querySelector("#v2-edit-title").value==="My draft should survive refresh"');
  click("Preview changes"); wait('document.querySelector("[role=dialog]")?.textContent.includes("STALE_TASK_VERSION")');
  check('!document.querySelector("#v2-edit-title").disabled'); click("Cancel"); wait('!document.querySelector("[role=dialog]")');
  openEdit(closedId); fill("#v2-edit-title", "Stale after preview"); preview();
  cli("update", closedId, "--title", "Concurrent after preview"); const concurrent = files();
  click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("Original request retained, not resolved")');
  check('document.querySelector("#v2-edit-title").disabled');
  const envelope = evaluate('document.querySelector("#v2-original-envelope").value');
  const executing = JSON.parse(envelope); assert.equal(executing.command, "task.update"); assert.ok(executing.args.expectedVersion>0);
  evaluate('window.__copiedOriginal=null;navigator.clipboard.writeText=async text=>{window.__copiedOriginal=text;};true'); click("Copy original request"); wait('document.body.textContent.includes("Original envelope copied")'); assert.equal(evaluate('window.__copiedOriginal'), envelope);
  auditDialog();
  browser("click", '[role="dialog"] summary'); check('document.querySelector("[role=dialog] details").open && document.querySelector("#v2-original-envelope").value.length>0'); browser("click", '[role="dialog"] summary');
  browser("press", "Escape"); check('document.querySelector("[role=dialog]")!==null');
  const traceStart = evaluate('window.__editorRequests.length'); click("Retry same request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("STALE_TASK_VERSION")');
  const retryCalls = evaluate(`window.__editorRequests.slice(${traceStart}).filter(request=>request.actor?.label==="Tasks v2 editor")`);
  assert.deepEqual(retryCalls, [executing]); assert.deepEqual(files(), concurrent);
  check('window.dispatchEvent(new Event("beforeunload",{cancelable:true}))===false');
  manualClose();
  openCapture(); fill("#v2-edit-title", "Lost reply capture"); preview(); evaluate('window.__dropNextWrite=true;true');
  const beforeLostGroups = operations(); click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("Original request retained, not resolved")');
  const lostEnvelope = evaluate('document.querySelector("#v2-original-envelope").value');
  check('![localStorage,sessionStorage].some(storage=>JSON.stringify(Object.fromEntries(Object.keys(storage).map(key=>[key,storage.getItem(key)]))).includes("Lost reply capture"))');
  assert.equal(operations(), beforeLostGroups+1); assert.equal(tasks().filter(task=>task.title==="Lost reply capture").length, 1);
  const beforeRetry = evaluate('window.__editorRequests.length'); click("Retry same request"); wait('!document.querySelector("[role=dialog]")');
  const lostCalls = evaluate(`window.__editorRequests.slice(${beforeRetry}).filter(request=>request.actor?.label==="Tasks v2 editor")`); assert.deepEqual(lostCalls, [JSON.parse(lostEnvelope)]);
  assert.equal(operations(), beforeLostGroups+1); assert.equal(tasks().filter(task=>task.title==="Lost reply capture").length, 1);
  wait('document.activeElement?.getAttribute("aria-label")==="V2 tasks"');
  openCapture(); fill("#v2-edit-title", "Wait for explicit recovery"); preview();
  const loader = path.join(scratch, "cut.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(url.endsWith('/v2LocalDomain.js')){const source=String(result.source),marker='renameSync(temporary, pending);';if(source.split(marker).length!==2)throw Error('fault marker missing');return {...result,source:source.replace(marker,marker+'\\nprocess.kill(process.pid,"SIGKILL");')};}return result;}});\n`);
  const interrupted = spawnSync(process.execPath, ["--import", loader, "dist/backend/tasks-cli.js", "--v2-root", root, "--database", cache, "update", captured.id, "--title", "Interrupted CLI operation"], { env: process.env, encoding: "utf8" }); assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
  const pendingPath = pendingV2Path(inspectV2CanonicalRoot(root)), pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("RECOVERY_PENDING")');
  const pendingEnvelope = evaluate('document.querySelector("#v2-original-envelope").value'); assert.ok(existsSync(pendingPath));
  assert.equal(tasks().filter(task=>task.title==="Wait for explicit recovery").length, 0);
  cli("recover", pending.operationId); assert.equal(existsSync(pendingPath), false);
  click("Retry same request"); wait('!document.querySelector("[role=dialog]")');
  assert.equal(tasks().filter(task=>task.title==="Wait for explicit recovery").length, 1);
  const writes = evaluate('window.__editorRequests.filter(request=>["task.create","task.update"].includes(request.command)&&!request.dryRun)');
  assert.ok(writes.every(request=>request.readOnly===false&&request.writeContext&&request.idempotencyKey));
  const pendingRetry = writes.filter(request=>request.idempotencyKey===JSON.parse(pendingEnvelope).idempotencyKey); assert.equal(pendingRetry.length, 2); assert.deepEqual(pendingRetry[0], pendingRetry[1]);
  const beforeStatus = files(); openStatus(captured.id); check('!document.querySelector("#v2-edit-title")');
  evaluate('window.__statusFocused=document.activeElement;true'); cli("update", closedId, "--title", "Unrelated CLI during status choice");
  wait(`document.getElementById("v2-task-${closedId}")?.textContent.includes("Unrelated CLI during status choice")`); check('document.activeElement===window.__statusFocused');
  preview(); statusAction("Start or resume"); check('!Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="Apply original request")'); statusAction("Complete");
  preview(); auditDialog(); check('document.querySelector("[role=dialog]").textContent.includes("Closure:")');
  browser("set", "viewport", "390", "844"); check('document.documentElement.scrollWidth<=window.innerWidth'); browser("screenshot", "/tmp/taskdb-v2-status-mobile.png");
  browser("set", "viewport", "1280", "900"); browser("screenshot", "/tmp/taskdb-v2-status-desktop.png");
  browser("press", "Escape"); wait('!document.querySelector("[role=dialog]")');
  assert.equal(tasks().find(task=>task.id===captured.id).status, "open");
  openStatus(captured.id); browser("click", "#v2-change-status"); wait('document.querySelector("#v2-change-status")?.getAttribute("aria-expanded")==="true"');
  check('!Array.from(document.querySelectorAll("[data-slot=select-content]")).some(element=>element.textContent.includes("Undo latest local status"))');
  browser("click", "#v2-change-status"); wait('document.querySelector("#v2-change-status")?.getAttribute("aria-expanded")!=="true"'); click("Cancel"); wait('!document.querySelector("[role=dialog]")');
  for (const [label, expected] of [["Start or resume","in_progress"],["Pause","paused"],["Complete","done"],["Reopen","open"],["Cancel except done","canceled"],["Reopen","open"],["Cancel any state (delete alias)","canceled"]]) {
    openStatus(captured.id, false); statusAction(label); const canonical = files(), groupCount = operations(), receiptCount = receipts();
    preview(); assert.deepEqual(files(), canonical); assert.equal(operations(), groupCount); assert.equal(receipts(), receiptCount);
    apply(); const after = tasks().find(task=>task.id===captured.id); assert.equal(after.status, expected);
    const before = JSON.parse(Buffer.from(beforeStatus[`tasks/${captured.id}.json`],"base64").toString());
    for (const field of Object.keys(before).filter(field=>!["status","closedAt"].includes(field))) assert.deepEqual(after[field], before[field]);
    assert.equal(operations(), groupCount+1); assert.equal(receipts(), receiptCount+1);
  }
  openStatus(captured.id); statusAction("Cancel any state (delete alias)"); const noOp = files(), noOpGroups = operations(), noOpReceipts = receipts();
  preview(); check('document.querySelector("[role=dialog]").textContent.includes("Preview: no status change")'); apply();
  assert.deepEqual(files(), noOp); assert.equal(operations(), noOpGroups); assert.equal(receipts(), noOpReceipts+1);
  openStatus(closedId); statusAction("Cancel except done"); click("Preview changes"); wait('document.querySelector("[role=dialog]")?.textContent.includes("INVALID_TRANSITION")');
  check('!document.querySelector("#v2-change-status").disabled'); browser("press", "Escape"); wait('!document.querySelector("[role=dialog]")');
  openStatus(captured.id); statusAction("Reopen"); preview(); cli("update", captured.id, "--title", "Concurrent status content"); const staleStatus = files();
  click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("STALE_TASK_VERSION")');
  check('document.querySelector("#v2-change-status").disabled'); const staleStatusEnvelope = evaluate('document.querySelector("#v2-original-envelope").value');
  browser("press", "Escape"); check('document.querySelector("[role=dialog]")!==null');
  const statusRetryStart = evaluate('window.__editorRequests.length'); click("Retry same request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("STALE_TASK_VERSION")');
  assert.deepEqual(evaluate(`window.__editorRequests.slice(${statusRetryStart}).filter(request=>request.actor?.label==="Tasks v2 editor")`), [JSON.parse(staleStatusEnvelope)]); assert.deepEqual(files(), staleStatus);
  check('window.dispatchEvent(new Event("beforeunload",{cancelable:true}))===false'); auditDialog(); manualClose();
  openStatus(closedId); statusAction("Start or resume"); preview();
  evaluate('(()=>{window.__dropNextStatus=true;const base=window.fetch.bind(window);window.fetch=async(...args)=>{const request=args[1]?.body?JSON.parse(args[1].body):null;const response=await base(...args);if(window.__dropNextStatus&&request?.command==="task.start"&&!request.dryRun){window.__dropNextStatus=false;const body=await response.json();if(!body.ok)throw Error("Expected committed status success");throw TypeError("Disposable lost status reply");}return response;};return true;})()');
  const lostStatusGroups = operations(); click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("Original request retained, not resolved")');
  const lostStatusEnvelope = evaluate('document.querySelector("#v2-original-envelope").value'); assert.equal(operations(), lostStatusGroups+1);
  const statusLostRetryStart = evaluate('window.__editorRequests.length'); click("Retry same request"); wait('!document.querySelector("[role=dialog]")');
  assert.deepEqual(evaluate(`window.__editorRequests.slice(${statusLostRetryStart}).filter(request=>request.actor?.label==="Tasks v2 editor")`), [JSON.parse(lostStatusEnvelope)]); assert.equal(operations(), lostStatusGroups+1);
  assert.equal(tasks().find(task=>task.id===closedId).status, "in_progress");
  openStatus(captured.id); statusAction("Reopen"); preview();
  const interruptedStatus = spawnSync(process.execPath, ["--import", loader, "dist/backend/tasks-cli.js", "--v2-root", root, "--database", cache, "pause", closedId], { env: process.env, encoding: "utf8" }); assert.equal(interruptedStatus.signal, "SIGKILL", interruptedStatus.stderr);
  const statusPending = JSON.parse(readFileSync(pendingPath, "utf8")); click("Apply original request"); wait('document.querySelector("[role=dialog]")?.textContent.includes("RECOVERY_PENDING")');
  const retainedStatus = evaluate('document.querySelector("#v2-original-envelope").value'); assert.ok(existsSync(pendingPath)); cli("recover", statusPending.operationId);
  const statusPendingRetryStart = evaluate('window.__editorRequests.length'); click("Retry same request"); wait('!document.querySelector("[role=dialog]")');
  assert.deepEqual(evaluate(`window.__editorRequests.slice(${statusPendingRetryStart}).filter(request=>request.actor?.label==="Tasks v2 editor")`), [JSON.parse(retainedStatus)]); assert.equal(tasks().find(task=>task.id===captured.id).status, "open");
  assert.equal(browser("errors").trim(), "");
  console.log("V2 editor browser passed: explicit confirmation, keyboard/mouse literal capture/edit/clears/closure/no-op, hypothetical preview, focus/draft preservation, stale refusal with fixed request, same-process lost-reply replay, explicit CLI pending recovery, six status actions/no-op/refused transition, status draft/focus/stale/lost-reply/pending retries, six-choice menu without status undo, responsive renders and editor/status axe checks. Browser evidence only; native launch withheld.");
} catch (error) {
  try { console.error(browser("snapshot")); console.error(browser("errors")); console.error(evaluate('Array.from(document.querySelectorAll("[data-slot=checkbox],#v2-manual-reconciliation,[data-slot=select-content]")).map(element=>({html:element.outerHTML.slice(0,600),rect:element.getBoundingClientRect().toJSON()}))')); } catch {}
  console.error(logs); throw error;
} finally {
  try { browser("close"); } catch {}
  if (dev) { await new Promise(resolve => { dev.worker.once("message", resolve); dev.worker.postMessage("close"); }); await dev.worker.terminate(); }
  if (web && web.exitCode===null) await new Promise(resolve=>{web.once("close",resolve);web.kill("SIGTERM");});
  if (originalXdg===undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME=originalXdg;
  if (originalRegistry===undefined) delete process.env.TASKS_SOURCE_REGISTRY_PATH; else process.env.TASKS_SOURCE_REGISTRY_PATH=originalRegistry;
  rmSync(scratch,{recursive:true,force:true});
}
