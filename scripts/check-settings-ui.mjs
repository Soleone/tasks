import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

// Real Settings and Base UI rendering; only workspace/runtime boundaries are
// fixtures. No backend, personal workspace or native window is opened.
const project = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-settings-ui-"));
const session = `tasks-settings-ui-${process.pid}`;
let web, logs = "";
function browser(...args) { return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 35_000 }); }
function evaluate(source) { const result = JSON.parse(browser("--json", "eval", source)); assert.equal(result.success, true, result.error); return result.data.result; }
function check(source) { assert.equal(evaluate(source), true, source); }
function wait(source) { browser("wait", "--fn", source); }
function click(role, name) { browser("find", "role", role, "click", "--name", name, "--exact"); }
function auditDialog(inheritedContrastLabels = []) {
  const result = JSON.parse(browser("--json", "a11y", "--selector", "[role=dialog]"));
  assert.equal(result.success, true, result.error);
  for (const violation of result.data.violations) {
    assert.equal(violation.id, "color-contrast");
    for (const node of violation.nodes) {
      const label = evaluate(`document.querySelector(${JSON.stringify(node.target[0])})?.textContent`);
      assert.ok(inheritedContrastLabels.includes(label), JSON.stringify(node));
      console.log("Inherited contrast finding:", label, node.failureSummary);
    }
  }
}
function openData() {
  browser("snapshot", "-i");
  wait('document.activeElement?.textContent === "General"');
  browser("press", "ArrowRight"); browser("press", "ArrowRight");
  wait('document.querySelector("[role=tab][aria-selected=true]")?.textContent === "Data"');
  wait('document.body.textContent.includes("SQLite workspace")');
  browser("snapshot", "-i");
}
const syncSection = 'document.querySelector("section[aria-labelledby=settings-sync]")';
const fixtures = {
  "@/platform/backendClient": `
    export function selectedMainWorkspace() { return new URLSearchParams(location.search).get('workspace') === 'selected' ? {} : null; }
    export async function getWorkspaceInfo() { window.calls.push('workspace.info'); return { databasePath: '/disposable/settings.db', canceledTaskCount: 2 }; }
    export async function exportTasks() { window.calls.push('export'); throw Error('No export transport in this fixture'); }
  `,
  "@/platform/runtime": `export function runtimeKind() { return new URLSearchParams(location.search).get('runtime') === 'android' ? 'android' : 'browser'; }`,
  "@/platform/androidWorkspace": `
    export async function getAndroidSyncFolder() { return null; }
    export async function pickAndroidSyncFolder() { window.calls.push('android.pick'); return { path: '/disposable/shared', uri: 'content://disposable/shared' }; }
    export async function clearAndroidSyncFolder() { window.calls.push('android.clear'); }
  `,
};

