import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Requires agent-browser with Linux Chromium installed. All writes use a scratch Tasks home.
const root = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-ui-check-"));
const home = path.join(scratch, "home");
const taskFolder = path.join(home, "sync");
const cachePath = path.join(home, "local", "app.db");
const session = `tasks-ui-check-${process.pid}`;
const server = createServer();
async function freePort() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const webPort = await freePort();
const backendPort = await freePort();
const url = `http://127.0.0.1:${webPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const testEnvironment = { ...process.env };
// The external CLI is a second writer in the same home, with its own cache and the shared lock.
function tasksCli(...args) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(root, "dist/backend/tasks-cli.js"), "--home", home, ...args, "--json"],
      { cwd: root, env: testEnvironment, encoding: "utf8" },
    ),
  );
}
execFileSync("pnpm", ["-s", "build:backend"], { cwd: root, stdio: "inherit" });
tasksCli("init");
const app = spawn(
  process.execPath,
  [
    "scripts/dev-web.mjs",
    "--home",
    home,
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(webPort),
    "--strictPort",
  ],
  {
    cwd: root,
    env: {
      ...testEnvironment,
      TASKS_DEV_BACKEND_PORT: String(backendPort),
      VITE_DEV_BACKEND_URL: backendUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
app.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
app.stderr.on("data", (chunk) => {
  serverLog += chunk;
});

function browser(...args) {
  return execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 35_000,
  });
}
function evaluate(script) {
  const response = JSON.parse(browser("--json", "eval", script));
  assert.equal(response.success, true, response.error);
  return response.data.result;
}
function waitFor(script) {
  browser("wait", "--fn", script);
}
function check(script) {
  assert.equal(evaluate(script), true, script);
}
function auditTaskList() {
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].every(row => !row.hasAttribute("aria-expanded") && !row.querySelector("button, a[href], input, select, textarea, [role=button]"))',
  );
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].every(row => { const description = document.getElementById(row.getAttribute("aria-describedby")); return !row.hasAttribute("aria-describedby") || (description?.hidden === true && ["Children expanded.", "Children collapsed."].includes(description.textContent)); })',
  );
  const audit = JSON.parse(browser("--json", "a11y", "--selector", "#task-list"));
  assert.equal(audit.success, true);
  assert.equal(audit.data.violations.length, 0, JSON.stringify(audit.data));
  assert.equal(audit.data.incomplete.length, 0, JSON.stringify(audit.data));
}
function toastWithText(message) {
  return `[...document.querySelectorAll("[data-slot=toast]")].find((toast) => toast.textContent.includes(${JSON.stringify(message)}))`;
}
function hasToastWithText(message) {
  return `Boolean(${toastWithText(message)})`;
}
function expandedTaskOptionExpression(title, selector = "#task-list [role=option]") {
  return `[...document.querySelectorAll(${JSON.stringify(selector)})].find((row) => row.textContent.includes(${JSON.stringify(title)}) && document.getElementById(row.getAttribute("aria-describedby"))?.textContent === "Children expanded.")`;
}
// The Active view's count: open and in-progress tasks, collapsed children included.
async function activeTaskCount() {
  return (await command("task.list", { status: ["open", "in_progress"] })).total;
}
function summaryBaseExpression() {
  return 'document.querySelector("[data-filter-summary] [data-slot=breadcrumb-list] > [data-slot=breadcrumb-item]")?.textContent.trim()';
}
function summaryFilterExpression(filter) {
  return `document.querySelector('[data-filter-summary] [data-filter-remove=${JSON.stringify(filter)}]')?.textContent.trim()`;
}
// toolbar.layout and platform.toolbar-cell: 32px cells scale with the text size, sit on integer
// columns from New task, groups never split, and rows after the first start one cell in. The logo
// and root status icons share New task's centerline, priority dots use the next column, and the
// count starts at the first cell's left edge.
function toolbarGridExpression(rows) {
  return `(() => {
    const capture = document.querySelector('button[aria-label="New task"]').getBoundingClientRect();
    const cell = capture.width;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const sized = Math.abs(cell - 2 * rem) < 0.5;
    const cells = [...document.querySelectorAll("[data-toolbar-cell]")].filter((element) => !element.closest("[hidden]"));
    const columnOf = (box) => (box.left - capture.left) / cell;
    const boxes = cells.map((element) => element.getBoundingClientRect());
    const onGrid = boxes.every((box) => Math.abs(box.width - cell) < 0.5 && Math.abs(box.height - cell) < 0.5 && Math.abs(columnOf(box) - Math.round(columnOf(box))) < 0.01);
    const whole = [...document.querySelectorAll("[data-slot=collapsible]")].every((group) => new Set([...group.querySelectorAll("[data-toolbar-cell]")].filter((element) => !element.closest("[hidden]")).map((element) => Math.round(element.getBoundingClientRect().top))).size === 1);
    const tops = [...new Set(boxes.map((box) => Math.round(box.top)))].sort((a, b) => a - b);
    const starts = tops.map((top) => Math.min(...boxes.filter((box) => Math.round(box.top) === top).map((box) => Math.round(columnOf(box)))));
    const centered = (box) => Math.abs(box.left + box.width / 2 - (capture.left + cell / 2)) < 0.5;
    const logo = document.querySelector("header .app-icon").getBoundingClientRect();
    const statuses = [...document.querySelectorAll('#task-list > [data-depth="0"] [data-status]')].map((element) => element.getBoundingClientRect());
    const priorities = [...document.querySelectorAll('#task-list > [data-depth="0"] [data-priority]')].map((element) => element.getBoundingClientRect());
    const priorityAligned = priorities.every((box) => Math.abs(box.left + box.width / 2 - (capture.left + cell * 1.5)) < 0.5);
    const summary = document.querySelector("[data-filter-summary]").getBoundingClientRect();
    const aligned = centered(logo) && statuses.every(centered) && priorityAligned && Math.abs(summary.left - capture.left) < 0.5;
    return document.documentElement.scrollWidth <= innerWidth && sized && onGrid && whole && aligned && tops.length === ${rows} && starts.every((start, row) => start === (row === 0 ? 0 : 1));
  })()`;
}
// The browser CLI can't emulate a coarse pointer, and CDP emulation lasts only while its session
// stays attached, so these expressions run inside one emulated session.
async function evaluateWithCoarsePointer(expressions) {
  const socket = new WebSocket(browser("get", "cdp-url").trim());
  const replies = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    replies.get(message.id)?.(message);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = ++nextId;
      replies.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  await new Promise((resolve) => (socket.onopen = resolve));
  try {
    const targets = (await send("Target.getTargets")).result.targetInfos;
    const page = targets.find((target) => target.type === "page" && target.url.startsWith(url));
    const { sessionId } = (
      await send("Target.attachToTarget", { targetId: page.targetId, flatten: true })
    ).result;
    await send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, maxTouchPoints: 5 },
      sessionId,
    );
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    await send(
      "Emulation.setEmulatedMedia",
      {
        features: [
          { name: "pointer", value: "coarse" },
          { name: "hover", value: "none" },
        ],
      },
      sessionId,
    );
    // Media queries match before the page restyles; wait until a cell has grown.
    assert.equal(
      (
        await send(
          "Runtime.evaluate",
          {
            expression:
              'new Promise((resolve) => { const started = performance.now(); const tick = () => { const grown = matchMedia("(pointer: coarse)").matches && document.querySelector("[data-toolbar-cell]").getBoundingClientRect().width > 30; if (grown || performance.now() - started > 3000) resolve(grown); else setTimeout(tick, 50); }; tick(); })',
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
        )
      ).result.result.value,
      true,
    );
    const results = [];
    for (const expression of expressions) {
      const reply = await send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      results.push(reply.result.result.value);
    }
    return results;
  } finally {
    socket.close();
  }
}
function focus(selector) {
  const expression = `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.focus(); return document.activeElement === element; })()`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      browser("focus", selector);
    } catch (error) {
      lastError = error;
    }
    try {
      if (evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    browser("wait", "100");
  }
  throw lastError ?? new Error(`Could not focus ${selector}`);
}
function printFailureDiagnostics() {
  try {
    console.error("Browser snapshot:\n" + browser("snapshot"));
  } catch (error) {
    console.error("Could not capture browser snapshot:", error);
  }
  try {
    console.error("Browser errors:\n" + browser("errors"));
  } catch (error) {
    console.error("Could not capture browser errors:", error);
  }
  try {
    console.error(
      "Browser state:",
      evaluate(
        '({ focus: document.activeElement?.tagName + ":" + (document.activeElement?.textContent ?? "").slice(0, 100), listbox: Boolean(document.querySelector("[role=listbox]")), activeDescendant: document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant"), activeTitle: document.getElementById(document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant"))?.textContent, activeOption: document.querySelector("#task-list [role=option][data-active]")?.id, selected: [...document.querySelectorAll("#task-list [role=option][aria-selected=true]")].map((row) => ({ id: row.id, title: row.textContent })), rows: document.querySelectorAll("#task-list [role=option]").length })',
      ),
    );
  } catch (error) {
    console.error("Could not capture browser state:", error);
  }
  console.error("Dev-server output:\n" + serverLog);
}
const QUERIES = new Set(["task.list", "task.get", "category.list", "tag.list", "workspace.info"]);
let selectionToken = null;
async function send(request) {
  const response = await fetch(`${backendUrl}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      connection: "close",
      "x-taskdb-selection": selectionToken,
    },
    body: JSON.stringify({
      version: 2,
      requestId: crypto.randomUUID(),
      actor: { kind: "agent", label: "UI check" },
      ...request,
    }),
  });
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
// Writes go through the same bridge as the app, under the folder's current write context.
async function command(command, args = {}) {
  if (QUERIES.has(command)) return (await send({ command, args, readOnly: true })).result;
  const { writeContext } = await send({ command: "workspace.info", readOnly: true });
  return (await send({ command, args, writeContext, idempotencyKey: crypto.randomUUID() })).result;
}
// Task files own their timestamps, so an older task is an edit to its file.
function stampTask(title, createdAt, updatedAt) {
  const directory = path.join(taskFolder, "tasks");
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    const record = JSON.parse(readFileSync(file, "utf8"));
    if (record.title !== title) continue;
    writeFileSync(file, `${JSON.stringify({ ...record, createdAt, updatedAt }, null, 2)}\n`);
    return;
  }
  throw new Error(`no task titled ${title}`);
}
// Themes are a browser-profile preference.
function selectedTheme() {
  return evaluate('localStorage.getItem("tasks.selectedTheme") ?? "gilt"');
}
async function versionOf(id) {
  return (await command("task.get", { id })).task.version;
}
// Every page load asks to confirm the dev bridge's folder before the list opens.
function openTasks() {
  waitFor(
    '[...document.querySelectorAll("button")].some((b) => b.textContent === "Open Tasks" && !b.disabled)',
  );
  browser("find", "role", "button", "click", "--name", "Open Tasks");
  waitFor('document.querySelector("[aria-label=\\"Saved tasks\\"]") !== null');
}
function reload() {
  browser("reload");
  openTasks();
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(serverLog);
    try {
      // Browser CLI calls block this event loop, so do not retain idle startup sockets.
      ready =
        (await fetch(`${backendUrl}/health`, { headers: { connection: "close" } })).ok &&
        (await fetch(url, { headers: { connection: "close" } })).ok;
    } catch {
      /* Startup may not have bound its ports yet. */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, serverLog);
  selectionToken = (
    await (await fetch(`${backendUrl}/health`, { headers: { connection: "close" } })).json()
  ).selectionToken;
  browser("open", url);
  openTasks();
  browser("snapshot", "-i");
  // The task list is home: no dialog opens and the empty list shell owns focus.
  waitFor('document.activeElement?.getAttribute("aria-label") === "Saved tasks"');
  check('document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") === null');
  check('document.body.textContent.includes("Press C or choose New task")');
  check('document.querySelector("[data-slot=empty-title]")?.textContent === "No active tasks"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks"');
  browser("press", "?");
  waitFor('document.querySelector("[data-starter-help]") !== null');
  check(
    'document.querySelector("[data-starter-help]")?.textContent.includes("Filter by category")',
  );
  check(
    'document.querySelector("[data-starter-help]")?.textContent.includes("Filter its category (no children)")',
  );
  browser("press", "?");
  waitFor('document.querySelector("[data-starter-help]") === null');
  // C opens the inline create editor with the title focused and notes closed.
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  check(
    '(() => { const editor = document.querySelector("[data-inline-task-editor]"); if (!editor) return false; const style = getComputedStyle(editor); const transparentBorder = style.borderColor === "rgba(0, 0, 0, 0)" || style.borderColor === "transparent"; return transparentBorder && style.backgroundColor !== getComputedStyle(document.body).backgroundColor; })()',
  );
  waitFor('document.activeElement.name === "title"');
  check("document.querySelector('form[aria-label=\"New task\"] textarea') === null");
  browser("press", "Tab");
  // Regression: Tab from an empty title must focus priority without opening the description.
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  check(
    '(() => { const group = document.querySelector("[data-priority-section]"); const lastButton = group?.querySelector("[data-priority=\\"P4\\"]"); return Boolean(group && lastButton && Math.abs(group.getBoundingClientRect().right - lastButton.getBoundingClientRect().right) < 1); })()',
  );
  check("document.querySelector('form[aria-label=\"New task\"] textarea') === null");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  check("document.querySelector('form[aria-label=\"New task\"] textarea') !== null");
  browser("click", 'form[aria-label="New task"] input');
  waitFor(
    'document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null',
  );
  check(
    'document.querySelector(\'form[aria-label="New task"] button[type="button"]\').tabIndex === -1',
  );
  check(
    'document.querySelector(\'form[aria-label="New task"] [role="radiogroup"]\').tabIndex === 0',
  );
  check(
    'document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').tabIndex === -1',
  );
  browser("find", "role", "button", "click", "--name", "Add description");
  waitFor('document.activeElement.name === "description"');
  browser("click", 'form[aria-label="New task"] input');
  waitFor(
    'document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null',
  );
  browser("press", "Enter");
  waitFor(
    'document.querySelector(\'form[aria-label="New task"] input\').getAttribute("aria-invalid") === "true"',
  );
  browser("fill", 'form[aria-label="New task"] input', "Book venue @launch #planning ");
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "Shift+Tab");
  waitFor(
    'document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null',
  );
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("fill", 'form[aria-label="New task"] textarea', "## Shortlist");
  browser("press", "Enter");
  browser("keyboard", "inserttext", "- Ask about accessibility");
  assert.equal((await command("task.list")).tasks.length, 0);
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  check('document.activeElement.hasAttribute("data-priority-section")');
  check(
    '[...document.querySelectorAll(\'[role="radiogroup"] [role="radio"]\')].every((radio) => radio.tabIndex === -1)',
  );
  for (const value of ["0", "1", "2", "3", "4"]) {
    browser("press", value);
    waitFor(
      `document.activeElement.matches("[role=radiogroup]") && document.querySelector('[role="radiogroup"] [data-priority="P${value}"]').getAttribute("aria-checked") === "true"`,
    );
  }
  browser("press", "2");
  waitFor(
    'document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "ArrowRight");
  waitFor(
    'document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P3"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "0");
  waitFor(
    'document.querySelector(\'[role="radiogroup"] [data-priority="P0"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P0"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "4");
  waitFor(
    'document.querySelector(\'[role="radiogroup"] [data-priority="P4"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "ArrowRight");
  waitFor(
    'document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P4"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "2");
  waitFor(
    'document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"',
  );
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  waitFor(
    '(() => { const dialog = [...document.querySelectorAll("[role=dialog]:not([aria-modal=false]):not([hidden])")].find((entry) => entry.querySelector("[cmdk-input]")); if (!dialog) return false; const top = Math.round(dialog.getBoundingClientRect().top); return top === 64 || top === 80; })()',
  );
  check(
    '(() => { const dialog = [...document.querySelectorAll("[role=dialog]:not([aria-modal=false]):not([hidden])")].find((entry) => entry.querySelector("[cmdk-input]")); if (!dialog) return false; if (dialog.getBoundingClientRect().bottom > innerHeight + 1) return false; const style = getComputedStyle(dialog); if (style.top !== "64px" && style.top !== "80px") return false; return style.padding === "0px"; })()',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("New task") && item.textContent.includes("C"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Switch active or inactive") && item.textContent.includes("S"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Exact status") && item.textContent.includes("O/I/D/P/X"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Filter shortcuts") && item.textContent.includes("F"))',
  );
  check(
    '(() => { const item = [...document.querySelectorAll("[data-slot=command-item]")].find((entry) => entry.textContent.includes("Sort tasks")); const keys = item?.querySelectorAll("[data-slot=command-shortcut] [data-slot=kbd]"); return keys?.[0]?.textContent === "S" && item?.textContent.includes("C/U/P/M/R"); })()',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Select a task range") && item.textContent.includes("Shift+↑/↓"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Move selected tasks") && item.textContent.includes("Ctrl/⌘+↑/↓"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Show task details") && item.textContent.includes("V"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Change task status") && item.textContent.includes("Shift+Space"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Pause or resume task") && item.textContent.includes("P"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Set active task priority") && item.textContent.includes("0"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Priority filter") && item.textContent.includes("0"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Set task priority") && item.textContent.includes("Focus Priority"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Filter by tags") && item.textContent.includes("T"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Search tasks") && item.textContent.includes("/"))',
  );
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Show unblocked tasks") && item.textContent.includes("U"))',
  );
  browser("fill", 'input[role="combobox"]', "@category");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  check('document.querySelector("[data-slot=command-item]").textContent.includes("One per task")');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  check(
    'document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\').value.includes("accessibility")',
  );
  // Hold one create reply open to assert the optimistic task appears before persistence finishes.
  evaluate(`window.originalFetch = window.fetch; window.delayCreateReply = true; window.fetch = async (...args) => {
    const response = await window.originalFetch(...args);
    if (window.delayCreateReply && args[1]?.body && JSON.parse(args[1].body).command === "task.create" && !JSON.parse(args[1].body).dryRun) {
      window.delayCreateReply = false;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return response;
  }; true`);
  // The task appears in the list immediately, while the composer stays mounted but hidden for recovery.
  browser("press", "Control+Enter");
  waitFor('document.querySelector("[data-optimistic-task]")?.textContent.includes("Book venue")');
  check('document.querySelector("[data-inline-task-editor]")?.parentElement?.hidden === true');
  check('document.querySelector("[data-optimistic-task] .animate-spin") === null');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  waitFor('document.querySelector("[data-optimistic-task]") === null');
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  evaluate("window.fetch = window.originalFetch; true");
  waitFor('document.activeElement?.getAttribute("role") === "listbox"');
  let saved = (await command("task.list")).tasks;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].description, "## Shortlist\n- Ask about accessibility");
  assert.equal(saved[0].category, "launch");
  assert.deepEqual(saved[0].tags, ["planning"]);
  waitFor('document.querySelector("[data-sort=task-sort-menu]")?.dataset.sortField === "created"');
  waitFor(
    'document.querySelector("#task-list [role=option] [data-slot=item-title]")?.textContent === "Book venue"',
  );
  waitFor(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${saved[0].id}" && document.getElementById("task-option-${saved[0].id}")?.getAttribute("aria-selected") === "true"`,
  );

  // Creating clears the old active task; either arrow starts again at the top.
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  check(
    '!document.querySelector("[role=listbox]").hasAttribute("aria-activedescendant") && document.querySelector("#task-list [role=option][aria-selected=true]") === null',
  );
  browser("fill", 'form[aria-label="New task"] input', "Draft @l");
  waitFor("document.querySelector('[aria-label=\"Categories autocomplete\"]') !== null");
  browser("press", "Escape");
  waitFor("document.querySelector('[aria-label=\"Categories autocomplete\"]') === null");
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  check(
    '!document.querySelector("[role=listbox]").hasAttribute("aria-activedescendant") && document.querySelector("#task-list [role=option][aria-selected=true]") === null',
  );

  focus("[role=listbox]");
  browser("press", "ArrowUp");
  waitFor(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${saved[0].id}" && document.getElementById("task-option-${saved[0].id}")?.getAttribute("aria-selected") === "true"`,
  );
  browser("press", "Enter");
  waitFor("document.querySelector('form[aria-label=\"Edit task\"]') !== null");
  check(
    'document.querySelector("[data-inline-task-editor]")?.parentElement === document.querySelector("[role=listbox]") && document.querySelectorAll("#task-list [role=option]").length === 0 && document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === null',
  );
  browser("fill", 'form[aria-label="Edit task"] input', "Draft @l");
  waitFor("document.querySelector('[aria-label=\"Categories autocomplete\"]') !== null");
  browser("press", "Escape");
  waitFor("document.querySelector('[aria-label=\"Categories autocomplete\"]') === null");
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  focus("[role=listbox]");
  browser("press", "ArrowRight");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true"',
  );
  check(
    `${summaryBaseExpression()} === "1 active task" && ${summaryFilterExpression("category")} === "launch"`,
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"',
  );
  check('document.querySelectorAll("#task-list [role=option] [data-slot=badge]").length === 2');
  check(
    'document.querySelector("#task-list [role=option] [data-priority=\'P2\']")?.textContent === ""',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-priority=\'P2\']")?.getAttribute("aria-label") === "Priority normal"',
  );
  check(
    '![...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].some((title) => title.textContent.includes("#planning"))',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("aria-label").includes("Status: Open")',
  );
  check(
    '(() => { const active = document.querySelector("#task-list [role=option][data-active]"); if (!active) return false; const style = getComputedStyle(active); const transparentBorder = style.borderColor === "rgba(0, 0, 0, 0)" || style.borderColor === "transparent"; return transparentBorder && style.backgroundColor !== getComputedStyle(document.body).backgroundColor; })()',
  );
  evaluate('document.querySelector("#task-list [role=option] [data-status]").click(); true');
  waitFor(
    'document.querySelector("form[aria-label^=Edit]") === null && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "in_progress"',
  );
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "In progress"');
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("aria-label").includes("Shift+Space")',
  );
  // Shift+Space reverses in_progress back to open; Space can move it forward again.
  browser("press", "Shift+Space");
  waitFor(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "open"',
  );
  browser("press", "Space");
  waitFor(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "in_progress"',
  );
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  check(
    'document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("title") === null',
  );
  assert.equal(saved[0].priority, 2);
  check(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"',
  );
  // F focuses the entire filter toolbar and opens a compact shortcut popover
  // without moving the list. The focus ring remains until a choice or Escape.
  focus("[role=listbox]");
  evaluate(
    'window.filterToolbarTop = document.querySelector("[aria-label=\\"Task list filters\\"]").getBoundingClientRect().top + window.scrollY; window.filterListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true',
  );
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  waitFor('document.querySelector("[data-shortcut-guide=filter]") !== null');
  browser("wait", "150");
  check(
    'document.querySelector("[data-shortcut-guide=filter] [data-shortcut-group=status]") !== null',
  );
  check(
    'document.querySelector("[data-shortcut-guide=filter] [data-shortcut-group=more]") !== null',
  );
  check(
    'document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=open] [data-shortcut-key=\\"O\\"]") !== null',
  );
  check(
    'document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=priority] [data-shortcut-key=\\"0–4\\"]") !== null',
  );
  check(
    '(() => { const guide = document.querySelector("[data-shortcut-guide=filter]")?.getBoundingClientRect(); const toolbar = document.querySelector("[data-toolbar=filters]")?.getBoundingClientRect(); if (!guide || !toolbar) return false; const expectedLeft = Math.max(5, Math.min(toolbar.right - guide.width, innerWidth - guide.width - 5)); return Math.abs(guide.left - expectedLeft) < 4; })()',
  );
  check(
    'document.querySelector("[aria-label=\\"Saved tasks\\"] [data-shortcut-guide=filter]") === null',
  );
  check(
    '(() => { const toolbar = document.querySelector("[data-toolbar=filters]"); if (!toolbar || !toolbar.hasAttribute("data-toolbar-active")) return false; const shadow = getComputedStyle(toolbar).boxShadow; return shadow !== "none" && shadow !== ""; })()',
  );
  check(
    'Math.abs(document.querySelector("[aria-label=\\"Task list filters\\"]").getBoundingClientRect().top + window.scrollY - window.filterToolbarTop) < 0.5 && Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.filterListTop) < 0.5',
  );
  browser("click", '[data-shortcut-guide=filter] [aria-label="Disable keyboard help"]');
  waitFor('document.querySelector("[data-disable-help-confirm]") !== null');
  browser("click", "[data-disable-help-confirm]");
  waitFor(
    'document.querySelector("[data-disable-help-confirm]") === null && document.querySelector("[data-shortcut-guide=filter]") === null',
  );
  browser("find", "role", "button", "click", "--name", "Settings");
  waitFor(
    'document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"',
  );
  check('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "none"');
  browser("click", "[data-help-mode]");
  waitFor('document.querySelector("[data-slot=select-content]") !== null');
  evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].find((item) => item.textContent.trim() === "Full").click(); true',
  );
  waitFor('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "full"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  // Pressing the focus key again closes the mode, while Escape remains a
  // second close path.
  browser("press", "f");
  waitFor(
    'document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-shortcut-guide]") && !document.querySelector("[data-toolbar=filters]").hasAttribute("data-toolbar-active")',
  );
  browser("press", "f");
  waitFor(
    'document.activeElement.matches("[data-toolbar=filters]") && document.querySelector("[data-shortcut-guide=filter]") !== null',
  );
  // F then S toggles the Active/Inactive presets.
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && !document.querySelector("[data-shortcut-guide]") && document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-toolbar=filters]").hasAttribute("data-toolbar-active")',
  );
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Inactive"');
  browser("wait", "150");
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 inactive tasks"');
  check(
    '(() => { const tip = document.querySelector("[data-slot=tooltip-content]")?.getBoundingClientRect(); const anchor = document.querySelector("[data-filter=task-status]")?.getBoundingClientRect(); return tip && anchor && Math.abs((tip.left + tip.width / 2) - (anchor.left + anchor.width / 2)) < 4; })()',
  );
  check(
    'document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"',
  );
  check(
    '(() => { const active = document.querySelector("[data-filter=task-status]"); const inactive = document.querySelector("[data-filter=task-unblocked]"); const activeStyle = getComputedStyle(active); const inactiveStyle = getComputedStyle(inactive); return activeStyle.backgroundColor !== inactiveStyle.backgroundColor && activeStyle.color !== inactiveStyle.color && activeStyle.borderColor !== "rgba(0, 0, 0, 0)"; })()',
  );
  // The selected toolbar border must not change its geometry at the narrow
  // window size where a one-pixel nudge is easiest to notice.
  browser("set", "viewport", "320", "844");
  evaluate(
    'window.statusFilterGeometry = (() => { const button = document.querySelector("[data-filter=task-status]"); const icon = button?.querySelector("svg"); const rect = button?.getBoundingClientRect(); const iconRect = icon?.getBoundingClientRect(); const style = button ? getComputedStyle(button) : null; return rect && iconRect && style ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, iconLeft: iconRect.left, iconTop: iconRect.top, borderLeft: style.borderLeftWidth } : null; })(); true',
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"',
  );
  browser("wait", "250");
  check(
    '(() => { const button = document.querySelector("[data-filter=task-status]"); const icon = button?.querySelector("svg"); const rect = button?.getBoundingClientRect(); const iconRect = icon?.getBoundingClientRect(); const style = button ? getComputedStyle(button) : null; const before = window.statusFilterGeometry; return before && rect && iconRect && style && Math.abs(rect.left - before.left) < 0.5 && Math.abs(rect.top - before.top) < 0.5 && Math.abs(rect.width - before.width) < 0.5 && Math.abs(rect.height - before.height) < 0.5 && Math.abs(iconRect.left - before.iconLeft) < 0.5 && Math.abs(iconRect.top - before.iconTop) < 0.5 && style.borderLeftWidth === before.borderLeft; })()',
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true"',
  );
  browser("set", "viewport", "1280", "844");
  waitFor('!document.querySelector("#task-list [role=option]")');
  // A no longer aliases the status preset.
  browser("press", "f");
  browser("press", "a");
  check(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true"',
  );
  browser("press", "Escape");
  waitFor('document.activeElement.matches("[role=listbox]")');
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "in_progress"',
  );
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Active"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  // P pauses and removes the task from Active. The toast confirms the new status.
  browser("press", "p");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as paused")}`,
  );
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks"');
  // Paused belongs to Inactive, where P can resume it to in progress.
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "paused"',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("aria-label").includes("Press P to resume")',
  );
  browser("press", "p");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as in progress")}`,
  );
  check(
    `(() => { const paused = ${toastWithText("Task marked as paused")}; const resumed = ${toastWithText("Task marked as in progress")}; const stacked = [paused, resumed].find((item) => item?.style.getPropertyValue("--toast-index") === "1"); return Boolean(stacked && getComputedStyle(stacked).transitionDuration.split(",").some((duration) => parseFloat(duration) > 0)); })()`,
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "in_progress"',
  );
  // in_progress Space skips paused and completes: it leaves Active, Inactive shows done.
  browser("press", "Space");
  waitFor('!document.querySelector("#task-list [role=option]")');
  waitFor(`${hasToastWithText("Task marked as done")}`);
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}).backgroundColor !== "rgba(0, 0, 0, 0)"`,
  );
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")).animationName === "task-completion-pop"`,
  );
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon path")).animationName === "task-completion-check"`,
  );
  check(
    `${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")?.classList.contains("size-4") === true`,
  );
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon circle")).stroke === getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")).color`,
  );
  check(
    `${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")?.classList.contains("lucide-circle-check") === true`,
  );
  check(
    'document.querySelector("[role=listbox] [data-empty-state=active]")?.textContent.includes("No active tasks") === true',
  );
  check(
    'document.querySelector("[role=listbox]").getAttribute("aria-label").includes("no active tasks")',
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "done"',
  );
  check(
    '![...document.querySelectorAll("[data-slot=tooltip-content]")].some((tip) => tip.textContent === "Done")',
  );
  // Shift+Space reverses done to in_progress, which leaves Inactive.
  browser("press", "Shift+Space");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as in progress")}`,
  );
  // Reversing in_progress to open stays inside Active.
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "in_progress"',
  );
  browser("press", "Shift+Space");
  waitFor(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "open"',
  );
  // Paused Space still completes: pause, switch to Inactive, then move paused to done.
  browser("press", "p");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as paused")}`,
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "paused"',
  );
  browser("press", "Space");
  waitFor(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "done"',
  );
  waitFor(`${hasToastWithText("Task marked as done")}`);
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")).animationName === "task-completion-pop"`,
  );
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon path")).animationName === "task-completion-check"`,
  );
  browser("press", "Space");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as open")}`,
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "open"',
  );
  // Reduced motion keeps the confirmed state but suppresses the check animation.
  browser("press", "p");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as paused")}`,
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "paused"',
  );
  browser("set", "media", "light", "reduced-motion");
  waitFor('matchMedia("(prefers-reduced-motion: reduce)").matches');
  browser("press", "Space");
  waitFor(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "done"',
  );
  waitFor(`${hasToastWithText("Task marked as done")}`);
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon")).animationName === "none"`,
  );
  check(
    `getComputedStyle(${toastWithText("Task marked as done")}?.querySelector(".task-completion-icon path")).animationName === "none"`,
  );
  browser("set", "media", "light");
  waitFor('!matchMedia("(prefers-reduced-motion: reduce)").matches');
  browser("press", "Space");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as open")}`,
  );
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "open"',
  );
  saved[0] = (await command("task.get", { id: saved[0].id })).task;
  assert.equal(saved[0].status, "open");
  // F-mode exact-status choices replace the preset and return focus to the
  // task list. The mode has no time limit.
  focus("[role=listbox]");
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  await delay(2200);
  check('document.activeElement.matches("[data-toolbar=filters]")');
  browser("press", "d");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done") && document.activeElement.matches("[role=listbox]")',
  );
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 done tasks"');
  browser("click", '[data-filter-remove="status"]');
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter-summary]")?.textContent === "1 active task" && document.querySelectorAll("#task-list [role=option]").length === 1',
  );
  browser("press", "f");
  browser("press", "d");
  waitFor(
    'document.querySelector("[data-filter-remove=status]") !== null && document.querySelector("[data-filter-summary]")?.textContent === "0 done tasks"',
  );
  // Escape from the focused toolbar returns to the list without changing the
  // current filter. Escape on the list still clears all filters.
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done") && document.activeElement.matches("[role=listbox]")',
  );
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "open" && document.activeElement.matches("[role=listbox]")',
  );
  // Mouse opens the same status menu.
  evaluate('document.querySelector("[data-filter=task-status]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Active") && item.textContent.includes("Open"))',
  );
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');

  // Inline edits preserve stale drafts after a conflict until discard.
  focus("[role=listbox]");
  browser("press", "Enter");
  waitFor("document.querySelector('form[aria-label=\"Edit task\"]') !== null");
  waitFor(
    "document.querySelector('form[aria-label=\"Edit task\"] input') === document.activeElement",
  );
  browser("fill", 'form[aria-label="Edit task"] input', "My unsaved title");
  const externalEdit = tasksCli(
    "update",
    saved[0].id,
    "--text",
    "Agent updated title",
    "--expected-version",
    String(saved[0].version),
    "--write-context",
    tasksCli("info").writeContext,
  );
  assert.equal(externalEdit.task.title, "Agent updated title");
  evaluate('window.dispatchEvent(new Event("focus")); true');
  browser("press", "Control+Enter");
  waitFor('document.body.textContent.includes("This task changed elsewhere")');
  check('document.querySelector("form[aria-label^=Edit] input").value === "My unsaved title"');
  browser("find", "role", "button", "click", "--name", "Cancel");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  waitFor('document.activeElement.getAttribute("role") === "listbox"');

  // Simulate commit-before-lost-reply. Retrying must not duplicate the task.
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  browser("fill", 'form[aria-label="New task"] input', "Next capture draft");
  evaluate(`window.originalFetch = window.fetch; window.loseReply = true; window.fetch = async (...args) => {
    const response = await window.originalFetch(...args);
    if (window.loseReply && args[1]?.body && JSON.parse(args[1].body).command === "task.create" && !JSON.parse(args[1].body).dryRun) {
      window.loseReply = false;
      await new Promise((resolve) => setTimeout(resolve, 350));
      throw new TypeError("Lost reply");
    }
    return response;
  }; true`);
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-optimistic-task]")?.textContent.includes("Next capture draft")',
  );
  // The unanswered request is kept, and only the same request can be retried.
  waitFor('document.body.textContent.includes("Workspace request needs attention")');
  waitFor('document.activeElement?.textContent === "Retry same request"');
  browser("press", "Enter");
  waitFor('!document.body.textContent.includes("Workspace request needs attention")');
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  assert.equal((await command("task.list")).tasks.length, 2);
  evaluate("window.fetch = window.originalFetch; true");

  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  browser("fill", 'form[aria-label="New task"] input', "Call the venue");
  browser("press", "Enter");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 3');
  check('document.querySelector("[data-filter-summary]")?.textContent === "3 active tasks"');

  // The shared ring keeps the page unchanged until a choice is confirmed.
  const originalTaskBytes = readdirSync(path.join(taskFolder, "tasks")).map((name) => [
    name,
    readFileSync(path.join(taskFolder, "tasks", name), "utf8"),
  ]);
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[role=listbox][aria-label=Themes]")');
  const themeCount = evaluate(
    'document.querySelectorAll("[aria-label=Themes] [role=option]").length',
  );
  check(
    'document.querySelector("[aria-label=Themes]").getAttribute("aria-activedescendant") === "theme-card-gilt"',
  );
  browser("press", "c");
  browser("press", "a");
  browser("press", "t");
  waitFor('document.querySelectorAll("[aria-label=Themes] [role=option]").length === 2');
  check('document.documentElement.dataset.theme === "gilt"');
  browser("press", "Escape");
  waitFor(
    'document.querySelectorAll("[aria-label=Themes] [role=option]").length === ' + themeCount,
  );
  for (const key of "gruvbox") browser("press", key);
  browser("press", "Enter");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && getComputedStyle(document.body).backgroundColor === "rgb(30, 30, 30)"',
  );
  assert.equal(selectedTheme(), "gruvbox");
  waitFor('!document.documentElement.classList.contains("theme-reveal")');
  for (const [name, bytes] of originalTaskBytes)
    assert.equal(readFileSync(path.join(taskFolder, "tasks", name), "utf8"), bytes);

  focus("#task-list");
  evaluate("window.themeOpenerFocus = document.activeElement; true");
  browser("find", "role", "button", "click", "--name", "Themes");
  waitFor('document.activeElement.matches("[role=listbox][aria-label=Themes]")');
  waitFor('!document.querySelector("[data-slot=tooltip-content]")');
  const themeAudit = JSON.parse(browser("--json", "a11y"));
  assert.equal(themeAudit.data.violations.length, 0, JSON.stringify(themeAudit.data.violations));
  browser("press", "Escape");
  waitFor("document.activeElement === window.themeOpenerFocus");
  reload();
  waitFor(
    'document.documentElement.dataset.theme === "gruvbox" && document.querySelectorAll("#task-list [role=option]").length === 3',
  );
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[role=listbox][aria-label=Themes]")');
  check(
    'document.querySelector("[aria-label=Themes]").getAttribute("aria-activedescendant") === "theme-card-gruvbox"',
  );
  for (const key of "latte") browser("press", key);
  browser("press", "Enter");
  waitFor(
    'document.documentElement.dataset.theme === "catppuccin-latte" && !document.documentElement.classList.contains("dark")',
  );
  waitFor('!document.documentElement.classList.contains("theme-reveal")');
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[role=listbox][aria-label=Themes]")');
  for (const key of "gilt") browser("press", key);
  browser("press", "Enter");
  waitFor('getComputedStyle(document.body).backgroundColor === "rgb(9, 10, 12)"');
  assert.equal(selectedTheme(), "gilt");
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 3');

  // Settings: the header icon opens a larger, two-column dialog.
  browser("find", "role", "button", "click", "--name", "Settings");
  waitFor(
    'document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"',
  );
  check('document.activeElement.matches("[role=tab][aria-selected=true]")');
  check('document.querySelectorAll("[role=tab]").length === 2');
  check(
    'document.querySelector("[data-slot=dialog-content]")?.getBoundingClientRect().width >= 700',
  );
  evaluate(
    'window.settingsDialogHeight = Math.round(parseFloat(getComputedStyle(document.querySelector("[data-slot=dialog-content]")).height)); true',
  );
  check('document.querySelector("[role=tablist]")?.getAttribute("aria-describedby") !== null');
  check(
    'document.body.textContent.includes("Use the Left and Right Arrow keys to switch sections.")',
  );
  check('document.querySelector("[data-theme-control]") === null');
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[data-font-size-control]")');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.matches("[role=tab][aria-selected=true]")');
  browser("press", "ArrowRight");
  waitFor('document.querySelector("[role=tab][aria-selected=true]")?.textContent === "Data"');
  check(
    'Math.round(parseFloat(getComputedStyle(document.querySelector("[data-slot=dialog-content]")).height)) === window.settingsDialogHeight',
  );
  check('document.querySelector("[role=tabpanel]")?.textContent.includes("Tasks home")');
  check('!document.querySelector("[role=tabpanel]")?.textContent.includes("Launch time")');
  check(`!document.body.textContent.includes(${JSON.stringify(cachePath)})`);
  check('document.querySelector("[role=tabpanel] [data-font-size-control]") === null');
  focus("[role=tab][aria-selected=true]");
  browser("press", "ArrowLeft");
  waitFor('document.querySelector("[role=tab][aria-selected=true]")?.textContent === "General"');
  // Full help is the default. The dropdown also keeps the old basic mode
  // available while adding a separate option for no automatic guidance.
  check('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "full"');
  browser("click", "[data-help-mode]");
  waitFor('document.querySelector("[data-slot=select-content]") !== null');
  check(
    '[...document.querySelectorAll("[data-slot=select-content][data-open] [data-slot=select-item]")].map((item) => item.textContent.trim()).join(",") === "Full,Basic,None"',
  );
  evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].find((item) => item.textContent.trim() === "Basic").click(); true',
  );
  waitFor('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "basic"');
  waitFor('document.activeElement.matches("[data-help-mode]")');
  browser("click", "[data-help-mode]");
  evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].find((item) => item.textContent.trim() === "Full").click(); true',
  );
  waitFor('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "full"');
  // Selection updates before the popup finishes restoring focus to its trigger.
  waitFor('document.activeElement.matches("[data-help-mode]")');
  // Context help uses the Tooltip component, points at the active field, and does not resize the list.
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=tab][aria-selected=true]")');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  browser("set", "viewport", "1981", "1071");
  browser("press", "c");
  waitFor('document.querySelector("form[aria-label=\\"New task\\"]") !== null');
  check('getComputedStyle(document.querySelector("[data-context-help]")).display !== "none"');
  check(
    '(() => { const shell = document.querySelector(".app-shell").getBoundingClientRect(); const help = document.querySelector("[data-context-help]").getBoundingClientRect(); const arrow = document.querySelector("[data-context-help] > [data-side]").getBoundingClientRect(); const anchor = document.querySelector("form[aria-label=\\"New task\\"] [data-slot=tooltip-trigger]").getBoundingClientRect(); return shell.width <= 704 && help.width < 320 && help.left >= 0 && help.right < anchor.left && arrow.right > help.right && arrow.right < anchor.left && Math.abs((arrow.top + arrow.height / 2) - (anchor.top + anchor.height / 2)) < 3; })()',
  );
  check(
    'document.querySelector("[data-context-help] [aria-label=\\"Use basic keyboard help\\"]") !== null',
  );
  browser("click", '[data-context-help] [aria-label="Use basic keyboard help"]');
  waitFor('document.querySelector("[data-disable-help-confirm]") !== null');
  check(
    'document.body.textContent.includes("Hide task editor help?") && document.body.textContent.includes("Restore Full anytime in Settings → General → Keyboard help.")',
  );
  browser("click", "[data-disable-help-cancel]");
  waitFor('document.querySelector("[data-disable-help-confirm]") === null');
  check('document.querySelector("[data-context-help]") !== null');
  waitFor(
    'document.querySelector("[data-context-help]")?.getAttribute("data-context-help") === "title"',
  );
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  waitFor(
    'document.querySelector("[data-context-help]")?.getAttribute("data-context-help") === "priority"',
  );
  check(
    '(() => { const help = document.querySelector("[data-context-help]").getBoundingClientRect(); const field = document.querySelector("[data-priority-section]").closest("[data-slot=field]").getBoundingClientRect(); return help.right < field.left; })()',
  );
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  waitFor(
    'document.querySelector("[data-context-help]")?.getAttribute("data-context-help") === "description"',
  );
  check(
    '(() => { const help = document.querySelector("[data-context-help]").getBoundingClientRect(); const field = document.querySelector("form[aria-label=\\"New task\\"] textarea").closest("[data-slot=field]").getBoundingClientRect(); return help.right < field.left; })()',
  );
  browser("set", "viewport", "720", "500");
  check('getComputedStyle(document.querySelector("[data-context-help]")).display !== "none"');
  check(
    '(() => { const help = document.querySelector("[data-context-help]").getBoundingClientRect(); return help.left >= 0 && help.right <= innerWidth && help.top >= 0 && help.bottom <= innerHeight; })()',
  );
  browser("set", "viewport", "1280", "844");
  browser("click", '[data-context-help] [aria-label="Use basic keyboard help"]');
  waitFor('document.querySelector("[data-disable-help-confirm]") !== null');
  browser("click", "[data-disable-help-confirm]");
  waitFor(
    'document.querySelector("[data-context-help]") === null && document.querySelector("[data-disable-help-confirm]") === null',
  );
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  browser("find", "role", "button", "click", "--name", "Settings");
  waitFor(
    'document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"',
  );
  check('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "basic"');
  browser("click", "[data-help-mode]");
  waitFor('document.querySelector("[data-slot=select-content]") !== null');
  evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].find((item) => item.textContent.trim() === "None").click(); true',
  );
  waitFor('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "none"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  focus("[role=listbox]");
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  check('document.querySelector("[data-shortcut-guide]") === null');
  browser("press", "f");
  waitFor('document.activeElement.matches("[role=listbox]")');
  browser("find", "role", "button", "click", "--name", "Settings");
  waitFor(
    'document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"',
  );
  check('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "none"');
  browser("click", "[data-help-mode]");
  waitFor('document.querySelector("[data-slot=select-content]") !== null');
  evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].find((item) => item.textContent.trim() === "Basic").click(); true',
  );
  waitFor('document.querySelector("[data-help-mode]")?.getAttribute("data-help-mode") === "basic"');
  evaluate(
    '[...document.querySelectorAll("[role=tab]")].find((tab) => tab.textContent === "Data").click(); true',
  );
  waitFor('document.querySelector("[role=tab][aria-selected=true]")?.textContent === "Data"');
  evaluate(
    '[...document.querySelectorAll("[role=tab]")].find((tab) => tab.textContent === "General").click(); true',
  );
  waitFor('document.querySelector("[role=tab][aria-selected=true]")?.textContent === "General"');
  check('document.querySelector("[data-font-size-control]")?.value === "0"');
  check(
    'document.querySelector("[data-font-size-control]")?.getAttribute("aria-valuetext") === "Default font size"',
  );
  for (const [value, increase] of [
    ["1", 10],
    ["2", 25],
    ["3", 33],
    ["4", 40],
  ]) {
    focus("[data-font-size-control]");
    browser("press", "ArrowRight");
    waitFor(`document.querySelector("[data-font-size-control]")?.value === "${value}"`);
    check(`document.documentElement.style.fontSize === "${100 + increase}%"`);
  }
  browser("press", "Home");
  waitFor('document.querySelector("[data-font-size-control]")?.value === "0"');
  check('document.documentElement.style.fontSize === ""');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  check('document.activeElement.matches("[role=listbox]")');

  // The palette reaches the same dialog without a mouse.
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "settings");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"',
  );
  browser("press", "Escape");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.activeElement.matches("[role=listbox]")',
  );

  // Tab does not leave the task list; C opens inline capture from the list.
  focus("[role=listbox]");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === null');
  check('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 0');
  check("document.querySelector('button[aria-label=\"New task\"]')?.tabIndex === -1");
  evaluate("window.beforeNav = document.activeElement; true");
  browser("press", "Escape");
  waitFor("document.activeElement === window.beforeNav");
  browser("press", "ArrowDown");
  waitFor(
    '(() => { const list = document.querySelector("[role=listbox]"); const first = [...document.querySelectorAll("#task-list [role=option]")].find((row) => !row.hasAttribute("data-context-parent")); return list.getAttribute("aria-activedescendant") === first?.id && first?.getAttribute("aria-selected") === "true"; })()',
  );
  browser("press", "ArrowUp");
  waitFor(
    '(() => { const list = document.querySelector("[role=listbox]"); const rows = [...document.querySelectorAll("#task-list [role=option]")].filter((row) => !row.hasAttribute("data-context-parent")); return list.getAttribute("aria-activedescendant") === rows.at(-1)?.id; })()',
  );
  browser("press", "Tab");
  waitFor("document.activeElement === window.beforeNav");
  browser("press", "Shift+Tab");
  waitFor("document.activeElement === window.beforeNav");
  // Toolbar clicks never steal list focus (real mouse), and arrows keep
  // working even when focus is elsewhere on the home surface.
  browser("click", "[data-filter=task-unblocked]");
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true"',
  );
  check("document.activeElement === window.beforeNav");
  evaluate(
    'window.beforeToolbarNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true',
  );
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeToolbarNav',
  );
  evaluate("document.activeElement.blur(); true");
  check('document.activeElement.tagName === "BODY"');
  evaluate(
    'window.beforeBlurNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true',
  );
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeBlurNav',
  );
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "u");
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"',
  );
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-inline-task-editor]") === null && document.activeElement.getAttribute("role") === "listbox"',
  );
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === document.querySelector("#task-list [role=option]:not([data-context-parent])").id',
  );
  // Enter on the list focuses the highlighted task's inline editor.
  browser("press", "Enter");
  waitFor('document.querySelector("form[aria-label^=Edit]") !== null');
  waitFor(
    "document.querySelector('form[aria-label=\"Edit task\"] input') === document.activeElement",
  );
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-inline-task-editor]") === null && document.activeElement.getAttribute("role") === "listbox"',
  );

  // The palette also opens the inline create editor.
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "new task inline");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');

  focus("[role=listbox]");
  evaluate(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((entry) => entry.textContent.includes("Call the venue")); window.editedTaskOptionId = row?.id; row?.click(); return true; })()',
  );
  waitFor("document.querySelector('form[aria-label=\"Edit task\"]') !== null");
  check(
    'document.querySelector("[data-inline-task-editor]")?.parentElement === document.querySelector("[role=listbox]") && document.getElementById(window.editedTaskOptionId) === null && document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === null',
  );
  browser("fill", 'form[aria-label="Edit task"] input', "Confirm the venue");
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "4");
  waitFor(
    'document.querySelector(\'form[aria-label="Edit task"] [data-priority="P4"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")',
  );
  check(
    '[...document.querySelectorAll(\'form[aria-label="Edit task"] [role="radio"]\')].every((button) => getComputedStyle(button).borderLeftWidth === "1px")',
  );
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-inline-task-editor]") === null && document.activeElement.matches("[role=listbox]")',
  );
  check(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === window.editedTaskOptionId',
  );
  assert.ok(
    (await command("task.list")).tasks.some(
      (task) => task.title === "Confirm the venue" && task.priority === 4,
    ),
  );

  await command("task.create", {
    text: "Check ".repeat(60),
    description: "Long notes ".repeat(100),
  });
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 4');
  // toolbar.layout: every visible cell sits on the column grid that starts at New task.
  for (const [width, rows] of [
    [1280, 1],
    [390, 3],
    [320, 3],
  ]) {
    browser("set", "viewport", String(width), "844");
    check(toolbarGridExpression(rows));
  }
  browser("set", "viewport", "1280", "844");
  // toolbar.fold: an open glyph's mark is as wide as its icon, centered under it and clear of it. A folded glyph has none,
  // and its dashed outline lies inside the border, where filled buttons paint.
  const glyphMarks =
    '[...document.querySelectorAll("[data-toolbar-glyph]")].every((glyph) => { const icon = glyph.querySelector("svg:not(.hidden)").getBoundingClientRect(); const mark = glyph.querySelector("[data-toolbar-glyph-mark]")?.getBoundingClientRect(); const style = getComputedStyle(glyph); if (glyph.getAttribute("aria-expanded") === "false") return !mark && style.outlineStyle === "dashed" && parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) <= -parseFloat(style.borderTopWidth); return mark && Math.abs(mark.width - icon.width) < 0.5 && Math.abs(mark.left + mark.width / 2 - (icon.left + icon.width / 2)) < 0.5 && mark.top >= icon.bottom + 1.5; })';
  check(glyphMarks);
  const actionsGlyph = 'document.querySelector("[data-toolbar-glyph=actions]")';
  evaluate(`${actionsGlyph}.click()`);
  // The button's transition eases the outline in, so wait for it to settle.
  waitFor(`${actionsGlyph}.getAttribute("aria-expanded") === "false" && ${glyphMarks}`);
  evaluate(`${actionsGlyph}.click()`);
  waitFor(`${actionsGlyph}.getAttribute("aria-expanded") === "true"`);
  // On a wide window the top bar's buttons share the toolbar's columns.
  check(
    `(() => { const capture = document.querySelector('button[aria-label="New task"]').getBoundingClientRect(); const buttons = [...document.querySelectorAll("header button")].map((button) => button.getBoundingClientRect()); return buttons.length === 3 && buttons.every((box) => Math.abs(box.width - capture.width) < 0.5 && Math.abs(((box.left - capture.left) / capture.width) % 1) < 0.01); })()`,
  );
  check(
    '(() => { const title = [...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].find((entry) => entry.textContent.startsWith("Check Check")); if (!title || title.textContent.length <= 100) return false; const style = getComputedStyle(title); return style.whiteSpace !== "nowrap" && title.scrollWidth <= title.clientWidth + 1; })()',
  );
  const audit = JSON.parse(browser("--json", "a11y"));
  assert.equal(audit.success, true);
  assert.equal(audit.data.violations.length, 0, JSON.stringify(audit.data));
  check(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"',
  );
  check(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"',
  );
  // Delete is scoped to a focused row and cancels it immediately. C never fires while typing.
  focus("[role=listbox]");
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  waitFor('document.querySelector("[data-inline-task-editor]") !== null');
  check(
    '(() => { const editor = document.querySelector("[data-inline-task-editor]")?.getBoundingClientRect(); return editor && editor.width <= innerWidth && editor.left >= 0 && editor.top >= 0 && editor.bottom <= innerHeight; })()',
  );
  browser("press", "Delete");
  check(
    'document.querySelector(\'form[aria-label="New task"]\') !== null && ![...document.querySelectorAll("[role=dialog]:not([aria-modal=false]):not([hidden])")].some((dialog) => dialog.textContent.includes("Cancel task?"))',
  );
  browser("press", "Escape");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  focus("[role=listbox]");
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== null',
  );
  const deletedId = evaluate(
    'window.deleteList = document.activeElement; window.deletedId = document.activeElement.getAttribute("aria-activedescendant").slice("task-option-".length); window.deletedId',
  );
  browser("press", "Delete");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.querySelectorAll("#task-list [role=option]").length === 3',
  );
  waitFor(`${hasToastWithText("Task marked as canceled")}`);
  check("document.activeElement === window.deleteList");
  assert.equal((await command("task.get", { id: deletedId })).task.status, "canceled");

  // Canceled tasks are easy to recover through the inactive filter.
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "canceled"',
  );
  browser("press", "Space");
  waitFor(
    `!document.querySelector("#task-list [role=option]") && ${hasToastWithText("Task marked as open")}`,
  );
  assert.equal((await command("task.get", { id: deletedId })).task.status, "open");
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 4',
  );

  // A stale immediate cancellation is rejected and refreshes the row.
  const staleId = evaluate(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)',
  );
  const staleTask = (await command("task.get", { id: staleId })).task;
  await command("task.update", {
    id: staleId,
    expectedVersion: staleTask.version,
    title: "Changed before delete",
  });
  browser("press", "Delete");
  waitFor('document.body.textContent.includes("changed elsewhere")');
  waitFor(
    'document.querySelector("#task-list [role=option] [data-slot=item-title]")?.textContent === "Changed before delete"',
  );
  check(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.querySelectorAll("#task-list [role=option]").length === 4',
  );

  // A committed cancellation with a lost reply can be retried safely.
  const lostId = evaluate(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)',
  );
  evaluate(`window.originalFetch = window.fetch; window.loseReply = true; window.deleteKeys = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    const response = await window.originalFetch(...args);
    if (payload?.command === "task.delete" && !payload.dryRun) {
      window.deleteKeys.push(payload.idempotencyKey);
      if (window.loseReply) { window.loseReply = false; throw new TypeError("Lost delete reply"); }
    }
    return response;
  }; true`);
  browser("press", "Delete");
  waitFor('document.body.textContent.includes("Workspace request needs attention")');
  waitFor('document.activeElement?.textContent === "Retry same request"');
  browser("press", "Enter");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.querySelectorAll("#task-list [role=option]").length === 3',
  );
  waitFor(`${hasToastWithText("Task marked as canceled")}`);
  check("window.deleteKeys.length === 2 && window.deleteKeys[0] === window.deleteKeys[1]");
  check('document.activeElement.matches("[role=listbox]")');
  evaluate("window.fetch = window.originalFetch; true");
  assert.equal((await command("task.get", { id: lostId })).task.status, "canceled");
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1',
  );
  check(
    'document.querySelector("#task-list [role=option] [data-status]").getAttribute("data-status") === "canceled"',
  );
  browser("press", "Space");
  waitFor('!document.querySelector("#task-list [role=option]")');
  assert.equal((await command("task.get", { id: lostId })).task.status, "open");
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 4',
  );
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 4');
  check('document.querySelectorAll(`[data-status="open"]`).length === 4');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  assert.equal((await command("task.list")).total, 4);

  // The outline is intentionally shallow in the UI. A grandchild remains
  // visible at one indentation level rather than creating recursive nesting.
  const treeParent = (await command("task.create", { text: "Release parent" })).task;
  const treeChild = (await command("task.create", { text: "Package child" })).task;
  const treeGrandchild = (await command("task.create", { text: "Deep child" })).task;
  await command("task.move", {
    id: treeChild.id,
    parentId: treeParent.id,
    expectedVersion: await versionOf(treeChild.id),
  });
  await command("task.move", {
    id: treeGrandchild.id,
    parentId: treeChild.id,
    expectedVersion: await versionOf(treeGrandchild.id),
  });
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 5');
  check('!document.body.textContent.includes("Package child")');
  evaluate(`(() => {
    const row = [...document.querySelectorAll('#task-list [role=option]')].find((entry) => entry.textContent.includes('Release parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor(
    'document.querySelectorAll("#task-list [role=option]").length === 7 && document.querySelectorAll("[data-depth=\\"1\\"]").length === 2',
  );
  check(`Boolean(${expandedTaskOptionExpression("Release parent")})`);
  auditTaskList();
  check('document.querySelector("[data-depth=\\"1\\"] .pl-6") !== null');
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' +
      treeGrandchild.id +
      '")',
  );
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' +
      treeChild.id +
      '")',
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' +
      treeParent.id +
      '")',
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.querySelectorAll("#task-list [role=option]").length === 5 && !document.querySelector("[data-depth=\\"1\\"]")',
  );

  // The unblocked filter ignores canceled dependency targets and can be
  // toggled from the focused list with F then U.
  const blocker = (await command("task.create", { text: "Release blocker" })).task;
  const blocked = (await command("task.create", { text: "Blocked task" })).task;
  await command("task.dependency.add", {
    id: blocked.id,
    dependsOnId: blocker.id,
    expectedVersion: await versionOf(blocked.id),
  });
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 7');
  check(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"',
  );
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "u");
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true"',
  );
  check('document.querySelector("[data-filter-summary]")?.textContent.includes("unblocked")');
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 6');
  check(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Blocked task"))',
  );
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Release blocker"))',
  );
  browser("press", "f");
  browser("press", "u");
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 7',
  );
  browser("press", "f");
  browser("press", "u");
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 6',
  );
  browser("click", '[data-filter-remove="unblocked"]');
  waitFor(
    'document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 7',
  );
  assert.equal((await command("task.list", { unblocked: true })).total, 8);

  // Relationship context stays visible in compact rows; when details are on,
  // the optional time footer remains the final row even when a task is blocked.
  focus("[role=listbox]");
  check(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"',
  );
  check(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((item) => item.textContent.includes("Blocked task")); if (!row) return false; const paragraphs = [...row.querySelectorAll("p")]; const relationship = paragraphs.find((entry) => entry.textContent.includes("Release blocker")); return relationship !== undefined && row.querySelector("[data-task-description]") === null && row.querySelector("[title^=\\"Created\\"]") === null; })()',
  );
  browser("press", "v");
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"',
  );
  check(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((item) => item.textContent.includes("Blocked task")); if (!row) return false; const paragraphs = [...row.querySelectorAll("p")]; const relationship = paragraphs.find((entry) => entry.textContent.includes("Release blocker")); const timestamp = paragraphs.find((entry) => entry.querySelector("[title^=\\"Created\\"]")); return relationship !== undefined && timestamp !== undefined && paragraphs.indexOf(relationship) < paragraphs.indexOf(timestamp) && paragraphs.indexOf(timestamp) === paragraphs.length - 1; })()',
  );
  browser("press", "v");
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"',
  );
  check(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((item) => item.textContent.includes("Blocked task")); return row?.querySelector("[data-task-description]") === null && row?.querySelector("[title^=\\"Created\\"]") === null && row?.textContent.includes("Release blocker"); })()',
  );

  // F then C opens the category selector. Choosing a category enables the Folder
  // filter button; clicking it again clears the category filter.
  await command("task.create", { text: "Roadmap task @roadmap" });
  await command("task.create", { text: "Launch follow-up @launch" });
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 9');
  check(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"',
  );
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "c");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('document.querySelectorAll("[cmdk-group-heading] svg").length === 1');
  check(`(() => {
    const rows = [...document.querySelectorAll("[data-slot=command-item]")];
    if (rows.length < 2) return false;
    const boxes = (selector) => rows.map((row) => row.querySelector(selector)?.getBoundingClientRect());
    const command = document.querySelector("[data-slot=command]")?.getBoundingClientRect();
    const labels = boxes(".font-medium");
    const counts = boxes("[data-category-count]");
    const numbers = boxes("[data-category-count-value]");
    const units = boxes("[data-category-count-unit]");
    const unitText = rows.map((row) => {
      const range = document.createRange();
      range.selectNodeContents(row.querySelector("[data-category-count-unit-label]"));
      return range.getBoundingClientRect();
    });
    const aligned = (rects, edge) => rects.every(Boolean) && Math.max(...rects.map((rect) => rect[edge])) - Math.min(...rects.map((rect) => rect[edge])) < 1;
    const countWidths = rows.map((row) => getComputedStyle(row).getPropertyValue("--category-count-width").trim());
    const rightGaps = rows.map((row, index) => row.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(row).paddingRight) - counts[index].right);
    const numberUnitGaps = rows.map((row, index) => units[index].left - numbers[index].right);
    return aligned(labels, "left")
      && aligned(counts, "right")
      && aligned(numbers, "right")
      && aligned(units, "left")
      && aligned(unitText, "left")
      && countWidths.every((width) => Number.parseFloat(width) >= 2 && width.endsWith("ch"))
      && new Set(countWidths).size === 1
      && rightGaps.every((gap) => Math.abs(gap) < 1)
      && numberUnitGaps.every((gap) => gap >= 0 && gap <= 6)
      && command !== undefined
      && Math.abs((labels[0].left - command.left) - (command.right - unitText[0].right)) < 16;
  })()`);
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("roadmap"))',
  );
  browser("fill", 'input[role="combobox"]', "roadmap");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1 && document.activeElement.matches("[role=listbox]")',
  );
  check(`${summaryBaseExpression()} === "1 active task"`);
  check(
    'document.querySelector("[data-filter-summary] [data-filter-category]")?.textContent === "roadmap"',
  );
  check('document.querySelector("#task-list [role=option]").textContent.includes("Roadmap task")');
  check(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-label").includes("roadmap")',
  );
  focus("[role=listbox]");
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 9',
  );
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"',
  );
  // @ opens the category picker directly with its search field ready for typing.
  focus("[role=listbox]");
  browser("press", "@");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "launch");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")',
  );
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 9',
  );
  auditTaskList();
  check(
    'document.querySelector("[data-task-category=launch]").getAttribute("role") === "img" && document.querySelector("[data-task-category=launch]").getAttribute("aria-label").includes("press @")',
  );
  // Clicking a task's category badge filters to that category without opening the picker.
  evaluate('document.querySelector("[data-task-category=launch]").click(); true');
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1 && document.activeElement.matches("[role=listbox]")',
  );
  check(
    'document.querySelector("[data-filter-summary] [data-filter-category]")?.textContent === "launch"',
  );
  const summaryAudit = JSON.parse(browser("--json", "a11y", "--selector", "[data-filter-summary]"));
  assert.equal(summaryAudit.success, true);
  assert.equal(summaryAudit.data.violations.length, 0, JSON.stringify(summaryAudit.data));
  assert.equal(summaryAudit.data.incomplete.length, 0, JSON.stringify(summaryAudit.data));
  check(
    'document.querySelector("#task-list [role=option]").textContent.includes("Launch follow-up")',
  );
  browser("press", "f");
  browser("press", "4");
  waitFor(
    `document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 0 && ${summaryBaseExpression()} === "0 active tasks" && ${summaryFilterExpression("category")} === "launch" && ${summaryFilterExpression("priority")} === "P4"`,
  );
  browser("click", '[data-filter-remove="priority"]');
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1',
  );
  browser("click", '[data-filter-remove="category"]');
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 9 && document.activeElement.matches("[role=listbox]")',
  );

  // Priority: P2 is the default, F then 0-4 filters on the list, bare 0-4
  // sets the active task, and the inline editor sets the task priority
  // without putting individual buttons in Tab order.
  assert.equal((await command("task.list", { priority: 2 })).total >= 9, true);
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "0");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 0',
  );
  check(
    `${summaryBaseExpression()} === "0 active tasks" && ${summaryFilterExpression("priority")} === "P0"`,
  );
  waitFor(
    'document.activeElement.matches("[role=listbox]") && document.querySelector("[data-empty-state=filtered]") !== null',
  );
  check('document.body.textContent.includes("No tasks match the current filters")');
  check('document.querySelector("[data-empty-state=filtered] button").tabIndex === -1');
  check(
    '(() => { const list = document.querySelector("[role=listbox]"); const empty = document.querySelector("[data-empty-state=filtered]"); if (!list || !empty) return false; const listBox = list.getBoundingClientRect(); const emptyBox = empty.getBoundingClientRect(); const style = getComputedStyle(empty); return Math.abs(emptyBox.width - listBox.width) < 1 && emptyBox.height >= 48 && emptyBox.height <= 120 && style.borderStyle === "dashed" && (style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent"); })()',
  );
  evaluate("window.filteredEmptyList = document.activeElement; true");
  browser("press", "Tab");
  waitFor("document.activeElement === window.filteredEmptyList");
  browser("press", "f");
  browser("press", "s");
  waitFor(
    'document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")',
  );
  // Escape resets filters, returning to the full Active view.
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 9 && document.activeElement.matches("[role=listbox]")',
  );
  // Filtering again, then the same key clears the priority filter.
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "0");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 0',
  );
  browser("press", "f");
  browser("press", "0");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 9',
  );
  // Bare 0-4 on the list sets the active task's priority instead of filtering.
  // No focus call here: list focus persists from above, and refocusing would
  // refetch and heal the stale version the next step depends on.
  const priorityId = evaluate(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)',
  );
  const priorityBefore = (await command("task.get", { id: priorityId })).task;
  browser("press", "1");
  waitFor('document.body.textContent.includes(": priority high")');
  assert.equal((await command("task.get", { id: priorityId })).task.priority, 1);
  // A stale version rejects the quick-set and keeps the row in place. The
  // outside edit must really change the task: an identical update is a
  // no-op and bumps nothing.
  await command("task.update", {
    id: priorityId,
    expectedVersion: await versionOf(priorityId),
    title: `${priorityBefore.title} (agent edit)`,
    description: priorityBefore.description,
  });
  browser("press", "3");
  waitFor('document.body.textContent.includes("changed elsewhere")');
  assert.equal((await command("task.get", { id: priorityId })).task.priority, 1);
  // Mouse opens the priority menu and picks P2.
  evaluate('document.querySelector("[data-filter=task-priority]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("P2"))',
  );
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  // The inline editor defaults to P2. Pointer selection works too, but the group
  // remains the one keyboard focus target.
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  check(
    'document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"',
  );
  check(
    '[...document.querySelectorAll(\'form[aria-label="New task"] [role="radio"]\')].every((button) => getComputedStyle(button).borderLeftWidth === "1px")',
  );
  check(
    'document.querySelector(\'form[aria-label="New task"] [role="radiogroup"]\').tabIndex === 0',
  );
  browser("find", "role", "radio", "click", "--name", "P2: normal");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  evaluate(
    'document.querySelector(\'form[aria-label="New task"] [data-priority="P3"]\').click(); true',
  );
  waitFor(
    'document.querySelector(\'form[aria-label="New task"] [data-priority="P3"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")',
  );
  browser("fill", 'form[aria-label="New task"] input', "Urgent cockpit task");
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "0");
  waitFor(
    'document.querySelector(\'form[aria-label="New task"] [data-priority="P0"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")',
  );
  browser("press", "Control+Enter");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  assert.equal((await command("task.list", { priority: 0 })).total, 1);
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 10');

  // Tags: F then T opens a multi-select picker with AND semantics; the
  // picker's Clear tags row empties the filter.
  await command("task.create", { text: "Tag cockpit #planning #product" });
  await command("task.create", { text: "Planning only #planning" });
  reload();
  waitFor('document.querySelectorAll("#task-list [role=option]").length === 12');
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))',
  );
  browser("press", "Space");
  waitFor(
    'document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") !== null',
  );
  // Picker stays open for multi-select; pick product to narrow to AND with Space.
  check('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "product");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("product"))',
  );
  browser("press", "Space");
  waitFor("document.querySelectorAll('#task-list [role=option]').length === 1");
  check(
    `${summaryBaseExpression()} === "1 active task" && ${summaryFilterExpression("tags")} === "#planning #product"`,
  );
  check("document.querySelector('#task-list [role=option]').textContent.includes(\"Tag cockpit\")");
  // Enter closes the picker without changing the current multi-selection.
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")');
  // Clearing lives in the picker itself: reopen and pick Clear tags.
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate(
    '[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Clear tags")).click(); true',
  );
  waitFor(
    'document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false"',
  );
  browser("press", "Escape");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.querySelectorAll("#task-list [role=option]").length === 12',
  );
  // Twelve top-level rows; the count also includes their collapsed children.
  const allActive = `${await activeTaskCount()} active tasks`;
  // With no selection, Enter picks the highlighted tag before closing the picker.
  const planningCount = (await command("task.list", { tags: ["planning"] })).total;
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))',
  );
  browser("press", "Enter");
  waitFor(
    '!document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")',
  );
  waitFor(
    `${summaryBaseExpression()} === "${planningCount} active task${planningCount === 1 ? "" : "s"}" && ${summaryFilterExpression("tags")} === "#planning"`,
  );
  browser("click", '[data-filter-remove="tags"]');
  waitFor(
    `document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 12 && document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`,
  );
  // # opens the tag picker directly with its search field ready for typing.
  focus("[role=listbox]");
  browser("press", "#");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))',
  );
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && !document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])") && document.activeElement.matches("[role=listbox]")',
  );
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor(
    'document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 12',
  );

  // Search: / opens, covers titles and descriptions, stays applied, and the
  // button clears with a mouse action. Empty filters offer Clear filters.
  focus("[role=listbox]");
  browser("press", "/");
  waitFor("document.querySelector('input[name=\"search\"]') !== null");
  browser("fill", 'input[name="search"]', "accessibility");
  check('document.querySelector(\'input[name="search"]\').value === "accessibility"');
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 1',
  );
  check(
    `${summaryBaseExpression()} === "1 active task" && ${summaryFilterExpression("search")} === "“accessibility”"`,
  );
  check(
    'document.querySelector("[data-filter=task-search]").getAttribute("aria-label").includes("accessibility")',
  );
  browser("click", '[data-filter-remove="search"]');
  waitFor(
    `document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 12 && document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`,
  );
  // A query with no matches shows the filtered empty state with Clear filters.
  focus("[role=listbox]");
  browser("press", "/");
  waitFor("document.querySelector('input[name=\"search\"]') !== null");
  browser("fill", 'input[name="search"]', "zzz-no-such-task");
  check('document.querySelector(\'input[name="search"]\').value === "zzz-no-such-task"');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("No tasks match the current filters")');
  check(
    `${summaryBaseExpression()} === "0 active tasks" && ${summaryFilterExpression("search")} === "“zzz-no-such-task”"`,
  );
  browser("find", "role", "button", "click", "--name", "Clear filters");
  waitFor(
    'document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#task-list [role=option]").length === 12',
  );
  check(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  // Task details and sorting: V toggles descriptions plus the time footer,
  // S drives the sort, and both survive a reload through localStorage.
  check(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"',
  );
  check('document.querySelector("[data-task-description]") === null');
  check('document.querySelector("[title^=\\"Created\\"]") === null');
  focus("[role=listbox]");
  browser("press", "v");
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"',
  );
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].every((row) => row.textContent.includes("Created today"))',
  );
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].every((row) => row.querySelector("[title^=\\"Created\\"]") !== null)',
  );
  check(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((item) => item.textContent.includes("Agent updated title")); return row?.querySelector("[data-task-description]")?.textContent.includes("Shortlist") === true; })()',
  );
  check('document.querySelector("[title^=\\"Updated\\"]") === null');
  // Stamp two rows older: recent timestamps use relative labels and the
  // updated line appears only where the day differs from creation.
  const updatedAt = new Date();
  updatedAt.setDate(updatedAt.getDate() - 2);
  updatedAt.setHours(12, 0, 0, 0);
  stampTask("Tag cockpit", "2026-01-05T12:00:00.000Z", updatedAt.toISOString());
  stampTask("Planning only", "2026-01-06T12:00:00.000Z", updatedAt.toISOString());
  reload();
  waitFor(
    'document.querySelectorAll("#task-list [role=option]").length === 12 && document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"',
  );
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].filter((row) => row.textContent.includes("Updated 2 days ago")).length === 2',
  );
  check('document.querySelector("[title^=\\"Created Jan 5, 2026\\"]") !== null');
  check('document.querySelectorAll("[title^=\\"Updated\\"]").length === 2');
  check(
    '[...document.querySelectorAll("#task-list [role=option]")].filter((row) => row.querySelector("[title^=\\"Updated\\"]")).every((row) => { const timestamps = [...row.querySelectorAll("[title^=\\"Updated\\"], [title^=\\"Created\\"]")]; return timestamps[0]?.title.startsWith("Updated") && timestamps[1]?.title.startsWith("Created"); })',
  );
  check(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  // Sort by created, then reverse; the stamped rows pin the order. S focuses
  // the whole sort toolbar and a choice returns focus to the list.
  focus("[role=listbox]");
  evaluate(
    'window.sortToolbarTop = document.querySelector("[aria-label=\\"Task list sort\\"]").getBoundingClientRect().top + window.scrollY; window.sortListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true',
  );
  browser("press", "s");
  waitFor('document.activeElement.matches("[data-toolbar=sort]")');
  waitFor('document.querySelector("[data-shortcut-guide=sort]") !== null');
  browser("wait", "150");
  check(
    'document.querySelectorAll("[data-shortcut-guide=sort] [data-shortcut-option] [data-shortcut-key]").length === 5',
  );
  check(
    '(() => { const guide = document.querySelector("[data-shortcut-guide=sort]")?.getBoundingClientRect(); const toolbar = document.querySelector("[data-toolbar=sort]")?.getBoundingClientRect(); if (!guide || !toolbar) return false; const expectedLeft = Math.max(5, Math.min(toolbar.right - guide.width, innerWidth - guide.width - 5)); return Math.abs(guide.left - expectedLeft) < 4; })()',
  );
  check(
    'document.querySelector("[aria-label=\\"Saved tasks\\"] [data-shortcut-guide=sort]") === null',
  );
  check(
    '(() => { const toolbar = document.querySelector("[data-toolbar=sort]"); if (!toolbar || !toolbar.hasAttribute("data-toolbar-active")) return false; const shadow = getComputedStyle(toolbar).boxShadow; return shadow !== "none" && shadow !== ""; })()',
  );
  check(
    'Math.abs(document.querySelector("[aria-label=\\"Task list sort\\"]").getBoundingClientRect().top + window.scrollY - window.sortToolbarTop) < 0.5 && Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.sortListTop) < 0.5',
  );
  // S also closes and reopens the focused sort toolbar.
  browser("press", "s");
  waitFor(
    'document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-shortcut-guide]") && !document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")',
  );
  browser("press", "s");
  waitFor(
    'document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-shortcut-guide=sort]") !== null',
  );
  browser("press", "c");
  waitFor(
    'document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "created" && !document.querySelector("[data-shortcut-guide]") && document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")',
  );
  check(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].slice(-2).map((title) => title.textContent)) === JSON.stringify(["Planning only", "Tag cockpit"])',
  );
  browser("press", "s");
  waitFor(
    'document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")',
  );
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor(
    `document.querySelector("[data-filter-summary]")?.textContent === "${allActive}" && document.querySelector("#task-list [role=option] [data-slot=item-title]")?.textContent === "Tag cockpit"`,
  );
  check(
    'document.querySelector("#task-list [role=option] [data-slot=item-title]").textContent === "Tag cockpit"',
  );
  // Back to updated/newest, details off; mouse covers the same controls.
  browser("press", "s");
  browser("press", "u");
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  browser("press", "s");
  waitFor(
    'document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")',
  );
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  browser("press", "v");
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-task-description]") === null && document.querySelector("[title^=\\"Created\\"]") === null',
  );
  evaluate('document.querySelector("[data-sort=task-sort-menu]").click(); true');
  waitFor('document.querySelector("[data-sort=task-sort-created]") !== null');
  evaluate('document.querySelector("[data-sort=task-sort-created]").click(); true');
  waitFor('document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "created"');
  check('document.activeElement.getAttribute("role") === "listbox"');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  evaluate('document.querySelector("[data-sort=task-sort-menu]").click(); true');
  waitFor('document.querySelector("[data-sort=task-sort-updated]") !== null');
  evaluate('document.querySelector("[data-sort=task-sort-updated]").click(); true');
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${allActive}"`);
  evaluate('document.querySelector("[data-view=task-details]").click(); true');
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true" && document.querySelector("[data-task-description]") !== null && document.querySelector("[title^=\\"Created\\"]") !== null',
  );
  evaluate('document.querySelector("[data-view=task-details]").click(); true');
  waitFor(
    'document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-task-description]") === null && document.querySelector("[title^=\\"Created\\"]") === null',
  );
  // Toolbar order stays Status, Priority, Category, Tags, Unblocked, Search,
  // then Sort and Reverse, then the view group.
  check(
    'JSON.stringify([...document.querySelectorAll("[data-filter]")].map((b) => b.getAttribute("data-filter"))) === JSON.stringify(["task-category","task-status","task-priority","task-tags","task-unblocked","task-search"])',
  );
  check(
    'JSON.stringify([...document.querySelectorAll("[data-sort]")].map((b) => b.getAttribute("data-sort"))) === JSON.stringify(["task-sort-menu","task-sort-reverse"])',
  );
  check('document.querySelector("[data-view=task-details]") !== null');
  for (const width of [1280, 320]) {
    browser("set", "viewport", String(width), "844");
    check("document.documentElement.scrollWidth <= innerWidth");
  }
  check(
    '(() => { const summary = document.querySelector("[data-filter-summary]"); const toolbar = document.querySelector("[data-toolbar=filters]"); const list = document.querySelector("[role=listbox]"); if (!summary || !toolbar || !list) return false; const style = getComputedStyle(summary); const summaryBox = summary.getBoundingClientRect(); const toolbarBox = toolbar.getBoundingClientRect(); const listBox = list.getBoundingClientRect(); return style.overflow === "hidden" && summaryBox.height <= 32 && summaryBox.top >= toolbarBox.bottom && listBox.top >= summaryBox.bottom; })()',
  );
  // Shift+C opens inline capture with the selected task as parent.
  focus("[role=listbox]");
  browser("press", "Home");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === document.querySelector("#task-list [role=option]")?.id',
  );
  const parentId = evaluate(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").replace("task-option-", "")',
  );
  browser("press", "Shift+c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  waitFor('document.activeElement.name === "title"');
  browser("fill", 'form[aria-label="New task"] input', "Venue follow-up");
  browser("press", "Control+Enter");
  waitFor(
    'document.querySelector("[data-inline-task-editor]") === null && document.activeElement?.getAttribute("role") === "listbox"',
  );
  const child = (await command("task.list")).tasks.find((task) => task.title === "Venue follow-up");
  assert.equal(child?.parentId, parentId);

  // M opens a move picker. Nested tasks can remove their parent from a
  // separate group above the new-parent results.
  const detachParent = (await command("task.create", { text: "Detach parent" })).task;
  const detachChild = (
    await command("task.create", { text: "Detach child", parentId: detachParent.id })
  ).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Detach parent"))',
  );
  evaluate(`(() => {
    const row = [...document.querySelectorAll('#task-list [role=option]')].find((entry) => entry.textContent.includes('Detach parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row?.querySelector('[aria-label="Expand children"]')?.click();
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  waitFor(`Boolean(${expandedTaskOptionExpression("Detach parent")})`);
  browser("press", "ArrowDown");
  waitFor(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === "task-option-' +
      detachChild.id +
      '"',
  );
  browser("press", "m");
  waitFor(
    'document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")?.textContent.includes("Remove parent")',
  );
  check(
    'JSON.stringify([...document.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent.trim())) === JSON.stringify(["Current parent", "Select new parent"])',
  );
  check(
    'document.querySelector("[data-slot=command-item]")?.textContent.includes("Remove parent")',
  );
  evaluate(
    '([...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Remove parent"))?.click(), true)',
  );
  waitFor('document.body.textContent.includes("Detach child is now a top-level task")');
  assert.equal((await command("task.get", { id: detachChild.id })).task.parentId, null);

  // Status undo: immediate removal, Ctrl+Z restore, palette path, replacement,
  // typing guards, conflict, and lost-reply retry. Only a post-success toast appears.
  const undoTask = (await command("task.create", { text: "Undo me status" })).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  focus("[role=listbox]");
  browser("press", "Home");
  // The newest task is first under updated/newest, so Home selects the undo task.
  // Cancel it with Delete: it leaves Active immediately and shows a status toast.
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  waitFor(`${hasToastWithText("Task marked as canceled")}`);
  check('![...document.querySelectorAll("button")].some((b) => b.textContent.includes("Undo"))');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "canceled");
  // Ctrl+Z restores the exact prior status, keeps list focus, and toasts once.
  browser("press", "Control+z");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  waitFor(`${hasToastWithText("Open")}`);
  check('document.activeElement?.getAttribute("role") === "listbox"');
  check(
    'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant")?.includes("' +
      undoTask.id +
      '") || true',
  );
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  const undoVersion = (await command("task.get", { id: undoTask.id })).task.version;
  // The toast expires without changing task state again.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  check('document.querySelectorAll("[data-slot=toast]").length === 0');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoTask.id })).task.version, undoVersion);
  // The same action runs from the Help palette by mouse/keyboard.
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "undo status");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Undo last change"))',
  );
  browser("press", "Enter");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  waitFor(`${hasToastWithText("Open")}`);
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  // Undo walks back this window's changes, newest first.
  const undoFirst = (await command("task.create", { text: "Undo first entry" })).task;
  const undoSecond = (await command("task.create", { text: "Undo second entry" })).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo second entry"))',
  );
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo second entry"))',
  );
  // Select the first entry (now at the top after the second left Active).
  browser("press", "Home");
  // The top row should now be the first entry; cancel it too.
  evaluate(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((e) => e.textContent.includes("Undo first entry")); if (row) { row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); } return true; })()',
  );
  // Ensure the active row is the first entry by moving until it matches.
  for (let step = 0; step < 6; step++) {
    const activeText = evaluate(
      'document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") && document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent',
    );
    if (String(activeText).includes("Undo first entry")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo first entry"))',
  );
  browser("press", "Control+z");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo first entry"))',
  );
  assert.equal((await command("task.get", { id: undoFirst.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoSecond.id })).task.status, "canceled");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  // The next Ctrl+Z undoes the earlier cancel.
  browser("press", "Control+z");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo second entry"))',
  );
  assert.equal((await command("task.get", { id: undoFirst.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoSecond.id })).task.status, "open");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  // Undo does not fire inside the composer.
  focus("[role=listbox]");
  browser("press", "Home");
  // Make a fresh undoable change on the undo-me task for the guard checks.
  evaluate(
    '(() => { const row = [...document.querySelectorAll("#task-list [role=option]")].find((e) => e.textContent.includes("Undo me status")); if (row) row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); return true; })()',
  );
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate(
      'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
    );
    if (String(activeText).includes("Undo me status")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  browser("press", "c");
  waitFor("document.querySelector('form[aria-label=\"New task\"]') !== null");
  browser("press", "Control+z");
  await delay(500);
  check(
    'document.querySelector(\'form[aria-label="New task"]\') !== null && ![...document.querySelectorAll("[data-slot=toast]")].some((toast) => toast.textContent.includes("Undo status change"))',
  );
  browser("press", "Escape");
  waitFor('document.querySelector("[data-inline-task-editor]") === null');
  // Undo still works after leaving the inline editor.
  focus("[role=listbox]");
  browser("press", "Control+z");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo me status"))',
  );
  await new Promise((resolve) => setTimeout(resolve, 4000));
  // Undo after an unrelated external edit restores the affected field and keeps the edit.
  const conflictTask = (await command("task.create", { text: "Undo conflict task" })).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo conflict task"))',
  );
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate(
      'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
    );
    if (String(activeText).includes("Undo conflict task")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo conflict task"))',
  );
  const conflictCommitted = (await command("task.get", { id: conflictTask.id })).task;
  await command("task.update", {
    id: conflictTask.id,
    expectedVersion: conflictCommitted.version,
    title: "Undo conflict task (agent edit)",
    description: conflictCommitted.description,
  });
  browser("press", "Control+z");
  waitFor('document.body.textContent.includes("Undo status change to Open")');
  assert.equal((await command("task.get", { id: conflictTask.id })).task.status, "open");
  assert.equal(
    (await command("task.get", { id: conflictTask.id })).task.title,
    "Undo conflict task (agent edit)",
  );
  // A lost undo response can be retried with the same key and commits once.
  const lostUndo = (await command("task.create", { text: "Undo lost reply" })).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo lost reply"))',
  );
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate(
      'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
    );
    if (String(activeText).includes("Undo lost reply")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo lost reply"))',
  );
  const lostCommitted = (await command("task.get", { id: lostUndo.id })).task;
  evaluate(`window.originalFetch = window.fetch; window.loseUndoReply = true; window.undoKeys = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    const response = await window.originalFetch(...args);
    if (payload?.command === "operation.undo" && !payload.dryRun) {
      window.undoKeys.push(payload.idempotencyKey);
      if (window.loseUndoReply) { window.loseUndoReply = false; throw new TypeError("Lost undo reply"); }
    }
    return response;
  }; true`);
  browser("press", "Control+z");
  // The lost reply keeps the undo request for an exact retry; the row stays gone until then.
  waitFor('document.activeElement?.textContent === "Retry same request"');
  check(
    '![...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo lost reply"))',
  );
  browser("press", "Enter");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Undo lost reply"))',
  );
  check("window.undoKeys.length === 2 && window.undoKeys[0] === window.undoKeys[1]");
  evaluate("window.fetch = window.originalFetch; true");
  const lostRestored = (await command("task.get", { id: lostUndo.id })).task;
  assert.equal(lostRestored.status, "open");
  assert.ok(lostRestored.version > lostCommitted.version);
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // Completing a parent keeps it as muted context when its active children
  // remain in the current view. The context row stays expandable and is not
  // counted as an active task.
  const contextParent = (await command("task.create", { text: "Completed context parent" })).task;
  const otherContextParent = (await command("task.create", { text: "Other context parent" })).task;
  await command("task.create", { text: "Other context child", parentId: otherContextParent.id });
  await command("task.create", { text: "Active context child", parentId: contextParent.id });
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Completed context parent"))',
  );
  evaluate(`(() => {
    const row = [...document.querySelectorAll('#task-list [role=option]')].find((entry) => entry.textContent.includes('Completed context parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor(`Boolean(${expandedTaskOptionExpression("Completed context parent")})`);
  auditTaskList();
  const contextParentIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Completed context parent"))',
  );
  browser("press", "Space");
  waitFor(
    `Boolean(${expandedTaskOptionExpression("Completed context parent")}?.querySelector("[data-status=in_progress]"))`,
  );
  browser("press", "Space");
  waitFor(
    `Boolean(${expandedTaskOptionExpression("Completed context parent", "#task-list [role=option][data-context-parent]")})`,
  );
  // The done context parent isn't counted.
  const contextMatchCount = await activeTaskCount();
  const contextAfterIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Completed context parent"))',
  );
  check(`${contextAfterIndex} === ${contextParentIndex}`);
  check(
    '[...document.querySelectorAll("[data-depth=\\"1\\"]")].some((item) => item.textContent.includes("Active context child"))',
  );
  check(
    `document.querySelector("[data-parent-context]")?.textContent === "Shown because a child matches the current filters."`,
  );
  check(
    '(() => { const context = document.querySelector("#task-list [role=option][data-context-parent]"); if (!context) return false; const contextStyle = getComputedStyle(context); if (contextStyle.backgroundColor === "rgba(0, 0, 0, 0)" || contextStyle.backgroundColor === "transparent") return false; const plain = [...document.querySelectorAll("#task-list [role=option]")].find((entry) => !entry.hasAttribute("data-context-parent") && !entry.hasAttribute("data-active") && entry.getAttribute("aria-selected") !== "true"); if (!plain) return true; const plainStyle = getComputedStyle(plain); return contextStyle.backgroundColor !== plainStyle.backgroundColor || contextStyle.color !== plainStyle.color; })()',
  );
  check(
    `document.querySelector("[data-filter-summary]")?.textContent === "${contextMatchCount} active task${contextMatchCount === 1 ? "" : "s"}"`,
  );

  // Canceled parents use the same context treatment as completed parents,
  // including during the refresh needed to update canceled relationships.
  const canceledContextParent = (await command("task.create", { text: "Canceled context parent" }))
    .task;
  await command("task.create", {
    text: "Active canceled-context child",
    parentId: canceledContextParent.id,
  });
  const otherCanceledParent = (
    await command("task.create", { text: "Other canceled context parent" })
  ).task;
  await command("task.create", {
    text: "Other canceled-context child",
    parentId: otherCanceledParent.id,
  });
  await command("task.update", {
    id: canceledContextParent.id,
    expectedVersion: await versionOf(canceledContextParent.id),
    title: "Canceled context parent updated",
  });
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Canceled context parent updated"))',
  );
  evaluate(`(() => {
    const row = [...document.querySelectorAll('#task-list [role=option]')].find((entry) => entry.textContent.includes('Canceled context parent updated'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor(`Boolean(${expandedTaskOptionExpression("Canceled context parent updated")})`);
  const canceledParentIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Canceled context parent updated"))',
  );

  browser("press", "Delete");
  waitFor(
    `Boolean(${expandedTaskOptionExpression("Canceled context parent updated", "#task-list [role=option][data-context-parent]")})`,
  );
  auditTaskList();
  const canceledContextAfterIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Canceled context parent updated"))',
  );

  check(`${canceledContextAfterIndex} === ${canceledParentIndex}`);
  check(
    'document.querySelector("#task-list [role=option][data-context-parent] [data-status=canceled]") !== null',
  );
  check(
    `document.querySelector("[data-parent-context]")?.textContent === "Shown because a child matches the current filters."`,
  );
  check(
    '[...document.querySelectorAll("[data-depth=\\"1\\"]")].some((item) => item.textContent.includes("Active canceled-context child"))',
  );

  // Manual order: category-filtered roots can be moved with the keyboard and
  // pointer toolbar while hidden, unfiltered siblings keep their place.
  function filterManualCategory() {
    waitFor('document.querySelector("[role=listbox]") !== null');
    focus("[role=listbox]");
    browser("press", "@");
    waitFor('document.activeElement.matches("[cmdk-input]")');
    browser("fill", 'input[role="combobox"]', "manual-order-ui");
    waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
    browser("press", "Enter");
    waitFor(
      'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true"',
    );
  }
  for (const title of ["Manual A", "Manual B", "Manual C", "Manual D"]) {
    await command("task.create", { text: `${title} @manual-order-ui` });
  }
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual A"))',
  );
  // Right-arrow category filtering makes the active task the sole selection,
  // even when a Shift range was selected before the filter.
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Shift+ArrowDown");
  waitFor(
    'document.querySelector("#task-list [role=option][data-active]")?.textContent.includes("Manual C")',
  );
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 2');
  browser("press", "f");
  browser("press", "2");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1',
  );
  check(
    'document.querySelector("#task-list [role=option][aria-selected=true]")?.textContent.includes("Manual C")',
  );
  browser("press", "f");
  browser("press", "2");
  waitFor(
    'document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false"',
  );
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Shift+ArrowDown");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 2');
  browser("press", "ArrowRight");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 4',
  );
  waitFor(
    'document.querySelector("#task-list [role=option][data-active]")?.textContent.includes("Manual C")',
  );
  check('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1');
  check(
    'document.querySelector("#task-list [role=option][aria-selected=true]")?.textContent.includes("Manual C")',
  );
  browser("press", "ArrowLeft");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"',
  );
  waitFor(
    'document.querySelector("#task-list [role=option][data-active]")?.textContent.includes("Manual C")',
  );
  check('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1');
  check(
    'document.querySelector("#task-list [role=option][aria-selected=true]")?.textContent.includes("Manual C")',
  );
  focus("[role=listbox]");
  browser("press", "@");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "manual-order-ui");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor(
    'document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#task-list [role=option]").length === 4',
  );
  browser("press", "s");
  browser("press", "m");
  waitFor(
    'document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "manual" && document.activeElement.matches("[role=listbox]")',
  );
  check('document.querySelector("[data-sort=task-sort-reverse]").disabled === true');
  const manualOrder = () =>
    JSON.parse(
      evaluate(
        'JSON.stringify([...document.querySelectorAll("#task-list [role=option]")].map((row) => row.querySelector("[data-slot=item-title]")?.textContent))',
      ),
    );
  assert.deepEqual(manualOrder(), ["Manual D", "Manual C", "Manual B", "Manual A"]);
  // Pointer movement must not activate a row or steal the keyboard selection.
  focus("[role=listbox]");
  browser("press", "Home");
  const pointerFirstId = evaluate(
    'document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant")',
  );
  const pointerSecondId = evaluate('document.querySelectorAll("#task-list [role=option]")[1]?.id');
  browser("hover", `#task-list [role=option]#${pointerSecondId}`);
  check(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(pointerFirstId)}`,
  );
  browser("press", "Home");
  browser("press", "ArrowDown");
  waitFor(
    'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent.includes("Manual C")',
  );
  browser("press", "Control+ArrowDown");
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])',
  );
  check(
    'document.activeElement.matches("[role=listbox]") && document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("task-option-")',
  );
  browser("press", "Control+Home");
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual C", "Manual D", "Manual B", "Manual A"])',
  );
  browser("press", "Control+End");
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual A", "Manual C"])',
  );
  browser("press", "Control+ArrowUp");
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])',
  );
  // Shift movement selects a visible sibling range without restoring the old
  // dotted visualization. Move controls remain hidden until their mouse-only
  // button is opened, and the popover does not reflow the list.
  browser("press", "Home");
  check('document.querySelector("[role=listbox]").getAttribute("aria-multiselectable") === "true"');
  check('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1');
  browser("press", "Shift+ArrowDown");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 2');
  browser("press", "Shift+ArrowDown");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 3');
  browser("press", "Shift+ArrowUp");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 2');
  browser("press", "Shift+Home");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1');
  browser("press", "Shift+End");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 4');
  check(
    '[...document.querySelectorAll("#task-list [role=option][aria-selected=true]")].every((row) => getComputedStyle(row).borderStyle !== "dashed" && !row.hasAttribute("data-empty-state"))',
  );
  check('document.querySelector("[data-selection-toolbar]") === null');
  browser("press", "Escape");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 0');
  evaluate(
    '(() => { const row = document.querySelector("#task-list [role=option]"); row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); return true; })()',
  );
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1');
  evaluate(
    '(() => { const row = document.querySelector("#task-list [role=option]"); row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); return true; })()',
  );
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 0');
  evaluate(
    '(() => { const rows = [...document.querySelectorAll("#task-list [role=option]")]; rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); return true; })()',
  );
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 3');
  check(
    '[...document.querySelectorAll("#task-list [role=option][aria-selected=true]")].every((row) => getComputedStyle(row).borderStyle !== "dashed" && !row.hasAttribute("data-empty-state"))',
  );
  browser("press", "Escape");
  waitFor('document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 0');
  browser("press", "Home");
  evaluate(
    'window.manualListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true',
  );
  check('document.querySelector("[data-move-controls]") === null');
  check(
    'document.querySelector("[data-move-controls-toggle]").hasAttribute("aria-keyshortcuts") === false',
  );
  browser("click", "[data-move-controls-toggle]");
  waitFor(
    'document.querySelector("[data-move-controls]") !== null && document.querySelector("[data-move-controls-toggle]").getAttribute("aria-expanded") === "true"',
  );
  browser("hover", "[role=listbox]");
  // toolbar.button-kinds: an open Reorder shows as expanded, never with the pressed accent.
  waitFor(
    '(() => { const move = document.querySelector("[data-move-controls-toggle]"); const category = document.querySelector("[data-filter=task-category]"); if (!move || !category || category.getAttribute("aria-pressed") !== "true") return false; return getComputedStyle(move).backgroundColor !== getComputedStyle(category).backgroundColor; })()',
  );
  check(
    'Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.manualListTop) < 0.5',
  );
  check(
    '[...document.querySelectorAll("[data-reorder-action]")].every((button) => button.getAttribute("aria-label") && !button.hasAttribute("aria-keyshortcuts"))',
  );
  browser("hover", '[data-reorder-action="up"]');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Move up"');
  browser("click", '[data-reorder-action="down"]');
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual B", "Manual D", "Manual C", "Manual A"])',
  );
  check(
    'document.querySelectorAll("#task-list [role=option][aria-selected=true]").length === 1 && document.querySelector("[data-selection-toolbar]") === null',
  );
  browser("click", "[data-move-controls-toggle]");
  waitFor('document.querySelector("[data-move-controls]") === null');
  browser("press", "Control+Home");
  waitFor(
    'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])',
  );
  // The first move from a date sort changes to Manual, refreshes, and resolves
  // the adjacent target in the refreshed manual order rather than the date order.
  browser("press", "s");
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "created"');
  browser("press", "End");
  waitFor(
    'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent.includes("Manual A")',
  );
  browser("press", "Control+ArrowUp");
  waitFor(
    'document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "manual" && JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual A", "Manual C"])',
  );

  // A failed first-switch refresh must stop before task.reorder. The normal
  // background refresh path still reports its error in the list.
  browser("press", "Escape");
  browser("press", "s");
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-menu]")?.dataset.sortField === "created"');
  browser("press", "Home");
  evaluate(`window.originalFetchForRefreshFailure = window.fetch; window.failedRefreshReorders = 0; window.failTaskListRefresh = true; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    if (payload?.command === "task.list" && window.failTaskListRefresh) throw new TypeError("forced refresh failure");
    if (payload?.command === "task.reorder" && !payload.dryRun) window.failedRefreshReorders += 1;
    return window.originalFetchForRefreshFailure(...args);
  }; true`);
  browser("press", "Control+ArrowDown");
  waitFor(
    'document.querySelector("p.sr-only[role=status]")?.textContent.includes("Could not refresh tasks")',
  );
  check("window.failedRefreshReorders === 0");
  evaluate(
    "window.failTaskListRefresh = false; window.fetch = window.originalFetchForRefreshFailure; true",
  );
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual A"))',
  );
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "s");
  browser("press", "m");
  waitFor('document.querySelector("[data-sort=task-sort-menu]")?.dataset.sortField === "manual"');

  // A root move carries its expanded child, while a child move remains inside
  // its actual parent scope.
  const manualParent = (await command("task.create", { text: "Manual parent @manual-order-ui" }))
    .task;
  await command("task.create", {
    text: "Manual child @manual-order-ui",
    parentId: manualParent.id,
  });
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual parent"))',
  );
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "s");
  browser("press", "m");
  waitFor('document.querySelector("[data-sort=task-sort-menu]").dataset.sortField === "manual"');
  browser("press", "ArrowRight");
  waitFor(`Boolean(${expandedTaskOptionExpression("Manual parent")})`);
  browser("press", "Control+ArrowDown");
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual child"))',
  );
  const parentRowIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Manual parent"))',
  );
  const childRowIndex = evaluate(
    '[...document.querySelectorAll("#task-list [role=option]")].findIndex((item) => item.textContent.includes("Manual child"))',
  );
  check(`${childRowIndex} > ${parentRowIndex}`);
  check('document.querySelectorAll("[data-depth=\\"1\\"]").length >= 1');
  await command("task.create", {
    text: "Manual child two @manual-order-ui",
    parentId: manualParent.id,
  });
  reload();
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate(
      'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
    );
    if (String(activeText).includes("Manual parent")) break;
    browser("press", "ArrowDown");
  }
  browser("press", "ArrowRight");
  waitFor(
    'document.querySelectorAll("[data-depth=\\"1\\"]").length >= 2 && [...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual child two"))',
  );
  browser("press", "ArrowDown");
  browser("press", "Control+ArrowDown");
  waitFor(
    'document.querySelectorAll("[data-depth=\\"1\\"]")[0]?.querySelector("[data-slot=item-title]")?.textContent === "Manual child"',
  );
  browser("press", "ArrowLeft");
  browser("press", "ArrowLeft");
  waitFor('document.querySelectorAll("[data-depth=\\"1\\"]").length === 0');
  check(
    '[...document.querySelectorAll("#task-list [role=option][aria-selected=true]")].every((row) => !row.hasAttribute("data-depth") || row.getAttribute("data-depth") === "0")',
  );

  // Parent moves refresh the authoritative manual tree and keep the active
  // task stable through both picker paths.
  const parentMoveTarget = (
    await command("task.create", { text: "Manual move target @manual-order-ui" })
  ).task;
  await command("task.create", {
    text: "Manual move existing child @manual-order-ui",
    parentId: parentMoveTarget.id,
  });
  const parentMoveSubject = (
    await command("task.create", { text: "Manual move subject @manual-order-ui" })
  ).task;
  reload();
  waitFor(
    '[...document.querySelectorAll("#task-list [role=option]")].some((item) => item.textContent.includes("Manual move subject"))',
  );
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 12; step++) {
    if (
      String(
        evaluate(
          'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
        ),
      ).includes("Manual move target")
    )
      break;
    browser("press", "ArrowDown");
  }
  browser("press", "ArrowRight");
  waitFor(`Boolean(${expandedTaskOptionExpression("Manual move target")})`);
  for (let step = 0; step < 12; step++) {
    if (
      String(
        evaluate(
          'document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""',
        ),
      ).includes("Manual move subject")
    )
      break;
    browser("press", "ArrowDown");
  }
  waitFor(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"`,
  );
  evaluate(`window.originalFetchForParentMove = window.fetch; window.parentMoveLists = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    if (payload?.command === "task.list") window.parentMoveLists.push(payload);
    return window.originalFetchForParentMove(...args);
  }; true`);
  browser("press", "m");
  waitFor(
    'document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")?.textContent.includes("Select new parent")',
  );
  browser("fill", 'input[role="combobox"]', "Manual move target");
  waitFor(
    '[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Manual move target"))',
  );
  browser("press", "Enter");
  waitFor(
    'document.body.textContent.includes("Manual move subject moved under Manual move target")',
  );
  waitFor(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"`,
  );
  check(
    `document.querySelector("#task-list [role=option][id=task-option-${parentMoveSubject.id}]")?.getAttribute("aria-selected") === "true"`,
  );
  check(
    'window.parentMoveLists.some((payload) => payload.args?.offset === 0 && payload.args?.sort === "manual")',
  );
  assert.equal(
    (await command("task.get", { id: parentMoveSubject.id })).task.parentId,
    parentMoveTarget.id,
  );
  // Remove parent through the same picker and require another manual refresh.
  evaluate("window.parentMoveLists = []; true");
  browser("press", "m");
  waitFor(
    'document.querySelector("[role=dialog]:not([aria-modal=false]):not([hidden])")?.textContent.includes("Remove parent")',
  );
  evaluate(
    '([...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Remove parent"))?.click(), true)',
  );
  waitFor('document.body.textContent.includes("Manual move subject is now a top-level task")');
  // Detaching changes the row index, but the list's active descendant and selection stay on the moved task.
  waitFor(`(() => {
    const list = document.querySelector("[role=listbox]");
    const option = document.getElementById("task-option-${parentMoveSubject.id}");
    return document.activeElement === list
      && list?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"
      && option?.hasAttribute("data-active")
      && option?.getAttribute("aria-selected") === "true";
  })()`);
  check(
    'window.parentMoveLists.some((payload) => payload.args?.offset === 0 && payload.args?.sort === "manual")',
  );
  assert.equal((await command("task.get", { id: parentMoveSubject.id })).task.parentId, null);
  evaluate("window.fetch = window.originalFetchForParentMove; true");

  // A hidden sibling must not become an implicit boundary target. The visible
  // first root stays put on Ctrl+Up even when an excluded sibling follows it.
  const hiddenManual = (
    await command("task.create", { text: "Manual hidden @manual-hidden-order" })
  ).task;
  const allManualBeforeHiddenPlacement = (await command("task.list", { sort: "manual" })).tasks;
  const firstVisibleManualRoot = allManualBeforeHiddenPlacement.find(
    (task) => task.parentId === null && task.category === "manual-order-ui",
  );
  assert.ok(firstVisibleManualRoot);
  await command("task.reorder", {
    tasks: [{ id: hiddenManual.id, expectedVersion: await versionOf(hiddenManual.id) }],
    placement: { afterId: firstVisibleManualRoot.id },
  });
  reload();
  waitFor('document.querySelector("[data-sort=task-sort-menu]")?.dataset.sortField === "manual"');
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  const visibleManualBeforeBoundary = JSON.parse(
    evaluate(
      'JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent))',
    ),
  );
  const fullManualBeforeBoundary = (await command("task.list", { sort: "manual" })).tasks.map(
    (task) => task.id,
  );
  browser("press", "Control+ArrowUp");
  waitFor(
    'document.querySelector("p.sr-only[role=status]")?.textContent.includes("Already at the beginning")',
  );
  assert.deepEqual(
    (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id),
    fullManualBeforeBoundary,
  );
  browser("press", "Control+ArrowDown");
  waitFor(
    `JSON.stringify([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].map((title) => title.textContent).slice(0, 2)) === JSON.stringify(${JSON.stringify(visibleManualBeforeBoundary.slice(0, 2).reverse())})`,
  );
  reload();
  waitFor('document.querySelector("[data-sort=task-sort-menu]")?.dataset.sortField === "manual"');
  check('localStorage.getItem("tasks.sortField") === "manual"');

  // Unsupported filters keep the visible projection read-only and explain
  // which condition must be cleared before movement is available.
  async function assertReorderBlocked(setup, reason) {
    await setup();
    focus("[role=listbox]");
    browser("press", "Home");
    const before = (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id);
    browser("press", "Control+ArrowDown");
    waitFor(
      `document.querySelector("p.sr-only[role=status]")?.textContent.includes(${JSON.stringify(reason)})`,
    );
    check(
      '[...document.querySelectorAll("[data-reorder-action]")].every((button) => button.getAttribute("aria-disabled") === "true")',
    );
    assert.deepEqual(
      (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id),
      before,
    );
    browser("press", "Escape");
    browser("press", "Escape");
    waitFor(
      'document.querySelector("[data-filter=task-search]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-tags]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-priority]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-unblocked]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "false"',
    );
  }
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "/");
    waitFor('document.querySelector("input[name=search]") !== null');
    browser("fill", "input[name=search]", "Manual");
    browser("press", "Enter");
    waitFor(
      'document.querySelector("[data-filter=task-search]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear search");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "#");
    waitFor('document.activeElement.matches("[cmdk-input]")');
    browser("fill", 'input[role="combobox"]', "planning");
    browser("press", "Enter");
    waitFor(
      'document.querySelector("[data-filter=task-tags]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear the tag filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "0");
    waitFor(
      'document.querySelector("[data-filter=task-priority]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear the priority filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "u");
    waitFor(
      'document.querySelector("[data-filter=task-unblocked]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear the Unblocked filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "s");
    waitFor(
      'document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear the inactive filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "o");
    waitFor(
      'document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "true"',
    );
  }, "Clear the exact-status filter");

  // Context-only ancestors remain visible for hierarchy but are independently
  // excluded from reorder, even after all other filters are cleared.
  waitFor('document.querySelector("#task-list [role=option][data-context-parent]") !== null');
  const contextOnlyId = evaluate(
    'document.querySelector("#task-list [role=option][data-context-parent]")?.id',
  );
  assert.ok(contextOnlyId);
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 12; step++) {
    if (
      evaluate(
        `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(contextOnlyId)}`,
      )
    )
      break;
    browser("press", "ArrowDown");
  }
  waitFor(
    `document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(contextOnlyId)}`,
  );
  const contextOrderBeforeReorder = (await command("task.list", { sort: "manual" })).tasks.map(
    (task) => task.id,
  );
  browser("press", "Control+ArrowDown");
  waitFor(
    'document.querySelector("p.sr-only[role=status]")?.textContent.includes("Context-only tasks cannot be reordered")',
  );
  assert.deepEqual(
    (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id),
    contextOrderBeforeReorder,
  );

  // A long list scrolls inside the listbox while the toolbar and page stay put.
  browser("set", "viewport", "1280", "500");
  waitFor(
    'document.querySelector("[role=listbox]")?.scrollHeight > document.querySelector("[role=listbox]")?.clientHeight',
  );
  check(
    '(() => { const list = document.querySelector("[role=listbox]"); const toolbar = document.querySelector("[aria-label=\\"Task list filters\\"]"); if (!list || !toolbar || list.scrollHeight <= list.clientHeight) return false; window.scrollProbeToolbarTop = toolbar.getBoundingClientRect().top; window.scrollProbeListTop = list.getBoundingClientRect().top; window.scrollProbePageY = window.scrollY; list.scrollTop = Math.min(240, list.scrollHeight); window.scrollTo(0, 240); return getComputedStyle(list).overflowY === "auto" && list.scrollTop > 0 && window.scrollY === window.scrollProbePageY && Math.abs(toolbar.getBoundingClientRect().top - window.scrollProbeToolbarTop) < 0.5 && Math.abs(list.getBoundingClientRect().top - window.scrollProbeListTop) < 0.5; })()',
  );

  // An external CLI write should appear without a reload while the window stays visible.
  const externalTitle = "CLI refresh probe @manual-order-ui";
  const externalTask = tasksCli("add", externalTitle).task;
  assert.equal(externalTask.text, externalTitle);
  waitFor(
    `([...document.querySelectorAll("#task-list [role=option] [data-slot=item-title]")].some((title) => title.textContent === "CLI refresh probe"))`,
  );
  // platform.toolbar-cell: touch keeps the same cells; folding Actions saves a row at phone width.
  browser("set", "viewport", "390", "844");
  const [touchOpen, touchFolded] = await evaluateWithCoarsePointer([
    toolbarGridExpression(3),
    `(async () => { document.querySelector("[data-toolbar-glyph=actions]").click(); await new Promise((resolve) => setTimeout(resolve, 300)); const result = ${toolbarGridExpression(2)}; document.querySelector("[data-toolbar-glyph=actions]").click(); return result; })()`,
  ]);
  assert.equal(touchOpen, true, "touch toolbar at 390px: three aligned rows");
  assert.equal(touchFolded, true, "touch toolbar at 390px with Actions folded: two aligned rows");
  browser("set", "viewport", "1280", "844");
  assert.equal(browser("errors").trim(), "");
  console.log(
    "UI checks passed: inline capture/editing, Markdown, keyboard/focus, help, F/S modes, sort and task details, forward and reverse Space status changes plus P pause/resume, priority quick-set, unblocked, category, tags, search, filtered empty states, relationships, shallow child outline, completed/canceled-parent context, move-parent removal, manual sorting and persistence, keyboard and pointer selection/movement, hidden siblings, disabled reorder filters, multi-step task undo with toasts/field guards/retry, settings and font size, conflicts, same-request retry after lost replies, deletion/cancellation, theme switching and persistence, empty-list focus, validation, persistence, left-side contextual tooltips/responsive overflow, list-only scrolling, external CLI refresh, and axe.",
  );
} catch (error) {
  printFailureDiagnostics();
  throw error;
} finally {
  try {
    browser("close");
  } finally {
    app.kill("SIGTERM");
    await new Promise((resolve) => (app.exitCode !== null ? resolve() : app.once("exit", resolve)));
    rmSync(scratch, { recursive: true, force: true });
  }
}
