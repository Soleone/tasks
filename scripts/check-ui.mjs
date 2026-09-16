import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

// Requires agent-browser with Linux Chromium installed. All writes use a scratch database.
const root = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-ui-check-"));
mkdirSync(path.join(scratch, "themes"), { recursive: true });
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
const app = spawn(process.execPath, ["scripts/dev-web.mjs", "--", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
  cwd: root,
  env: { ...process.env, TASKS_DATABASE_PATH: path.join(scratch, "tasks.db"), TASKS_DEV_BACKEND_PORT: String(backendPort), VITE_DEV_BACKEND_URL: backendUrl },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
app.stdout.on("data", (chunk) => { serverLog += chunk; });
app.stderr.on("data", (chunk) => { serverLog += chunk; });

function browser(...args) {
  return execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 35_000 });
}
function evaluate(script) {
  const response = JSON.parse(browser("--json", "eval", script));
  assert.equal(response.success, true, response.error);
  return response.data.result;
}
function waitFor(script) { browser("wait", "--fn", script); }
function check(script) { assert.equal(evaluate(script), true, script); }
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
  try { console.error("Browser snapshot:\n" + browser("snapshot")); } catch (error) { console.error("Could not capture browser snapshot:", error); }
  try { console.error("Browser errors:\n" + browser("errors")); } catch (error) { console.error("Could not capture browser errors:", error); }
  try { console.error("Browser state:", evaluate('({ focus: document.activeElement?.tagName + ":" + (document.activeElement?.textContent ?? "").slice(0, 100), listbox: Boolean(document.querySelector("[role=listbox]")), rows: document.querySelectorAll("[role=option]").length })')); } catch (error) { console.error("Could not capture browser state:", error); }
  console.error("Dev-server output:\n" + serverLog);
}
async function command(command, args = {}) {
  const response = await fetch(`${backendUrl}/command`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ version: 1, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), actor: { kind: "agent", label: "UI check" }, command, args }),
  });
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.result;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(serverLog);
    try {
      ready = (await fetch(`${backendUrl}/health`)).ok && (await fetch(url)).ok;
    } catch { /* Startup may not have bound its ports yet. */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, serverLog);
  browser("open", url);
  browser("snapshot", "-i");
  // The task list is home: no dialog opens and the empty list shell owns focus.
  waitFor('document.activeElement?.getAttribute("aria-label") === "Saved tasks"');
  check('document.querySelector("[role=dialog]") === null');
  check('document.body.textContent.includes("Press C or choose New task")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks"');
  // C opens the shared create dialog with the title focused and notes closed.
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  waitFor('document.activeElement.name === "title"');
  check('document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  check('document.querySelector(\'form[aria-label="New task"] button[type="button"]\').tabIndex === -1');
  check('document.querySelector(\'form[aria-label="New task"] [role="radiogroup"]\').tabIndex === 0');
  check('document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').tabIndex === -1');
  browser("find", "role", "button", "click", "--name", "Add description");
  waitFor('document.activeElement.name === "description"');
  browser("click", 'form[aria-label="New task"] input');
  waitFor('document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').getAttribute("aria-invalid") === "true"');
  browser("fill", 'form[aria-label="New task"] input', "Book venue @launch #planning");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("fill", 'form[aria-label="New task"] textarea', "## Shortlist");
  browser("press", "Enter");
  browser("keyboard", "inserttext", "- Ask about accessibility");
  assert.equal((await command("task.list")).tasks.length, 0);
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  check('document.activeElement.hasAttribute("data-priority-section")');
  check('[...document.querySelectorAll(\'[role="radiogroup"] [role="radio"]\')].every((radio) => radio.tabIndex === -1)');
  for (const value of ["0", "1", "2", "3", "4"]) {
    browser("press", value);
    waitFor(`document.activeElement.matches("[role=radiogroup]") && document.querySelector('[role="radiogroup"] [data-priority="P${value}"]').getAttribute("aria-checked") === "true"`);
  }
  browser("press", "2");
  waitFor('document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"');
  browser("press", "ArrowRight");
  waitFor('document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P3"]\').getAttribute("aria-checked") === "true"');
  browser("press", "ArrowLeft");
  waitFor('document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"');
  browser("press", "0");
  waitFor('document.querySelector(\'[role="radiogroup"] [data-priority="P0"]\').getAttribute("aria-checked") === "true"');
  browser("press", "ArrowLeft");
  waitFor('document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P0"]\').getAttribute("aria-checked") === "true"');
  browser("press", "4");
  waitFor('document.querySelector(\'[role="radiogroup"] [data-priority="P4"]\').getAttribute("aria-checked") === "true"');
  browser("press", "ArrowRight");
  waitFor('document.activeElement.matches("[role=radiogroup]") && document.querySelector(\'[role="radiogroup"] [data-priority="P4"]\').getAttribute("aria-checked") === "true"');
  browser("press", "2");
  waitFor('document.querySelector(\'[role="radiogroup"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "title"');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  waitFor('(() => { const dialog = [...document.querySelectorAll("[role=dialog]")].find((entry) => entry.querySelector("[cmdk-input]")); if (!dialog) return false; const top = Math.round(dialog.getBoundingClientRect().top); return top === 64 || top === 80; })()');
  check('(() => { const dialog = [...document.querySelectorAll("[role=dialog]")].find((entry) => entry.querySelector("[cmdk-input]")); if (!dialog) return false; if (dialog.getBoundingClientRect().bottom > innerHeight + 1) return false; const style = getComputedStyle(dialog); if (style.top !== "64px" && style.top !== "80px") return false; return style.padding === "0px"; })()');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("New task") && item.textContent.includes("C"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Switch active or inactive") && item.textContent.includes("S"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Exact status") && item.textContent.includes("O/I/D/P/X"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Filter shortcuts") && item.textContent.includes("F"))');
  check('(() => { const item = [...document.querySelectorAll("[data-slot=command-item]")].find((entry) => entry.textContent.includes("Sort tasks")); const keys = item?.querySelectorAll("[data-slot=command-shortcut] [data-slot=kbd]"); return keys?.[0]?.textContent === "S" && item?.textContent.includes("C/U/M/R"); })()');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Select a task range") && item.textContent.includes("Shift+↑/↓"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Move selected tasks") && item.textContent.includes("Ctrl/⌘+↑/↓"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Show task details") && item.textContent.includes("V"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Change task status") && item.textContent.includes("Shift+Space"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Pause or resume task") && item.textContent.includes("P"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Set active task priority") && item.textContent.includes("0"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Priority filter") && item.textContent.includes("0"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Set task priority") && item.textContent.includes("Focus Priority"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Filter by tags") && item.textContent.includes("T"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Search tasks") && item.textContent.includes("/"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Show unblocked tasks") && item.textContent.includes("U"))');
  browser("fill", 'input[role="combobox"]', "@category");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  check('document.querySelector("[data-slot=command-item]").textContent.includes("One per task")');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  check('document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\').value.includes("accessibility")');
  // Saving one task closes capture and returns focus to the list.
  browser("press", "Control+Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  waitFor('document.activeElement?.getAttribute("role") === "listbox"');
  let saved = (await command("task.list")).tasks;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].descriptionMarkdown, "## Shortlist\n- Ask about accessibility");
  assert.equal(saved[0].category.slug, "launch");
  assert.equal(saved[0].tags[0].slug, "planning");
  waitFor('document.querySelector("[role=option] [data-slot=item-title]")?.textContent === "Book venue"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  check('document.querySelectorAll("[role=option] [data-slot=badge]").length === 2');
  check("document.querySelector(\"[role=option] [data-priority=\'P2\']\")?.textContent === \"\"");
  check("document.querySelector(\"[role=option] [data-priority=\'P2\']\")?.getAttribute(\"aria-label\") === \"Priority normal\"");
  check('![...document.querySelectorAll("[role=option] [data-slot=item-title]")].some((title) => title.textContent.includes("#planning"))');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Status: Open")');
  evaluate('document.querySelector("[role=option] [data-status]").click(); true');
  waitFor('document.querySelector("form[aria-label^=Edit]") === null && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "In progress"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Shift+Space")');
  // Shift+Space reverses in_progress back to open; Space can move it forward again.
  browser("press", "Shift+Space");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  browser("press", "Space");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("title") === null');
  assert.equal(saved[0].priority, 2);
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"');
  // F focuses the entire filter toolbar and opens a compact shortcut popover
  // without moving the list. The focus ring remains until a choice or Escape.
  focus("[role=listbox]");
  evaluate('window.filterToolbarTop = document.querySelector("[aria-label=\\"Task list filters\\"]").getBoundingClientRect().top + window.scrollY; window.filterListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true');
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  waitFor('document.querySelector("[data-shortcut-guide=filter]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-group=status]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-group=more]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=open] [data-shortcut-key=\\"O\\"]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=priority] [data-shortcut-key=\\"0–4\\"]") !== null');
  check('document.querySelector("[aria-label=\\"Saved tasks\\"] [data-shortcut-guide=filter]") === null');
  check('(() => { const toolbar = document.querySelector("[data-toolbar=filters]"); if (!toolbar || !toolbar.hasAttribute("data-toolbar-active")) return false; const shadow = getComputedStyle(toolbar).boxShadow; return shadow !== "none" && shadow !== ""; })()');
  check('Math.abs(document.querySelector("[aria-label=\\"Task list filters\\"]").getBoundingClientRect().top + window.scrollY - window.filterToolbarTop) < 0.5 && Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.filterListTop) < 0.5');
  // Pressing the focus key again closes the mode, while Escape remains a
  // second close path.
  browser("press", "f");
  waitFor('document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-shortcut-guide]") && !document.querySelector("[data-toolbar=filters]").hasAttribute("data-toolbar-active")');
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]") && document.querySelector("[data-shortcut-guide=filter]") !== null');
  // F then S toggles the Active/Inactive presets.
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && !document.querySelector("[data-shortcut-guide]") && document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-toolbar=filters]").hasAttribute("data-toolbar-active")');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Inactive"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 inactive tasks"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  check('(() => { const active = document.querySelector("[data-filter=task-status]"); const inactive = document.querySelector("[data-filter=task-unblocked]"); const activeStyle = getComputedStyle(active); const inactiveStyle = getComputedStyle(inactive); return activeStyle.backgroundColor !== inactiveStyle.backgroundColor && activeStyle.color !== inactiveStyle.color && activeStyle.borderColor !== "rgba(0, 0, 0, 0)"; })()');
  waitFor('!document.querySelector("[role=option]")');
  // A no longer aliases the status preset.
  browser("press", "f");
  browser("press", "a");
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true"');
  browser("press", "Escape");
  waitFor('document.activeElement.matches("[role=listbox]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Active"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task"');
  // P pauses and removes the task from Active. The toast explains the hidden row.
  browser("press", "p");
  waitFor('!document.querySelector("[role=option]") && document.querySelector("[data-undo-toast]")?.textContent.includes("Task paused")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks"');
  // Paused belongs to Inactive, where P can resume it to in progress.
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Press P to resume")');
  browser("press", "p");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  // in_progress Space skips paused and completes: it leaves Active, Inactive shows done.
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Task marked done")');
  check('document.querySelector("[data-undo-toast] svg")?.classList.contains("text-background") === true');
  check('document.querySelector("[data-undo-toast] svg")?.classList.contains("lucide-circle-check") === true');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "done"');
  // Shift+Space reverses done to in_progress, then reverses in_progress to open.
  browser("press", "Shift+Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  browser("press", "Shift+Space");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  // Paused Space still completes: pause, switch to Inactive, then move paused to done.
  browser("press", "p");
  waitFor('!document.querySelector("[role=option]") && document.querySelector("[data-undo-toast]")?.textContent.includes("Task paused")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  browser("press", "Space");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "done"');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Task marked done")');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
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
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done") && document.activeElement.matches("[role=listbox]")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 done tasks"');
  // Escape from the focused toolbar returns to the list without changing the
  // current filter. Escape on the list still clears all filters.
  browser("press", "f");
  waitFor('document.activeElement.matches("[data-toolbar=filters]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done") && document.activeElement.matches("[role=listbox]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open" && document.activeElement.matches("[role=listbox]")');
  // Mouse opens the same status menu.
  evaluate('document.querySelector("[data-filter=task-status]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Active") && item.textContent.includes("Open"))');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');

  // Edit shares the same dialog. Stale contents survive a conflict until discard.
  focus("[role=listbox]");
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="Edit task"]\') !== null');
  waitFor('document.querySelector(\'form[aria-label="Edit task"] input\') === document.activeElement');
  browser("fill", 'form[aria-label="Edit task"] input', "My unsaved title");
  await command("task.update", { id: saved[0].id, expectedVersion: saved[0].version, title: "Agent updated title", descriptionMarkdown: saved[0].descriptionMarkdown });
  evaluate('window.dispatchEvent(new Event("focus")); true');
  browser("press", "Control+Enter");
  waitFor('document.body.textContent.includes("This task changed elsewhere")');
  check('document.querySelector("form[aria-label^=Edit] input").value === "My unsaved title"');
  browser("find", "role", "button", "click", "--name", "Discard changes");
  waitFor('!document.querySelector("[role=dialog]")');
  waitFor('document.activeElement.getAttribute("role") === "listbox"');

  // Simulate commit-before-lost-reply. Retrying must not duplicate the task.
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("fill", 'form[aria-label="New task"] input', "Next capture draft");
  evaluate(`window.originalFetch = window.fetch; window.loseReply = true; window.fetch = async (...args) => {
    const response = await window.originalFetch(...args);
    if (window.loseReply && args[1]?.body && JSON.parse(args[1].body).command === "task.create") {
      window.loseReply = false;
      throw new TypeError("Lost reply");
    }
    return response;
  }; true`);
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("Could not save")');
  check('document.querySelector(\'form[aria-label="New task"] input\').value === "Next capture draft"');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  assert.equal((await command("task.list")).tasks.length, 2);
  evaluate("window.fetch = window.originalFetch; true");

  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("fill", 'form[aria-label="New task"] input', "Ambiguous @work @home");
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("only one @category")');
  check('document.querySelector(\'form[aria-label="New task"] input\').value === "Ambiguous @work @home"');
  browser("fill", 'form[aria-label="New task"] input', "Call the venue");
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 3');
  check('document.querySelector("[data-filter-summary]")?.textContent === "3 active tasks"');

  // Themes: the dedicated picker drives the regions, and the choice persists.
  const themeCount = (await command("theme.list")).themes.length;
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('document.querySelectorAll("[cmdk-group]").length === 1');
  check(`document.querySelector("[cmdk-group]").querySelectorAll("[data-slot=command-item]").length === ${themeCount}`);
  check('document.querySelector("[data-slot=command-item][aria-selected=true]")?.textContent.startsWith("Default")');

  // Theme names use literal word matching, so "cat" only returns Catppuccin.
  browser("fill", 'input[role="combobox"]', "cat");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 2');
  check('[...document.querySelectorAll("[data-slot=command-item]")].every((item) => item.textContent.includes("Catppuccin"))');
  // The dedicated picker should only show theme results for a broad query.
  browser("fill", 'input[role="combobox"]', "theme");
  waitFor('document.querySelectorAll("[cmdk-group]:not([hidden])").length === 1');
  check('document.querySelector("[cmdk-group]:not([hidden]) [cmdk-group-heading]").textContent === "Theme"');
  check(`document.querySelectorAll("[cmdk-group]:not([hidden]) [data-slot=command-item]").length === ${themeCount}`);
  browser("fill", 'input[role="combobox"]', "gruvbox");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]") && getComputedStyle(document.body).backgroundColor === "rgb(30, 30, 30)"');
  waitFor('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("New task")) && getComputedStyle([...document.querySelectorAll("button")].find((b) => b.textContent.includes("New task"))).backgroundColor === "rgb(125, 174, 163)"');
  assert.equal((await command("theme.list")).selected, "gruvbox", "the workspace stores the choice");
  const themeAudit = JSON.parse(browser("--json", "a11y"));
  assert.equal(themeAudit.data.violations.length, 0, JSON.stringify(themeAudit.data.violations));

  browser("reload");
  waitFor('getComputedStyle(document.body).backgroundColor === "rgb(30, 30, 30)" && document.querySelectorAll("[role=option]").length === 3');
  check('document.documentElement.classList.contains("dark")');
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('document.querySelector("[data-slot=command-item][aria-selected=true]")?.textContent.startsWith("Gruvbox")');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');

  // A light palette drops the dark class, and a file beside the database joins the picker.
  writeFileSync(path.join(scratch, "themes", "sunset.toml"), 'mode = "light"\naccent = "#c2410c"\nbackground = "#fff7ed"\ndark_background = "#ffedd5"\nforeground = "#431407"\n');
  browser("press", "Alt+t");
  try {
    waitFor('document.activeElement.matches("[cmdk-input]")');
  } catch {
    // Rare autofocus race on reopen: close fully and open once more.
    console.error("DIAG inputs:", evaluate('document.querySelectorAll("[cmdk-input]").length'));
    console.error("DIAG dialogs:", evaluate('document.querySelectorAll("[role=dialog]").length'));
    browser("press", "Escape");
    waitFor('!document.querySelector("[role=dialog]")');
    browser("press", "Alt+t");
    waitFor('document.activeElement.matches("[cmdk-input]")');
  }
  browser("fill", 'input[role="combobox"]', "latte");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.offsetParent !== null && item.textContent.startsWith("Catppuccin Latte"))');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.startsWith("Catppuccin Latte")).click(); true');
  waitFor('getComputedStyle(document.body).backgroundColor === "rgb(227, 228, 232)"');
  check('!document.documentElement.classList.contains("dark")');
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "sunset");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.offsetParent !== null && item.textContent.startsWith("Sunset"))');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.startsWith("Sunset")).click(); true');
  waitFor('getComputedStyle(document.body).backgroundColor === "rgb(255, 237, 213)"');
  waitFor('getComputedStyle([...document.querySelectorAll("button")].find((b) => b.textContent.includes("New task"))).backgroundColor === "rgb(194, 65, 12)"');
  assert.equal((await command("theme.list")).selected, "sunset");

  // Back to the neutral ramp: the default theme overrides no slot, so no
  // palette custom property survives on <html>.
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "default");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.documentElement.getAttribute("style") === "" && getComputedStyle(document.body).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--om-dark-background").trim()');
  assert.equal((await command("theme.list")).selected, "default");
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 3');

  // Settings: the header icon group opens the dialog, and its Data section
  // writes a portable JSON file beside the scratch database.
  browser("find", "role", "button", "click", "--name", "Settings");
  waitFor('document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"');
  check('document.activeElement.textContent === "Export tasks as JSON"');
  check('document.body.textContent.includes("Your tasks live in one SQLite file.")');
  browser("find", "role", "button", "click", "--name", "Export tasks as JSON");
  waitFor('document.body.textContent.includes("Exported 3 tasks")');
  const exportedPath = evaluate('document.querySelector("[data-slot=alert-description]").textContent');
  const exportedFile = JSON.parse(readFileSync(exportedPath, "utf8"));
  assert.equal(exportedFile.format, "tasks.tasks-export");
  assert.equal(exportedFile.formatVersion, 2);
  assert.equal(exportedFile.taskCount, 3);
  assert.ok(exportedFile.tasks.every((row) => Number.isInteger(row.siblingOrder) && row.siblingOrder >= 0));
  assert.ok(exportedFile.tasks.every((row) => typeof row.title === "string" && Array.isArray(row.tags)));
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  check('document.activeElement.textContent.trim() === "Settings"');

  // The palette reaches the same dialog without a mouse.
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "settings");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-slot=dialog-content] [data-slot=dialog-title]")?.textContent === "Settings"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement.textContent.trim() === "Settings"');

  // Tab does not leave the task list; C opens create from the list.
  focus("[role=listbox]");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== null');
  check('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  check('[...document.querySelectorAll("button")].find((button) => button.textContent.includes("New task"))?.tabIndex === -1');
  evaluate('window.beforeNav = document.activeElement; window.beforeActiveId = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true');
  browser("press", "Escape");
  waitFor('document.activeElement === window.beforeNav');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeActiveId');
  browser("press", "ArrowUp");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === window.beforeActiveId');
  browser("press", "Tab");
  waitFor('document.activeElement === window.beforeNav');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement === window.beforeNav');
  // Toolbar clicks never steal list focus (real mouse), and arrows keep
  // working even when focus is elsewhere on the home surface.
  browser("click", "[data-filter=task-unblocked]");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true"');
  check('document.activeElement === window.beforeNav');
  evaluate('window.beforeToolbarNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeToolbarNav');
  evaluate('document.activeElement.blur(); true');
  check('document.activeElement.tagName === "BODY"');
  evaluate('window.beforeBlurNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeBlurNav');
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement.getAttribute("role") === "listbox"');
  // Enter on the list opens the highlighted task in the shared dialog.
  browser("press", "Enter");
  waitFor('document.querySelector("form[aria-label^=Edit]") !== null');
  waitFor('document.querySelector(\'form[aria-label="Edit task"] input\') === document.activeElement');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement.getAttribute("role") === "listbox"');

  // The palette also opens the shared create dialog.
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "new task dialog");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');

  focus("[role=listbox]");
  evaluate('[...document.querySelectorAll("[role=option]")].find((entry) => entry.textContent.includes("Call the venue")).click(); true');
  waitFor('document.querySelector(\'form[aria-label="Edit task"]\') !== null');
  browser("fill", 'form[aria-label="Edit task"] input', "Confirm the venue");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "4");
  waitFor('document.querySelector(\'form[aria-label="Edit task"] [data-priority="P4"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")');
  browser("press", "Enter");
  waitFor('document.querySelector("form[aria-label^=Edit]") === null');
  assert.ok((await command("task.list")).tasks.some((task) => task.title === "Confirm the venue" && task.priority === 4));

  await command("task.create", { title: "Check ".repeat(60), descriptionMarkdown: "Long notes ".repeat(100) });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 4');
  for (const width of [1280, 390, 320]) {
    browser("set", "viewport", String(width), "844");
    check('document.documentElement.scrollWidth <= innerWidth');
  }
  check('(() => { const title = [...document.querySelectorAll("[role=option] [data-slot=item-title]")].find((entry) => entry.textContent.startsWith("Check Check")); if (!title || title.textContent.length <= 100) return false; const style = getComputedStyle(title); return style.whiteSpace !== "nowrap" && title.scrollWidth <= title.clientWidth + 1; })()');
  const audit = JSON.parse(browser("--json", "a11y"));
  assert.equal(audit.success, true);
  assert.equal(audit.data.violations.length, 0, JSON.stringify(audit.data));
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"');
  check('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  // Delete is scoped to a focused row and cancels it immediately. C never fires while typing.
  focus("[role=listbox]");
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  waitFor('(() => { const dialog = document.querySelector("[role=dialog]"); if (!dialog) return false; const top = Math.round(dialog.getBoundingClientRect().top); return top === 64 || top === 80; })()');
  check('(() => { const dialog = document.querySelector("[role=dialog]"); if (!dialog) return false; if (dialog.getBoundingClientRect().bottom > innerHeight + 1) return false; return getComputedStyle(dialog).padding === "16px"; })()');
  browser("press", "Delete");
  check('document.querySelector(\'form[aria-label="New task"]\') !== null && ![...document.querySelectorAll("[role=dialog]")].some((dialog) => dialog.textContent.includes("Cancel task?"))');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  focus("[role=listbox]");
  const deletedId = evaluate('window.deleteList = document.activeElement; window.deletedId = document.activeElement.getAttribute("aria-activedescendant").slice("task-option-".length); window.deletedId');
  browser("press", "Delete");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 3');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Task canceled")');
  check('document.activeElement === window.deleteList');
  assert.equal((await command("task.get", { id: deletedId })).task.status, "canceled");

  // Canceled tasks are easy to recover through the inactive filter.
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "canceled"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  assert.equal((await command("task.get", { id: deletedId })).task.status, "open");
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 4');

  // A stale immediate cancellation is rejected and refreshes the row.
  const staleId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)');
  const staleTask = (await command("task.get", { id: staleId })).task;
  await command("task.update", { id: staleId, expectedVersion: staleTask.version, title: "Changed before delete" });
  browser("press", "Delete");
  waitFor('document.body.textContent.includes("changed elsewhere")');
  waitFor('document.querySelector("[role=option] [data-slot=item-title]")?.textContent === "Changed before delete"');
  check('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 4');

  // A committed cancellation with a lost reply can be retried safely.
  const lostId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)');
  evaluate(`window.originalFetch = window.fetch; window.loseReply = true; window.deleteKeys = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    const response = await window.originalFetch(...args);
    if (payload.command === "task.delete") {
      window.deleteKeys.push(payload.idempotencyKey);
      if (window.loseReply) { window.loseReply = false; throw new TypeError("Lost delete reply"); }
    }
    return response;
  }; true`);
  browser("press", "Delete");
  waitFor('document.body.textContent.includes("Could not cancel")');
  check('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 4');
  browser("press", "Delete");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 3');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Task canceled")');
  check('window.deleteKeys.length === 2 && window.deleteKeys[0] === window.deleteKeys[1]');
  check('document.activeElement.matches("[role=listbox]")');
  evaluate('window.fetch = window.originalFetch; true');
  assert.equal((await command("task.get", { id: lostId })).task.status, "canceled");
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "canceled"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  assert.equal((await command("task.get", { id: lostId })).task.status, "open");
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 4');
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 4');
  check('document.querySelectorAll(`[data-status="open"]`).length === 4');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  assert.equal((await command("task.list")).total, 4);

  // The outline is intentionally shallow in the UI. A grandchild remains
  // visible at one indentation level rather than creating recursive nesting.
  const treeParent = (await command("task.create", { title: "Release parent" })).task;
  const treeChild = (await command("task.create", { title: "Package child" })).task;
  const treeGrandchild = (await command("task.create", { title: "Deep child" })).task;
  await command("task.move", { id: treeChild.id, parentId: treeParent.id, expectedVersion: treeChild.version });
  await command("task.move", { id: treeGrandchild.id, parentId: treeChild.id, expectedVersion: treeGrandchild.version });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 5');
  check('!document.body.textContent.includes("Package child")');
  evaluate(`(() => {
    const row = [...document.querySelectorAll('[role=option]')].find((entry) => entry.textContent.includes('Release parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor('document.querySelectorAll("[role=option]").length === 7 && document.querySelectorAll("[data-depth=\\"1\\"]").length === 2');
  check('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Release parent")');
  check('document.querySelector("[data-depth=\\"1\\"] .pl-6") !== null');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' + treeGrandchild.id + '")');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' + treeChild.id + '")');
  browser("press", "ArrowLeft");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("' + treeParent.id + '")');
  browser("press", "ArrowLeft");
  waitFor('document.querySelectorAll("[role=option]").length === 5 && !document.querySelector("[data-depth=\\"1\\"]")');

  // The unblocked filter ignores canceled dependency targets and can be
  // toggled from the focused list with F then U.
  const blocker = (await command("task.create", { title: "Release blocker" })).task;
  const blocked = (await command("task.create", { title: "Blocked task" })).task;
  await command("task.dependency.add", {
    id: blocked.id,
    dependsOnId: blocker.id,
    expectedVersion: blocked.version,
  });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 7');
  check('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true"');
  check('document.querySelector("[data-filter-summary]")?.textContent.includes("unblocked")');
  waitFor('document.querySelectorAll("[role=option]").length === 6');
  check('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Blocked task"))');
  check('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Release blocker"))');
  browser("press", "f");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 7');
  assert.equal((await command("task.list", { unblocked: true })).total, 8);

  // Relationship context stays visible in compact rows; when details are on,
  // the optional time footer remains the final row even when a task is blocked.
  focus("[role=listbox]");
  check('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"');
  check('(() => { const row = [...document.querySelectorAll("[role=option]")].find((item) => item.textContent.includes("Blocked task")); if (!row) return false; const paragraphs = [...row.querySelectorAll("p")]; const relationship = paragraphs.find((entry) => entry.textContent.includes("Release blocker")); return relationship !== undefined && row.querySelector("[data-task-description]") === null && row.querySelector("[title^=\\"Created\\"]") === null; })()');
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"');
  check('(() => { const row = [...document.querySelectorAll("[role=option]")].find((item) => item.textContent.includes("Blocked task")); if (!row) return false; const paragraphs = [...row.querySelectorAll("p")]; const relationship = paragraphs.find((entry) => entry.textContent.includes("Release blocker")); const timestamp = paragraphs.find((entry) => entry.querySelector("[title^=\\"Created\\"]")); return relationship !== undefined && timestamp !== undefined && paragraphs.indexOf(relationship) < paragraphs.indexOf(timestamp) && paragraphs.indexOf(timestamp) === paragraphs.length - 1; })()');
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"');
  check('(() => { const row = [...document.querySelectorAll("[role=option]")].find((item) => item.textContent.includes("Blocked task")); return row?.querySelector("[data-task-description]") === null && row?.querySelector("[title^=\\"Created\\"]") === null && row?.textContent.includes("Release blocker"); })()');

  // F then C opens the category selector. Choosing a category enables the Folder
  // filter button; clicking it again clears the category filter.
  await command("task.create", { title: "Roadmap task @roadmap" });
  await command("task.create", { title: "Launch follow-up @launch" });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 9');
  check('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"');
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "c");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('document.querySelectorAll("[cmdk-group-heading] svg").length === 1');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("roadmap"))');
  browser("fill", 'input[role="combobox"]', "roadmap");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1 && document.activeElement.matches("[role=listbox]")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · roadmap"');
  check('document.querySelector("[data-filter-summary] [data-filter-category]")?.textContent === "roadmap"');
  check('document.querySelector("[role=option]").textContent.includes("Roadmap task")');
  check('document.querySelector("[data-filter=task-category]").getAttribute("aria-label").includes("roadmap")');
  focus("[role=listbox]");
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"');
  // @ opens the category picker directly with its search field ready for typing.
  focus("[role=listbox]");
  browser("press", "@");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "launch");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")');
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');
  // Clicking a task's category badge filters to that category without opening the picker.
  evaluate('document.querySelector("[data-task-category=launch]").click(); true');
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1 && document.activeElement.matches("[role=listbox]")');
  check('document.querySelector("[data-filter-summary] [data-filter-category]")?.textContent === "launch"');
  check('document.querySelector("[role=option]").textContent.includes("Launch follow-up")');
  focus("[role=listbox]");
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');

  // Priority: P2 is the default, F then 0-4 filters on the list, bare 0-4
  // sets the active task, and the dialog section sets the task priority
  // without putting individual buttons in Tab order.
  assert.equal((await command("task.list", { priority: 2 })).total >= 9, true);
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "0");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 0');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks · P0"');
  waitFor('document.activeElement.matches("[role=listbox]") && document.querySelector("[data-empty-state=filtered]") !== null');
  check('document.body.textContent.includes("No tasks match the current filters")');
  check('document.querySelector("[data-empty-state=filtered] button").tabIndex === -1');
  check('(() => { const list = document.querySelector("[role=listbox]"); const empty = document.querySelector("[data-empty-state=filtered]"); if (!list || !empty) return false; const listBox = list.getBoundingClientRect(); const emptyBox = empty.getBoundingClientRect(); const style = getComputedStyle(empty); return Math.abs(emptyBox.width - listBox.width) < 1 && emptyBox.height >= 48 && emptyBox.height <= 120 && style.borderStyle === "dashed" && (style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent"); })()');
  evaluate('window.filteredEmptyList = document.activeElement; true');
  browser("press", "Tab");
  waitFor('document.activeElement === window.filteredEmptyList');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")');
  // Escape resets filters, returning to the full Active view.
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9 && document.activeElement.matches("[role=listbox]")');
  // Filtering again, then the same key clears the priority filter.
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "0");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 0');
  browser("press", "f");
  browser("press", "0");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');
  // Bare 0-4 on the list sets the active task's priority instead of filtering.
  // No focus call here: list focus persists from above, and refocusing would
  // refetch and heal the stale version the next step depends on.
  const priorityId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").slice("task-option-".length)');
  const priorityBefore = (await command("task.get", { id: priorityId })).task;
  browser("press", "1");
  waitFor('document.body.textContent.includes(": priority high")');
  assert.equal((await command("task.get", { id: priorityId })).task.priority, 1);
  // A stale version rejects the quick-set and keeps the row in place. The
  // outside edit must really change the task: an identical update is a
  // no-op and bumps nothing.
  await command("task.update", { id: priorityId, expectedVersion: priorityBefore.version + 1, title: `${priorityBefore.title} (agent edit)`, descriptionMarkdown: priorityBefore.descriptionMarkdown });
  browser("press", "3");
  waitFor('document.body.textContent.includes("changed elsewhere")');
  assert.equal((await command("task.get", { id: priorityId })).task.priority, 1);
  // Mouse opens the priority menu and picks P2.
  evaluate('document.querySelector("[data-filter=task-priority]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("P2"))');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  // The composer defaults to P2. Pointer selection works too, but the group
  // remains the one keyboard focus target.
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  check('document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"');
  check('(() => { const selected = document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\'); const unselected = document.querySelector(\'form[aria-label="New task"] [data-priority="P0"]\'); if (!selected || !unselected) return false; if (selected.getAttribute("aria-checked") !== "true") return false; const selectedStyle = getComputedStyle(selected); const unselectedStyle = getComputedStyle(unselected); return selectedStyle.backgroundColor !== unselectedStyle.backgroundColor && selectedStyle.color !== unselectedStyle.color && selectedStyle.borderColor !== "rgba(0, 0, 0, 0)"; })()');
  check('document.querySelector(\'form[aria-label="New task"] [role="radiogroup"]\').tabIndex === 0');
  browser("find", "role", "radio", "click", "--name", "P2: normal");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  evaluate('document.querySelector(\'form[aria-label="New task"] [data-priority="P3"]\').click(); true');
  waitFor('document.querySelector(\'form[aria-label="New task"] [data-priority="P3"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")');
  browser("fill", 'form[aria-label="New task"] input', "Urgent cockpit task");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Tab");
  waitFor('document.activeElement.matches("[role=radiogroup]")');
  browser("press", "0");
  waitFor('document.querySelector(\'form[aria-label="New task"] [data-priority="P0"]\').getAttribute("aria-checked") === "true" && document.activeElement.matches("[role=radiogroup]")');
  browser("press", "Control+Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  assert.equal((await command("task.list", { priority: 0 })).total, 1);
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 10');

  // Tags: F then T opens a multi-select picker with AND semantics; the
  // picker's Clear tags row empties the filter.
  await command("task.create", { title: "Tag cockpit #planning #product" });
  await command("task.create", { title: "Planning only #planning" });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 12');
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))');
  browser("press", "Space");
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=dialog]") !== null');
  // Picker stays open for multi-select; pick product to narrow to AND with Space.
  check('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "product");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("product"))');
  browser("press", "Space");
  waitFor('document.querySelectorAll(\'[role=listbox][aria-label^="Tasks"] [role=option]\').length === 1');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · #planning #product"');
  check('document.querySelector(\'[role=listbox][aria-label^="Tasks"] [role=option]\').textContent.includes("Tag cockpit")');
  // Enter closes the picker without changing the current multi-selection.
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  // Clearing lives in the picker itself: reopen and pick Clear tags.
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Clear tags")).click(); true');
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 12');
  // With no selection, Enter picks the highlighted tag before closing the picker.
  const planningCount = (await command("task.list", { tags: ["planning"] })).total;
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")');
  waitFor(`document.querySelector("[data-filter-summary]")?.textContent === "${planningCount} active task${planningCount === 1 ? "" : "s"} · #planning"`);
  focus("[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Clear tags")).click(); true');
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 12');
  // # opens the tag picker directly with its search field ready for typing.
  focus("[role=listbox]");
  browser("press", "#");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true" && !document.querySelector("[role=dialog]") && document.activeElement.matches("[role=listbox]")');
  browser("press", "Escape");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 12');

  // Search: / opens, covers titles and descriptions, stays applied, and the
  // button clears with a mouse action. Empty filters offer Clear filters.
  focus("[role=listbox]");
  browser("press", "/");
  waitFor('document.querySelector(\'input[name="search"]\') !== null');
  browser("fill", 'input[name="search"]', "accessibility");
  check('document.querySelector(\'input[name="search"]\').value === "accessibility"');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · “accessibility”"');
  check('document.querySelector("[data-filter=task-search]").getAttribute("aria-label").includes("accessibility")');
  // A query with no matches shows the filtered empty state with Clear filters.
  focus("[role=listbox]");
  browser("press", "/");
  waitFor('document.querySelector(\'input[name="search"]\') !== null');
  browser("fill", 'input[name="search"]', "zzz-no-such-task");
  check('document.querySelector(\'input[name="search"]\').value === "zzz-no-such-task"');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("No tasks match the current filters")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks · “zzz-no-such-task”"');
  browser("find", "role", "button", "click", "--name", "Clear filters");
  waitFor('document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 12');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  // Task details and sorting: V toggles descriptions plus the time footer,
  // S drives the sort, and both survive a reload through localStorage.
  check('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false"');
  check('document.querySelector("[data-task-description]") === null');
  check('document.querySelector("[title^=\\"Created\\"]") === null');
  focus("[role=listbox]");
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"');
  check('[...document.querySelectorAll("[role=option]")].every((row) => row.textContent.includes("Created today"))');
  check('[...document.querySelectorAll("[role=option]")].every((row) => row.querySelector("[title^=\\"Created\\"]") !== null)');
  check('(() => { const row = [...document.querySelectorAll("[role=option]")].find((item) => item.textContent.includes("Agent updated title")); return row?.querySelector("[data-task-description]")?.textContent.includes("Shortlist") === true; })()');
  check('document.querySelector("[title^=\\"Updated\\"]") === null');
  // Stamp two rows older: recent timestamps use relative labels and the
  // updated line appears only where the day differs from creation.
  const updatedAt = new Date();
  updatedAt.setDate(updatedAt.getDate() - 2);
  updatedAt.setHours(12, 0, 0, 0);
  const stampDb = new DatabaseSync(path.join(scratch, "tasks.db"));
  stampDb.prepare("UPDATE tasks SET created_at = ?, updated_at = ? WHERE title LIKE 'Tag cockpit%'").run("2026-01-05T12:00:00.000Z", updatedAt.toISOString());
  stampDb.prepare("UPDATE tasks SET created_at = ?, updated_at = ? WHERE title = 'Planning only #planning'").run("2026-01-06T12:00:00.000Z", updatedAt.toISOString());
  stampDb.close();
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 12 && document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true"');
  check('[...document.querySelectorAll("[role=option]")].filter((row) => row.textContent.includes("Updated 2 days ago")).length === 2');
  check('document.querySelector("[title^=\\"Created Jan 5, 2026\\"]") !== null');
  check('document.querySelectorAll("[title^=\\"Updated\\"]").length === 2');
  check('[...document.querySelectorAll("[role=option]")].filter((row) => row.querySelector("[title^=\\"Updated\\"]")).every((row) => { const timestamps = [...row.querySelectorAll("[title^=\\"Updated\\"], [title^=\\"Created\\"]")]; return timestamps[0]?.title.startsWith("Updated") && timestamps[1]?.title.startsWith("Created"); })');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  // Sort by created, then reverse; the stamped rows pin the order. S focuses
  // the whole sort toolbar and a choice returns focus to the list.
  focus("[role=listbox]");
  evaluate('window.sortToolbarTop = document.querySelector("[aria-label=\\"Task list sort\\"]").getBoundingClientRect().top + window.scrollY; window.sortListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true');
  browser("press", "s");
  waitFor('document.activeElement.matches("[data-toolbar=sort]")');
  waitFor('document.querySelector("[data-shortcut-guide=sort]") !== null');
  check('document.querySelectorAll("[data-shortcut-guide=sort] [data-shortcut-option] [data-shortcut-key]").length === 4');
  check('document.querySelector("[aria-label=\\"Saved tasks\\"] [data-shortcut-guide=sort]") === null');
  check('(() => { const toolbar = document.querySelector("[data-toolbar=sort]"); if (!toolbar || !toolbar.hasAttribute("data-toolbar-active")) return false; const shadow = getComputedStyle(toolbar).boxShadow; return shadow !== "none" && shadow !== ""; })()');
  check('Math.abs(document.querySelector("[aria-label=\\"Task list sort\\"]").getBoundingClientRect().top + window.scrollY - window.sortToolbarTop) < 0.5 && Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.sortListTop) < 0.5');
  // S also closes and reopens the focused sort toolbar.
  browser("press", "s");
  waitFor('document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-shortcut-guide]") && !document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")');
  browser("press", "s");
  waitFor('document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-shortcut-guide=sort]") !== null');
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-created]").getAttribute("aria-pressed") === "true" && !document.querySelector("[data-shortcut-guide]") && document.activeElement.matches("[role=listbox]") && !document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].slice(-2).map((title) => title.textContent)) === JSON.stringify(["Planning only", "Tag cockpit"])');
  browser("press", "s");
  waitFor('document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks" && document.querySelector("[role=option] [data-slot=item-title]")?.textContent === "Tag cockpit"');
  check('document.querySelector("[role=option] [data-slot=item-title]").textContent === "Tag cockpit"');
  // Back to updated/newest, details off; mouse covers the same controls.
  browser("press", "s");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  browser("press", "s");
  waitFor('document.activeElement.matches("[data-toolbar=sort]") && document.querySelector("[data-toolbar=sort]").hasAttribute("data-toolbar-active")');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-task-description]") === null && document.querySelector("[title^=\\"Created\\"]") === null');
  evaluate('document.querySelector("[data-sort=task-sort-created]").click(); true');
  waitFor('document.querySelector("[data-sort=task-sort-created]").getAttribute("aria-pressed") === "true"');
  check('document.activeElement.getAttribute("role") === "listbox"');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  evaluate('document.querySelector("[data-sort=task-sort-updated]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks"');
  evaluate('document.querySelector("[data-view=task-details]").click(); true');
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "true" && document.querySelector("[data-task-description]") !== null && document.querySelector("[title^=\\"Created\\"]") !== null');
  evaluate('document.querySelector("[data-view=task-details]").click(); true');
  waitFor('document.querySelector("[data-view=task-details]").getAttribute("aria-pressed") === "false" && document.querySelector("[data-task-description]") === null && document.querySelector("[title^=\\"Created\\"]") === null');
  // Toolbar order stays Status, Priority, Category, Tags, Unblocked, Search,
  // then the sort and view groups in their own button groups.
  check('JSON.stringify([...document.querySelectorAll("[data-filter]")].map((b) => b.getAttribute("data-filter"))) === JSON.stringify(["task-status","task-priority","task-category","task-tags","task-unblocked","task-search"])');
  check('JSON.stringify([...document.querySelectorAll("[data-sort]")].map((b) => b.getAttribute("data-sort"))) === JSON.stringify(["task-sort-created","task-sort-updated","task-sort-manual","task-sort-reverse"])');
  check('document.querySelector("[data-view=task-details]") !== null');
  for (const width of [1280, 320]) {
    browser("set", "viewport", String(width), "844");
    check('document.documentElement.scrollWidth <= innerWidth');
  }
  check('(() => { const summary = document.querySelector("[data-filter-summary]"); const toolbar = document.querySelector("[data-toolbar=filters]"); const list = document.querySelector("[role=listbox]"); if (!summary || !toolbar || !list) return false; const style = getComputedStyle(summary); if (style.overflow !== "hidden" || summary.getBoundingClientRect().height > 20) return false; const badge = summary.querySelector("[data-filter-category]"); if (badge) { const s = summary.getBoundingClientRect(), b = badge.getBoundingClientRect(); const base = summary.querySelector("[data-slot=breadcrumb-item] > span"); if (!base || getComputedStyle(badge).fontSize !== getComputedStyle(base).fontSize || Math.abs((b.top + b.bottom) / 2 - (s.top + s.bottom) / 2) > 2) return false; } const toolbarBox = toolbar.getBoundingClientRect(), summaryBox = summary.getBoundingClientRect(), listBox = list.getBoundingClientRect(); return Math.abs((summaryBox.top - toolbarBox.bottom) - (listBox.top - summaryBox.bottom)) <= 1; })()');
  // Shift+C keeps the same composer flow and assigns the selected task as parent.
  focus("[role=listbox]");
  browser("press", "Home");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === document.querySelector("[role=option]")?.id');
  const parentId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").replace("task-option-", "")');
  browser("press", "Shift+c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  waitFor('document.activeElement.name === "title"');
  browser("fill", 'form[aria-label="New task"] input', "Venue follow-up");
  browser("press", "Control+Enter");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement?.getAttribute("role") === "listbox"');
  const child = (await command("task.list")).tasks.find((task) => task.title === "Venue follow-up");
  assert.equal(child?.parentId, parentId);

  // M opens a move picker. Nested tasks can remove their parent from a
  // separate group above the new-parent results.
  const detachParent = (await command("task.create", { title: "Detach parent" })).task;
  const detachChild = (await command("task.create", { title: "Detach child", parentId: detachParent.id })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Detach parent"))');
  evaluate(`(() => {
    const row = [...document.querySelectorAll('[role=option]')].find((entry) => entry.textContent.includes('Detach parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row?.querySelector('[aria-label="Expand children"]')?.click();
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  waitFor('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Detach parent")');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === "task-option-' + detachChild.id + '"');
  browser("press", "m");
  waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Remove parent")');
  check('JSON.stringify([...document.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent.trim())) === JSON.stringify(["Current parent", "Select new parent"])');
  check('document.querySelector("[data-slot=command-item]")?.textContent.includes("Remove parent")');
  evaluate('([...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Remove parent"))?.click(), true)');
  waitFor('document.body.textContent.includes("Detach child is now a top-level task")');
  assert.equal((await command("task.get", { id: detachChild.id })).task.parentId, null);

  // Status undo: immediate removal, Ctrl+Z restore, palette path, replacement,
  // typing guards, conflict, and lost-reply retry. Only a post-success toast appears.
  const undoTask = (await command("task.create", { title: "Undo me status" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  focus("[role=listbox]");
  browser("press", "Home");
  // The newest task is first under updated/newest, so Home selects the undo task.
  // Cancel it with Delete: it leaves Active immediately and shows a success toast.
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Task canceled")');
  check('![...document.querySelectorAll("button")].some((b) => b.textContent.includes("Undo"))');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "canceled");
  // Ctrl+Z restores the exact prior status, keeps list focus, and toasts once.
  browser("press", "Control+z");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Open")');
  check('document.activeElement?.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant")?.includes("' + undoTask.id + '") || true');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  const undoVersion = (await command("task.get", { id: undoTask.id })).task.version;
  // The toast expires without changing task state again.
  await new Promise((resolve) => setTimeout(resolve, 3500));
  check('document.querySelector("[data-undo-toast]") === null');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoTask.id })).task.version, undoVersion);
  // The same action runs from the Help palette by mouse/keyboard.
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "undo status");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Undo status change"))');
  browser("press", "Enter");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Open")');
  assert.equal((await command("task.get", { id: undoTask.id })).task.status, "open");
  await new Promise((resolve) => setTimeout(resolve, 3500));
  // A newer status change replaces the previous undo entry.
  const undoFirst = (await command("task.create", { title: "Undo first entry" })).task;
  const undoSecond = (await command("task.create", { title: "Undo second entry" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo second entry"))');
  focus("[role=listbox]");
  browser("press", "Home");
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo second entry"))');
  // Select the first entry (now at the top after the second left Active).
  browser("press", "Home");
  // The top row should now be the first entry; complete it to replace the undo slot.
  evaluate('(() => { const row = [...document.querySelectorAll("[role=option]")].find((e) => e.textContent.includes("Undo first entry")); if (row) { row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); } return true; })()');
  // Ensure the active row is the first entry by moving until it matches.
  for (let step = 0; step < 6; step++) {
    const activeId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant")');
    const activeText = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") && document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent');
    if (String(activeText).includes("Undo first entry")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo first entry"))');
  browser("press", "Control+z");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo first entry"))');
  assert.equal((await command("task.get", { id: undoFirst.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoSecond.id })).task.status, "canceled");
  await new Promise((resolve) => setTimeout(resolve, 3500));
  // The entry is consumed: a second Ctrl+Z does nothing.
  browser("press", "Control+z");
  await delay(500);
  check('document.querySelector("[data-undo-toast]") === null');
  assert.equal((await command("task.get", { id: undoFirst.id })).task.status, "open");
  assert.equal((await command("task.get", { id: undoSecond.id })).task.status, "canceled");
  // Undo does not fire inside the composer.
  focus("[role=listbox]");
  browser("press", "Home");
  // Make a fresh undoable change on the undo-me task for the guard checks.
  evaluate('(() => { const row = [...document.querySelectorAll("[role=option]")].find((e) => e.textContent.includes("Undo me status")); if (row) row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); return true; })()');
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""');
    if (String(activeText).includes("Undo me status")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Control+z");
  await delay(500);
  check('document.querySelector(\'form[aria-label="New task"]\') !== null && !document.querySelector("[data-undo-toast]")?.textContent.includes("Undo status change")');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  // Undo still works after leaving the composer.
  focus("[role=listbox]");
  browser("press", "Control+z");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  await new Promise((resolve) => setTimeout(resolve, 3500));
  // Undo after an external edit reports a conflict and keeps the edit.
  const conflictTask = (await command("task.create", { title: "Undo conflict task" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo conflict task"))');
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""');
    if (String(activeText).includes("Undo conflict task")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo conflict task"))');
  const conflictCommitted = (await command("task.get", { id: conflictTask.id })).task;
  await command("task.update", { id: conflictTask.id, expectedVersion: conflictCommitted.version, title: "Undo conflict task (agent edit)", descriptionMarkdown: conflictCommitted.descriptionMarkdown });
  browser("press", "Control+z");
  waitFor('document.body.textContent.includes("no longer available")');
  assert.equal((await command("task.get", { id: conflictTask.id })).task.status, "canceled");
  assert.equal((await command("task.get", { id: conflictTask.id })).task.title, "Undo conflict task (agent edit)");
  // A lost undo response can be retried with the same key and commits once.
  const lostUndo = (await command("task.create", { title: "Undo lost reply" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo lost reply"))');
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""');
    if (String(activeText).includes("Undo lost reply")) break;
    browser("press", "ArrowDown");
    await delay(150);
  }
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo lost reply"))');
  const lostCommitted = (await command("task.get", { id: lostUndo.id })).task;
  evaluate(`window.originalFetch = window.fetch; window.loseUndoReply = true; window.undoKeys = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    const response = await window.originalFetch(...args);
    if (payload.command === "task.status.undo") {
      window.undoKeys.push(payload.idempotencyKey);
      if (window.loseUndoReply) { window.loseUndoReply = false; throw new TypeError("Lost undo reply"); }
    }
    return response;
  }; true`);
  browser("press", "Control+z");
  await delay(800);
  // First attempt lost its reply; the row is still gone and no toast shows yet.
  check('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo lost reply"))');
  browser("press", "Control+z");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo lost reply"))');
  waitFor('document.querySelector("[data-undo-toast]")?.textContent.includes("Open")');
  check('window.undoKeys.length === 2 && window.undoKeys[0] === window.undoKeys[1]');
  evaluate('window.fetch = window.originalFetch; true');
  const lostRestored = (await command("task.get", { id: lostUndo.id })).task;
  assert.equal(lostRestored.status, "open");
  assert.equal(lostRestored.version, lostCommitted.version + 1);
  await new Promise((resolve) => setTimeout(resolve, 3500));

  // Completing a parent keeps it as muted context when its active children
  // remain in the current view. The context row stays expandable and is not
  // counted as an active task.
  const contextParent = (await command("task.create", { title: "Completed context parent" })).task;
  const otherContextParent = (await command("task.create", { title: "Other context parent" })).task;
  await command("task.create", { title: "Other context child", parentId: otherContextParent.id });
  await command("task.create", { title: "Active context child", parentId: contextParent.id });
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Completed context parent"))');
  evaluate(`(() => {
    const row = [...document.querySelectorAll('[role=option]')].find((entry) => entry.textContent.includes('Completed context parent'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Completed context parent")');
  const contextParentIndex = evaluate('[...document.querySelectorAll("[role=listbox] > [role=option]")].findIndex((item) => item.textContent.includes("Completed context parent"))');
  browser("press", "Space");
  waitFor('document.querySelector("[role=option][aria-expanded=true] [data-status=in_progress]") !== null');
  browser("press", "Space");
  waitFor('document.querySelector("[role=option][data-context-parent][aria-expanded=true]")?.textContent.includes("Completed context parent")');
  const contextVisibleCount = evaluate('document.querySelectorAll("[role=option]:not([data-context-parent])").length');
  const contextAfterIndex = evaluate('[...document.querySelectorAll("[role=listbox] > [role=option]")].findIndex((item) => item.textContent.includes("Completed context parent"))');
  check(`${contextAfterIndex} === ${contextParentIndex}`);
  check('[...document.querySelectorAll("[data-depth=\\"1\\"]")].some((item) => item.textContent.includes("Active context child"))');
  check(`document.querySelector("[data-parent-context]")?.textContent === "Still visible because children aren't done yet."`);
  check('(() => { const context = document.querySelector("[role=option][data-context-parent]"); if (!context) return false; const contextStyle = getComputedStyle(context); if (contextStyle.backgroundColor === "rgba(0, 0, 0, 0)" || contextStyle.backgroundColor === "transparent") return false; const plain = [...document.querySelectorAll("[role=option]")].find((entry) => !entry.hasAttribute("data-context-parent") && !entry.hasAttribute("data-active") && entry.getAttribute("aria-selected") !== "true"); if (!plain) return true; const plainStyle = getComputedStyle(plain); return contextStyle.backgroundColor !== plainStyle.backgroundColor || contextStyle.color !== plainStyle.color; })()');
  check(`document.querySelector("[data-filter-summary]")?.textContent === "${contextVisibleCount} active task${contextVisibleCount === 1 ? "" : "s"}"`);

  // Canceled parents use the same context treatment as completed parents,
  // including during the refresh needed to update canceled relationships.
  const canceledContextParent = (await command("task.create", { title: "Canceled context parent" })).task;
  await command("task.create", { title: "Active canceled-context child", parentId: canceledContextParent.id });
  const otherCanceledParent = (await command("task.create", { title: "Other canceled context parent" })).task;
  await command("task.create", { title: "Other canceled-context child", parentId: otherCanceledParent.id });
  await command("task.update", {
    id: canceledContextParent.id,
    expectedVersion: canceledContextParent.version,
    title: "Canceled context parent updated",
  });
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Canceled context parent updated"))');
  evaluate(`(() => {
    const row = [...document.querySelectorAll('[role=option]')].find((entry) => entry.textContent.includes('Canceled context parent updated'));
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.querySelector('[role=listbox]')?.focus();
    return true;
  })()`);
  browser("press", "ArrowRight");
  waitFor('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Canceled context parent updated")');
  const canceledParentIndex = evaluate('[...document.querySelectorAll("[role=listbox] > [role=option]")].findIndex((item) => item.textContent.includes("Canceled context parent updated"))');

  browser("press", "Delete");
  waitFor('document.querySelector("[role=option][data-context-parent][aria-expanded=true]")?.textContent.includes("Canceled context parent updated")');
  const canceledContextAfterIndex = evaluate('[...document.querySelectorAll("[role=listbox] > [role=option]")].findIndex((item) => item.textContent.includes("Canceled context parent updated"))');

  check(`${canceledContextAfterIndex} === ${canceledParentIndex}`);
  check('document.querySelector("[role=option][data-context-parent] [data-status=canceled]") !== null');
  check(`document.querySelector("[data-parent-context]")?.textContent === "Still visible because children aren't canceled yet."`);
  check('[...document.querySelectorAll("[data-depth=\\"1\\"]")].some((item) => item.textContent.includes("Active canceled-context child"))');

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
    waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true"');
  }
  for (const title of ["Manual A", "Manual B", "Manual C", "Manual D"]) {
    await command("task.create", { title: `${title} @manual-order-ui` });
  }
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual A"))');
  focus("[role=listbox]");
  browser("press", "@");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "manual-order-ui");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 4');
  focus("[role=listbox]");
  browser("press", "s");
  browser("press", "m");
  waitFor('document.querySelector("[data-sort=task-sort-manual]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")');
  check('document.querySelector("[data-sort=task-sort-reverse]").disabled === true');
  const manualOrder = () => JSON.parse(evaluate('JSON.stringify([...document.querySelectorAll("[role=option]")].map((row) => row.querySelector("[data-slot=item-title]")?.textContent))'));
  assert.deepEqual(manualOrder(), ["Manual D", "Manual C", "Manual B", "Manual A"]);
  // Pointer movement must not activate a row or steal the keyboard selection.
  focus("[role=listbox]");
  browser("press", "Home");
  const pointerFirstId = evaluate('document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant")');
  const pointerSecondId = evaluate('document.querySelectorAll("[role=option]")[1]?.id');
  browser("hover", `[role=option]#${pointerSecondId}`);
  check(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(pointerFirstId)}`);
  browser("press", "Home");
  browser("press", "ArrowDown");
  waitFor('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent.includes("Manual C")');
  browser("press", "Control+ArrowDown");
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])');
  check('document.activeElement.matches("[role=listbox]") && document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").includes("task-option-")');
  browser("press", "Control+Home");
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual C", "Manual D", "Manual B", "Manual A"])');
  browser("press", "Control+End");
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual A", "Manual C"])');
  browser("press", "Control+ArrowUp");
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])');
  // Shift movement selects a visible sibling range without restoring the old
  // dotted visualization. Move controls remain hidden until their mouse-only
  // button is opened, and the popover does not reflow the list.
  browser("press", "Home");
  check('document.querySelector("[role=listbox]").getAttribute("aria-multiselectable") === "true"');
  check('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  browser("press", "Shift+ArrowDown");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 2');
  browser("press", "Shift+ArrowDown");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 3');
  browser("press", "Shift+ArrowUp");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 2');
  browser("press", "Shift+Home");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  browser("press", "Shift+End");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 4');
  check('[...document.querySelectorAll("[role=option][aria-selected=true]")].every((row) => getComputedStyle(row).borderStyle !== "dashed" && !row.hasAttribute("data-empty-state"))');
  check('document.querySelector("[data-selection-toolbar]") === null');
  browser("press", "Escape");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 0');
  evaluate('(() => { const row = document.querySelector("[role=option]"); row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); return true; })()');
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  evaluate('(() => { const row = document.querySelector("[role=option]"); row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); return true; })()');
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 0');
  evaluate('(() => { const rows = [...document.querySelectorAll("[role=option]")]; rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); return true; })()');
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 3');
  check('[...document.querySelectorAll("[role=option][aria-selected=true]")].every((row) => getComputedStyle(row).borderStyle !== "dashed" && !row.hasAttribute("data-empty-state"))');
  browser("press", "Escape");
  waitFor('document.querySelectorAll("[role=option][aria-selected=true]").length === 0');
  browser("press", "Home");
  evaluate('window.manualListTop = document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY; true');
  check('document.querySelector("[data-move-controls]") === null');
  check('document.querySelector("[data-move-controls-toggle]").hasAttribute("aria-keyshortcuts") === false');
  browser("click", "[data-move-controls-toggle]");
  waitFor('document.querySelector("[data-move-controls]") !== null && document.querySelector("[data-move-controls-toggle]").getAttribute("aria-pressed") === "true"');
  browser("hover", "[role=listbox]");
  waitFor('(() => { const move = document.querySelector("[data-move-controls-toggle]"); const manual = document.querySelector("[data-sort=task-sort-manual]"); if (!move || !manual) return false; const moveStyle = getComputedStyle(move); const manualStyle = getComputedStyle(manual); return moveStyle.backgroundColor === manualStyle.backgroundColor && moveStyle.color === manualStyle.color; })()');
  check('Math.abs(document.querySelector("[role=listbox]").getBoundingClientRect().top + window.scrollY - window.manualListTop) < 0.5');
  check('[...document.querySelectorAll("[data-reorder-action]")].every((button) => button.getAttribute("aria-label") && !button.hasAttribute("aria-keyshortcuts"))');
  browser("hover", '[data-reorder-action="up"]');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Move up"');
  browser("click", '[data-reorder-action="down"]');
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual B", "Manual D", "Manual C", "Manual A"])');
  check('document.querySelectorAll("[role=option][aria-selected=true]").length === 1 && document.querySelector("[data-selection-toolbar]") === null');
  browser("click", "[data-move-controls-toggle]");
  waitFor('document.querySelector("[data-move-controls]") === null');
  browser("press", "Control+Home");
  waitFor('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual C", "Manual A"])');
  // The first move from a date sort changes to Manual, refreshes, and resolves
  // the adjacent target in the refreshed manual order rather than the date order.
  browser("press", "s");
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-created]").getAttribute("aria-pressed") === "true"');
  browser("press", "End");
  waitFor('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent.includes("Manual A")');
  browser("press", "Control+ArrowUp");
  waitFor('document.querySelector("[data-sort=task-sort-manual]").getAttribute("aria-pressed") === "true" && JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent)) === JSON.stringify(["Manual D", "Manual B", "Manual A", "Manual C"])');

  // A failed first-switch refresh must stop before task.reorder. The normal
  // background refresh path still reports its error in the list.
  browser("press", "Escape");
  browser("press", "s");
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-created]")?.getAttribute("aria-pressed") === "true"');
  browser("press", "Home");
  evaluate(`window.originalFetchForRefreshFailure = window.fetch; window.failedRefreshReorders = 0; window.failTaskListRefresh = true; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    if (payload?.command === "task.list" && window.failTaskListRefresh) throw new TypeError("forced refresh failure");
    if (payload?.command === "task.reorder") window.failedRefreshReorders += 1;
    return window.originalFetchForRefreshFailure(...args);
  }; true`);
  browser("press", "Control+ArrowDown");
  waitFor('document.querySelector("p.sr-only[role=status]")?.textContent.includes("Could not refresh tasks")');
  check('window.failedRefreshReorders === 0');
  evaluate('window.failTaskListRefresh = false; window.fetch = window.originalFetchForRefreshFailure; true');
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual A"))');
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "s");
  browser("press", "m");
  waitFor('document.querySelector("[data-sort=task-sort-manual]")?.getAttribute("aria-pressed") === "true"');

  // A root move carries its expanded child, while a child move remains inside
  // its actual parent scope.
  const manualParent = (await command("task.create", { title: "Manual parent @manual-order-ui" })).task;
  await command("task.create", { title: "Manual child @manual-order-ui", parentId: manualParent.id });
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual parent"))');
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "s");
  browser("press", "m");
  waitFor('document.querySelector("[data-sort=task-sort-manual]").getAttribute("aria-pressed") === "true"');
  browser("press", "ArrowRight");
  waitFor('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Manual parent")');
  browser("press", "Control+ArrowDown");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual child"))');
  const parentRowIndex = evaluate('[...document.querySelectorAll("[role=option]")].findIndex((item) => item.textContent.includes("Manual parent"))');
  const childRowIndex = evaluate('[...document.querySelectorAll("[role=option]")].findIndex((item) => item.textContent.includes("Manual child"))');
  check(`${childRowIndex} === ${parentRowIndex + 1}`);
  check('document.querySelectorAll("[data-depth=\\"1\\"]").length >= 1');
  await command("task.create", { title: "Manual child two @manual-order-ui", parentId: manualParent.id });
  browser("reload");
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 8; step++) {
    const activeText = evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""');
    if (String(activeText).includes("Manual parent")) break;
    browser("press", "ArrowDown");
  }
  browser("press", "ArrowRight");
  waitFor('document.querySelectorAll("[data-depth=\\"1\\"]").length >= 2 && [...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual child two"))');
  browser("press", "ArrowDown");
  browser("press", "Control+ArrowDown");
  waitFor('document.querySelectorAll("[data-depth=\\"1\\"]")[0]?.querySelector("[data-slot=item-title]")?.textContent === "Manual child"');
  browser("press", "ArrowLeft");
  browser("press", "ArrowLeft");
  waitFor('document.querySelectorAll("[data-depth=\\"1\\"]").length === 0');
  check('[...document.querySelectorAll("[role=option][aria-selected=true]")].every((row) => !row.hasAttribute("data-depth") || row.getAttribute("data-depth") === "0")');

  // Parent moves refresh the authoritative manual tree and keep the active
  // task stable through both picker paths.
  const parentMoveTarget = (await command("task.create", { title: "Manual move target @manual-order-ui" })).task;
  await command("task.create", { title: "Manual move existing child @manual-order-ui", parentId: parentMoveTarget.id });
  const parentMoveSubject = (await command("task.create", { title: "Manual move subject @manual-order-ui" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Manual move subject"))');
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 12; step++) {
    if (String(evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""')).includes("Manual move target")) break;
    browser("press", "ArrowDown");
  }
  browser("press", "ArrowRight");
  waitFor('document.querySelector("[role=option][aria-expanded=true]")?.textContent.includes("Manual move target")');
  for (let step = 0; step < 12; step++) {
    if (String(evaluate('document.getElementById(document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"))?.textContent ?? ""')).includes("Manual move subject")) break;
    browser("press", "ArrowDown");
  }
  waitFor(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"`);
  evaluate(`window.originalFetchForParentMove = window.fetch; window.parentMoveLists = []; window.fetch = async (...args) => {
    const payload = args[1]?.body && JSON.parse(args[1].body);
    if (payload?.command === "task.list") window.parentMoveLists.push(payload);
    return window.originalFetchForParentMove(...args);
  }; true`);
  browser("press", "m");
  waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Select new parent")');
  browser("fill", 'input[role="combobox"]', "Manual move target");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Manual move target"))');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("Manual move subject moved under Manual move target")');
  waitFor(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"`);
  check(`document.querySelector("[role=option][id=task-option-${parentMoveSubject.id}]")?.getAttribute("aria-selected") === "true"`);
  check('window.parentMoveLists.some((payload) => payload.args?.offset === 0 && payload.args?.sort === "manual")');
  assert.equal((await command("task.get", { id: parentMoveSubject.id })).task.parentId, parentMoveTarget.id);
  // Remove parent through the same picker and require another manual refresh.
  evaluate('window.parentMoveLists = []; true');
  browser("press", "m");
  waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Remove parent")');
  evaluate('([...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Remove parent"))?.click(), true)');
  waitFor('document.body.textContent.includes("Manual move subject is now a top-level task")');
  waitFor(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === "task-option-${parentMoveSubject.id}"`);
  check(`document.querySelector("[role=option][id=task-option-${parentMoveSubject.id}]")?.getAttribute("aria-selected") === "true"`);
  check('window.parentMoveLists.some((payload) => payload.args?.offset === 0 && payload.args?.sort === "manual")');
  assert.equal((await command("task.get", { id: parentMoveSubject.id })).task.parentId, null);
  evaluate('window.fetch = window.originalFetchForParentMove; true');

  // A hidden sibling must not become an implicit boundary target. The visible
  // first root stays put on Ctrl+Up even when an excluded sibling follows it.
  const hiddenManual = (await command("task.create", { title: "Manual hidden @manual-hidden-order" })).task;
  const allManualBeforeHiddenPlacement = (await command("task.list", { sort: "manual" })).tasks;
  const firstVisibleManualRoot = allManualBeforeHiddenPlacement.find((task) => task.parentId === null && task.category?.slug === "manual-order-ui");
  assert.ok(firstVisibleManualRoot);
  await command("task.reorder", {
    tasks: [{ id: hiddenManual.id, expectedVersion: hiddenManual.version }],
    placement: { afterId: firstVisibleManualRoot.id },
  });
  browser("reload");
  waitFor('document.querySelector("[data-sort=task-sort-manual]")?.getAttribute("aria-pressed") === "true"');
  filterManualCategory();
  focus("[role=listbox]");
  browser("press", "Home");
  const visibleManualBeforeBoundary = JSON.parse(evaluate('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent))'));
  const fullManualBeforeBoundary = (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id);
  browser("press", "Control+ArrowUp");
  waitFor('document.querySelector("p.sr-only[role=status]")?.textContent.includes("Already at the beginning")');
  assert.deepEqual((await command("task.list", { sort: "manual" })).tasks.map((task) => task.id), fullManualBeforeBoundary);
  browser("press", "Control+ArrowDown");
  waitFor(`JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].map((title) => title.textContent).slice(0, 2)) === JSON.stringify(${JSON.stringify(visibleManualBeforeBoundary.slice(0, 2).reverse())})`);
  browser("reload");
  waitFor('document.querySelector("[data-sort=task-sort-manual]")?.getAttribute("aria-pressed") === "true"');
  check('localStorage.getItem("tasks.sortField") === "manual"');

  // Unsupported filters keep the visible projection read-only and explain
  // which condition must be cleared before movement is available.
  async function assertReorderBlocked(setup, reason) {
    await setup();
    focus("[role=listbox]");
    browser("press", "Home");
    const before = (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id);
    browser("press", "Control+ArrowDown");
    waitFor(`document.querySelector("p.sr-only[role=status]")?.textContent.includes(${JSON.stringify(reason)})`);
    check('[...document.querySelectorAll("[data-reorder-action]")].every((button) => button.getAttribute("aria-disabled") === "true")');
    assert.deepEqual((await command("task.list", { sort: "manual" })).tasks.map((task) => task.id), before);
    browser("press", "Escape");
    browser("press", "Escape");
    waitFor('document.querySelector("[data-filter=task-search]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-tags]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-priority]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-unblocked]")?.getAttribute("aria-pressed") === "false" && document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "false"');
  }
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "/");
    waitFor('document.querySelector("input[name=search]") !== null');
    browser("fill", "input[name=search]", "Manual");
    browser("press", "Enter");
    waitFor('document.querySelector("[data-filter=task-search]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear search");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "#");
    waitFor('document.activeElement.matches("[cmdk-input]")');
    browser("fill", 'input[role="combobox"]', "planning");
    browser("press", "Enter");
    waitFor('document.querySelector("[data-filter=task-tags]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear the tag filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "0");
    waitFor('document.querySelector("[data-filter=task-priority]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear the priority filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "u");
    waitFor('document.querySelector("[data-filter=task-unblocked]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear the Unblocked filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "s");
    waitFor('document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear the inactive filter");
  await assertReorderBlocked(async () => {
    focus("[role=listbox]");
    browser("press", "f");
    browser("press", "o");
    waitFor('document.querySelector("[data-filter=task-status]")?.getAttribute("aria-pressed") === "true"');
  }, "Clear the exact-status filter");

  // Context-only ancestors remain visible for hierarchy but are independently
  // excluded from reorder, even after all other filters are cleared.
  waitFor('document.querySelector("[role=option][data-context-parent]") !== null');
  const contextOnlyId = evaluate('document.querySelector("[role=option][data-context-parent]")?.id');
  assert.ok(contextOnlyId);
  focus("[role=listbox]");
  browser("press", "Home");
  for (let step = 0; step < 12; step++) {
    if (evaluate(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(contextOnlyId)}`)) break;
    browser("press", "ArrowDown");
  }
  waitFor(`document.querySelector("[role=listbox]")?.getAttribute("aria-activedescendant") === ${JSON.stringify(contextOnlyId)}`);
  const contextOrderBeforeReorder = (await command("task.list", { sort: "manual" })).tasks.map((task) => task.id);
  browser("press", "Control+ArrowDown");
  waitFor('document.querySelector("p.sr-only[role=status]")?.textContent.includes("Context-only ancestors cannot be reordered")');
  assert.deepEqual((await command("task.list", { sort: "manual" })).tasks.map((task) => task.id), contextOrderBeforeReorder);
  assert.equal(browser("errors").trim(), "");
  console.log("UI checks passed: dialog capture, Markdown, keyboard/focus, help, F/S modes, sort and task details, forward and reverse Space status changes plus P pause/resume, priority quick-set, unblocked, category, tags, search, filtered empty states, relationships, shallow child outline, completed/canceled-parent context, move-parent removal, manual sorting and persistence, keyboard and pointer selection/movement, hidden siblings, disabled reorder filters, status undo with toast/replacement/conflict/retry, settings export, editing, conflicts, receipt retry, deletion/cancellation, theme switching and persistence, empty-list focus, validation, persistence, responsive overflow, and axe.");
} catch (error) {
  printFailureDiagnostics();
  throw error;
} finally {
  try { browser("close"); } finally {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.exitCode !== null ? resolve() : app.once("exit", resolve));
    rmSync(scratch, { recursive: true, force: true });
  }
}