try {
  execFileSync("pnpm", ["build:web"], { cwd: project, stdio: "inherit" });
  cpSync(path.join(project, "dist/assets"), path.join(scratch, "assets"), { recursive: true });
  const html = readFileSync(path.join(project, "dist/index.html"), "utf8");
  const css = html.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(css, "production stylesheet missing");
  await build({
    stdin: { resolveDir: project, loader: "tsx", contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SettingsDialog} from './src/components/SettingsDialog';
      import {applyTheme} from './src/theme';
      import {builtinThemes} from './src/backend/builtinThemes';
      window.calls = [];
      const themes = builtinThemes();
      const theme = themes.find(theme => theme.name === (new URLSearchParams(location.search).get('theme') ?? 'gilt'));
      applyTheme(theme);
      function Scene() {
        const [open, setOpen] = useState(true);
        return <><button id="settings-opener" onClick={() => setOpen(true)}>Settings</button><SettingsDialog
          open={open} onOpenChange={setOpen} finalFocus={() => document.getElementById('settings-opener')}
          onPrepareReceive={() => {window.calls.push('receive'); setOpen(false);}}
          onPurgeCanceled={async () => {window.calls.push('purge'); return 2;}}
          globalShortcut="Ctrl+Alt+Space" onGlobalShortcutChange={async () => {}}
          helpMode="full" onHelpModeChange={() => {}} fontSizeIncrease={0} onFontSizeIncreaseChange={() => {}}
          themes={themes} selectedTheme={theme.name} onSelectTheme={() => {}}
        /></>;
      }
      createRoot(document.getElementById('root')).render(<Scene/>);
    ` },
    outfile: path.join(scratch, "scene.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "settings-boundary-fixtures", setup(builder) {
      builder.onResolve({ filter: /^@\/platform\// }, ({ path: name }) => fixtures[name] ? { path: name, namespace: "settings-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "settings-fixture" }, ({ path: name }) => ({ contents: fixtures[name], loader: "js" }));
    } }],
  });
  writeFileSync(path.join(scratch, "index.html"), `<!doctype html><html lang="en"><head><title>Settings fixture</title><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script type="module" src="/scene.js"></script></body></html>`);
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  web = spawn(process.execPath, [path.join(project, "node_modules/vite/bin/vite.js"), scratch, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] });
  web.stdout.on("data", chunk => { logs += chunk; }); web.stderr.on("data", chunk => { logs += chunk; });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (web.exitCode !== null) throw Error(logs);
    try { ready = (await fetch(url, { headers: { connection: "close" } })).ok; } catch { /* Startup has not bound the port yet. */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, logs);

  browser("set", "viewport", "1100", "760");
  browser("open", `${url}?workspace=selected`); openData();
  check(`${syncSection}.textContent.includes("Receiving a workspace from another device is not yet available here.")`);
  check(`${syncSection}.querySelector("button") === null`);
  check(`${syncSection}.querySelector("[role=alert]") === null`);
  check(`!${syncSection}.textContent.includes("Syncthing") && !${syncSection}.textContent.includes("backed up")`);
  check('document.querySelectorAll("[role=tab]").length === 3');
  check('document.querySelector("[role=dialog]").getBoundingClientRect().width >= 700');
  browser("press", "Tab"); wait('document.activeElement?.textContent === "Export tasks as JSON"');
  check('document.activeElement.getAttribute("aria-disabled") === "true"');
  browser("press", "Enter");
  browser("press", "Tab"); wait('document.activeElement?.textContent === "Data"');
  assert.deepEqual(evaluate("window.calls"), ["workspace.info"]);
  auditDialog();
  for (const [width, height] of [[1100, 760], [720, 500], [390, 844], [550, 380]]) {
    browser("set", "viewport", String(width), String(height));
    check('document.documentElement.scrollWidth <= window.innerWidth');
    check(`${syncSection}.querySelector("button") === null`);
    auditDialog();
    browser("screenshot", path.join(scratch, `selected-${width}x${height}.png`));
  }
  browser("press", "Escape"); wait('document.querySelector("[role=dialog]") === null && document.activeElement?.id === "settings-opener"');
  click("button", "Settings"); openData();
  check(`${syncSection}.querySelector("button") === null`);
  assert.deepEqual(evaluate("window.calls"), ["workspace.info", "workspace.info"]);

  browser("set", "viewport", "1100", "760");
  browser("open", `${url}?workspace=selected&theme=catppuccin-latte`); openData();
  check(`${syncSection}.textContent.includes("Receiving a workspace from another device is not yet available here.") && ${syncSection}.querySelector("button") === null`);
  // Baseline-confirmed tab contrast is reported, not silently discarded.
  auditDialog(["General", "Shortcuts"]);
  const syncAudit = JSON.parse(browser("--json", "a11y", "--selector", "section[aria-labelledby=settings-sync]"));
  assert.equal(syncAudit.success, true, syncAudit.error);
  assert.deepEqual(syncAudit.data.violations, []);
  browser("screenshot", path.join(scratch, "selected-light.png"));
  browser("open", url); openData();
  check(`${syncSection}.textContent.includes("Move an existing workspace to this device through Syncthing.")`);
  browser("press", "Tab"); wait('document.activeElement?.textContent === "Sync with another device…"');
  browser("press", "Enter"); wait('document.body.textContent.includes("Replace this device’s workspace?")');
  check(`${syncSection}.textContent.includes("backed up") && ${syncSection}.textContent.includes("emptied")`);
  assert.deepEqual(evaluate("window.calls"), ["workspace.info"]);
  // These untouched legacy buttons also fail contrast on the baseline.
  auditDialog(["Back up and continue", "Permanently delete canceled tasks"]);
  click("button", "Cancel"); wait('!document.body.textContent.includes("Replace this device’s workspace?")');
  assert.deepEqual(evaluate("window.calls"), ["workspace.info"]);
  click("button", "Sync with another device…");
  browser("press", "Escape"); wait('document.querySelector("[role=dialog]") === null');
  click("button", "Settings"); openData();
  check('!document.body.textContent.includes("Replace this device’s workspace?")');
  click("button", "Sync with another device…");
  click("button", "Back up and continue"); wait('document.querySelector("[role=dialog]") === null');
  assert.deepEqual(evaluate("window.calls"), ["workspace.info", "workspace.info", "receive"]);

  browser("open", `${url}?runtime=android`); openData();
  check(`${syncSection}.textContent.includes("Android cannot replace those tasks with an existing workspace yet.")`);
  check(`!${syncSection}.textContent.includes("Back up and continue") && !${syncSection}.textContent.includes("Sync with another device…")`);
  click("button", "Choose Android sync folder…"); wait('document.body.textContent.includes("Selected Android folder")');
  click("button", "Change folder"); wait('window.calls.filter(call => call === "android.pick").length === 2');
  click("button", "Forget folder"); wait('document.body.textContent.includes("Choose Android sync folder…")');
  assert.deepEqual(evaluate("window.calls"), ["workspace.info", "android.pick", "workspace.info", "android.pick", "workspace.info", "android.clear"]);
  auditDialog();
  assert.equal(browser("errors").trim(), "");
  console.log("Settings browser checks passed: selected receive withheld before confirmation/callback; disabled export and Data Tab loop; Escape/final focus/reopen; desktop/minimum/mobile/reflow and axe; default desktop confirmation/cancel/reset/callback; Android choose/change/forget unchanged. Fixtures only, not native or receive-backend acceptance.");
  console.log(`Screenshots: ${scratch}`);
} catch (error) {
  try { console.error(browser("snapshot")); console.error(browser("errors")); } catch { /* Preserve the original failure. */ }
  console.error(logs); throw error;
} finally {
  try { browser("close"); } catch { /* Browser may not have started. */ }
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await new Promise(resolve => web.once("exit", resolve)); }
  rmSync(path.join(scratch, "assets"), { recursive: true, force: true });
}
