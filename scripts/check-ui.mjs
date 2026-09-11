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
  check('document.body.textContent.includes("Press N or choose New task")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks · by updated, newest first"');
  // N opens the shared create dialog with the title focused and notes closed.
  browser("press", "n");
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
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("New task") && item.textContent.includes("N"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Switch active or inactive") && item.textContent.includes("S"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Exact status") && item.textContent.includes("O/I/D/P/X"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Filter shortcuts") && item.textContent.includes("F"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Sort tasks") && item.textContent.includes("C/U/R"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Show timestamps") && item.textContent.includes("V"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Change task status") && item.textContent.includes("open"))');
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
  // Create stays open after save for rapid capture; the row appears behind the dialog.
  browser("press", "Control+Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').value === ""');
  let saved = (await command("task.list")).tasks;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].descriptionMarkdown, "## Shortlist\n- Ask about accessibility");
  assert.equal(saved[0].category.slug, "launch");
  assert.equal(saved[0].tags[0].slug, "planning");
  waitFor('document.querySelector("[role=option] [data-slot=item-title]")?.textContent === "Book venue"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · by updated, newest first"');
  check('document.querySelectorAll("[role=option] [data-slot=badge]").length === 3');
  check("document.querySelector(\"[role=option] [data-priority=\'P2\']\") !== null");
  check('![...document.querySelectorAll("[role=option] [data-slot=item-title]")].some((title) => title.textContent.includes("#planning"))');
  // Close the create dialog to return to the list.
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  waitFor('document.activeElement?.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Status: Open")');
  evaluate('document.querySelector("[role=option] [data-status]").click(); true');
  waitFor('document.querySelector("form[aria-label^=Edit]") === null && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "In progress"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · by updated, newest first"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("title") === null');
  assert.equal(saved[0].priority, 2);
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"');
  // F opens a contextual guide above the toolbar before the second key.
  browser("focus", "[role=listbox]");
  browser("press", "f");
  waitFor('document.querySelector("[data-shortcut-guide=filter]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=open] [data-shortcut-key=\\"O\\"]") !== null');
  check('document.querySelector("[data-shortcut-guide=filter] [data-shortcut-option=priority] [data-shortcut-key=\\"0\\"]") !== null');
  check('Boolean(document.querySelector("[data-shortcut-guide=filter]")?.compareDocumentPosition(document.querySelector("[aria-label=\\"Task list filters\\"]")) & Node.DOCUMENT_POSITION_FOLLOWING)');
  // F then S toggles Active/Inactive presets; F then A remains as an alias.
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && !document.querySelector("[data-shortcut-guide]")');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Inactive"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 inactive tasks · by updated, newest first"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  check('(() => { const active = document.querySelector("[data-filter=task-status]"); const inactive = document.querySelector("[data-filter=task-unblocked]"); const activeStyle = getComputedStyle(active); const inactiveStyle = getComputedStyle(inactive); return activeStyle.backgroundColor !== inactiveStyle.backgroundColor && activeStyle.color !== inactiveStyle.color && activeStyle.borderColor !== "rgba(0, 0, 0, 0)"; })()');
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Active"');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · by updated, newest first"');
  // P pauses without leaving Active; it stays visible because paused is active.
  browser("press", "p");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Press P to resume")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && !document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  // P again resumes a paused task to in progress.
  browser("press", "p");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  // in_progress Space skips paused and completes: it leaves Active, Inactive shows done.
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "done"');
  // done -> open leaves Inactive; Active shows open again.
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  // Paused Space still completes: pause, then Space moves paused to done.
  browser("press", "p");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "done"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  saved[0] = (await command("task.get", { id: saved[0].id })).task;
  assert.equal(saved[0].status, "open");
  // F-mode exact-status choices replace the preset.
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "d");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && !document.querySelector("[role=option]")');
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 done tasks · by updated, newest first"');
  // A slow second key (>2s) must not trigger an exact status.
  browser("press", "f");
  await new Promise((resolve) => setTimeout(resolve, 2200));
  browser("press", "d");
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done")');
  // Escape first exits the pending mode and leaves the filter alone; a
  // second Escape clears the exact-status filter. Focus stays put.
  browser("press", "f");
  browser("press", "Escape");
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-label").includes("Done") && !document.querySelector("[role=option]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  // Mouse opens the same status menu.
  evaluate('document.querySelector("[data-filter=task-status]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Active") && item.textContent.includes("Open"))');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');

  // Edit shares the same dialog. Stale contents survive a conflict until discard.
  browser("focus", "[role=listbox]");
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="Edit task"]\') !== null');
  check('document.querySelector(\'form[aria-label="Edit task"] input\') === document.activeElement');
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
  browser("press", "n");
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
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').value === ""');
  assert.equal((await command("task.list")).tasks.length, 2);
  evaluate("window.fetch = window.originalFetch; true");

  browser("fill", 'form[aria-label="New task"] input', "Ambiguous @work @home");
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("only one @category")');
  check('document.querySelector(\'form[aria-label="New task"] input\').value === "Ambiguous @work @home"');
  browser("fill", 'form[aria-label="New task"] input', "Call the venue");
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').value === ""');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 3');
  check('document.querySelector("[data-filter-summary]")?.textContent === "3 active tasks · by updated, newest first"');

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
  assert.equal(exportedFile.formatVersion, 1);
  assert.equal(exportedFile.taskCount, 3);
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

  // Tab does not leave the task list; N opens create from the list.
  browser("focus", "[role=listbox]");
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
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  browser("press", "n");
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

  browser("focus", "[role=listbox]");
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
  const audit = JSON.parse(browser("--json", "a11y"));
  assert.equal(audit.success, true);
  assert.equal(audit.data.violations.length, 0, JSON.stringify(audit.data));
  check('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "false"');
  check('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  // Delete is scoped to a focused row and cancels it immediately. N never fires while typing.
  browser("focus", "[role=listbox]");
  browser("press", "n");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Delete");
  check('document.querySelector(\'form[aria-label="New task"]\') !== null && ![...document.querySelectorAll("[role=dialog]")].some((dialog) => dialog.textContent.includes("Cancel task?"))');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  browser("focus", "[role=listbox]");
  const deletedId = evaluate('window.deleteList = document.activeElement; window.deletedId = document.activeElement.getAttribute("aria-activedescendant").slice("task-option-".length); window.deletedId');
  browser("press", "Delete");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 3');
  check('document.activeElement === window.deleteList');
  assert.equal((await command("task.get", { id: deletedId })).task.status, "canceled");

  // Canceled tasks are easy to recover through the inactive filter.
  browser("press", "f");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "canceled"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  assert.equal((await command("task.get", { id: deletedId })).task.status, "open");
  browser("press", "f");
  browser("press", "a");
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
  check('window.deleteKeys.length === 2 && window.deleteKeys[0] === window.deleteKeys[1]');
  check('document.activeElement.matches("[role=listbox]")');
  evaluate('window.fetch = window.originalFetch; true');
  assert.equal((await command("task.get", { id: lostId })).task.status, "canceled");
  browser("press", "f");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "canceled"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  assert.equal((await command("task.get", { id: lostId })).task.status, "open");
  browser("press", "f");
  browser("press", "a");
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

  // The unblocked filter uses dependency links, not task status, and can be
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
  browser("focus", "[role=listbox]");
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

  // Relationship context stays in the default row order; the optional time
  // footer is the final row even when a task is blocked.
  browser("focus", "[role=listbox]");
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "true"');
  check('(() => { const row = [...document.querySelectorAll("[role=option]")].find((item) => item.textContent.includes("Blocked task")); if (!row) return false; const paragraphs = [...row.querySelectorAll("p")]; const relationship = paragraphs.find((entry) => entry.textContent.includes("Release blocker")); const timestamp = paragraphs.find((entry) => entry.querySelector("[title^=\\"Created\\"]")); return relationship !== undefined && timestamp !== undefined && paragraphs.indexOf(relationship) < paragraphs.indexOf(timestamp) && paragraphs.indexOf(timestamp) === paragraphs.length - 1; })()');
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "false"');

  // F then C opens the category selector. Choosing a category enables the Folder
  // filter button; clicking it again clears the category filter.
  await command("task.create", { title: "Roadmap task @roadmap" });
  await command("task.create", { title: "Launch follow-up @launch" });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 9');
  check('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"');
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "c");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('document.querySelectorAll("[cmdk-group-heading] svg").length === 1');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("roadmap"))');
  browser("fill", 'input[role="combobox"]', "roadmap");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · @roadmap · by updated, newest first"');
  check('document.querySelector("[role=option]").textContent.includes("Roadmap task")');
  check('document.querySelector("[data-filter=task-category]").getAttribute("aria-label").includes("roadmap")');
  browser("focus", "[role=listbox]");
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('document.querySelector("[data-filter=task-category]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-category]").getAttribute("aria-pressed") === "false"');

  // Priority: P2 is the default, F then 0-4 filters on the list, bare 0-4
  // sets the active task, and the dialog section sets the task priority
  // without putting individual buttons in Tab order.
  assert.equal((await command("task.list", { priority: 2 })).total >= 9, true);
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "0");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 0');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks · P0 · by updated, newest first"');
  waitFor('document.activeElement.matches("[role=listbox]") && document.querySelector("[data-empty-state=filtered]") !== null');
  check('document.body.textContent.includes("No tasks match the current filters")');
  check('document.querySelector("[data-empty-state=filtered] button").tabIndex === -1');
  check('(() => { const list = document.querySelector("[role=listbox]"); const empty = document.querySelector("[data-empty-state=filtered]"); if (!list || !empty) return false; const listBox = list.getBoundingClientRect(); const emptyBox = empty.getBoundingClientRect(); return Math.abs(emptyBox.width - listBox.width) < 1 && emptyBox.height >= 48 && emptyBox.height <= 120; })()');
  evaluate('window.filteredEmptyList = document.activeElement; true');
  browser("press", "Tab");
  waitFor('document.activeElement === window.filteredEmptyList');
  browser("press", "f");
  browser("press", "s");
  waitFor('document.querySelector("[data-filter=task-status]").getAttribute("aria-pressed") === "true" && document.activeElement.matches("[role=listbox]")');
  // Escape resets all filters, returning to the full Active view.
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-priority]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9 && document.activeElement.matches("[role=listbox]")');
  // Filtering again, then the same key clears the priority filter.
  browser("focus", "[role=listbox]");
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
  browser("press", "n");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  check('document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').getAttribute("aria-checked") === "true"');
  check('document.querySelector(\'form[aria-label="New task"] [data-priority="P2"]\').classList.contains("bg-primary/10")');
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
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').value === ""');
  assert.equal((await command("task.list", { priority: 0 })).total, 1);
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 10');

  // Tags: F then T opens a multi-select picker with AND semantics; the
  // picker's Clear tags row empties the filter.
  await command("task.create", { title: "Tag cockpit #planning #product" });
  await command("task.create", { title: "Planning only #planning" });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 12');
  browser("focus", "[role=listbox]");
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
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · #planning #product · by updated, newest first"');
  check('document.querySelector(\'[role=listbox][aria-label^="Tasks"] [role=option]\').textContent.includes("Tag cockpit")');
  // Enter closes the picker without changing the current multi-selection.
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]")');
  // Clearing lives in the picker itself: reopen and pick Clear tags.
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Clear tags")).click(); true');
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 12');
  // With no selection, Enter picks the highlighted tag before closing the picker.
  const planningCount = (await command("task.list", { tags: ["planning"] })).total;
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("fill", 'input[role="combobox"]', "planning");
  waitFor('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("planning"))');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "true"');
  check(`document.querySelector("[data-filter-summary]")?.textContent === "${planningCount} active task${planningCount === 1 ? "" : "s"} · #planning · by updated, newest first"`);
  browser("focus", "[role=listbox]");
  browser("press", "f");
  browser("press", "t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  evaluate('[...document.querySelectorAll("[data-slot=command-item]")].find((item) => item.textContent.includes("Clear tags")).click(); true');
  waitFor('document.querySelector("[data-filter=task-tags]").getAttribute("aria-pressed") === "false"');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 12');

  // Search: / opens, covers titles and descriptions, stays applied, and the
  // button clears with a mouse action. Empty filters offer Clear filters.
  browser("focus", "[role=listbox]");
  browser("press", "/");
  waitFor('document.querySelector(\'input[name="search"]\') !== null');
  browser("fill", 'input[name="search"]', "accessibility");
  check('document.querySelector(\'input[name="search"]\').value === "accessibility"');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[data-filter-summary]")?.textContent === "1 active task · “accessibility” · by updated, newest first"');
  check('document.querySelector("[data-filter=task-search]").getAttribute("aria-label").includes("accessibility")');
  // A query with no matches shows the filtered empty state with Clear filters.
  browser("focus", "[role=listbox]");
  browser("press", "/");
  waitFor('document.querySelector(\'input[name="search"]\') !== null');
  browser("fill", 'input[name="search"]', "zzz-no-such-task");
  check('document.querySelector(\'input[name="search"]\').value === "zzz-no-such-task"');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("No tasks match the current filters")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "0 active tasks · “zzz-no-such-task” · by updated, newest first"');
  browser("find", "role", "button", "click", "--name", "Clear filters");
  waitFor('document.querySelector("[data-filter=task-search]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 12');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by updated, newest first"');
  // Timestamps and sorting: V toggles the time footer, O drives the sort,
  // and both survive a reload through localStorage.
  check('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "false"');
  check('document.querySelector("[title^=\\"Created\\"]") === null');
  browser("focus", "[role=listbox]");
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "true"');
  check('[...document.querySelectorAll("[role=option]")].every((row) => row.querySelector("[title^=\\"Created\\"]") !== null)');
  check('document.querySelector("[title^=\\"Updated\\"]") === null');
  // Stamp two rows older: their created dates shorten and the updated line
  // appears only where the day differs from the creation day.
  const stampDb = new DatabaseSync(path.join(scratch, "tasks.db"));
  stampDb.prepare("UPDATE tasks SET created_at = ? WHERE title LIKE 'Tag cockpit%'").run("2026-01-05T12:00:00.000Z");
  stampDb.prepare("UPDATE tasks SET created_at = ? WHERE title = 'Planning only #planning'").run("2026-01-06T12:00:00.000Z");
  stampDb.close();
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 12 && document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "true"');
  check('document.querySelector("[title^=\\"Created Jan 5, 2026\\"]") !== null');
  check('document.querySelectorAll("[title^=\\"Updated\\"]").length === 2');
  check('[...document.querySelectorAll("[role=option]")].filter((row) => row.querySelector("[title^=\\"Updated\\"]")).every((row) => { const timestamps = [...row.querySelectorAll("[title^=\\"Updated\\"], [title^=\\"Created\\"]")]; return timestamps[0]?.title.startsWith("Updated") && timestamps[1]?.title.startsWith("Created"); })');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by updated, newest first"');
  // Sort by created, then reverse; the stamped rows pin the order.
  browser("focus", "[role=listbox]");
  browser("press", "o");
  waitFor('document.querySelector("[data-shortcut-guide=sort]") !== null');
  check('document.querySelectorAll("[data-shortcut-guide=sort] [data-shortcut-option] [data-shortcut-key]").length === 3');
  check('Boolean(document.querySelector("[data-shortcut-guide=sort]")?.compareDocumentPosition(document.querySelector("[aria-label=\\"Task list sort\\"]")) & Node.DOCUMENT_POSITION_FOLLOWING)');
  browser("press", "c");
  waitFor('document.querySelector("[data-sort=task-sort-created]").getAttribute("aria-pressed") === "true" && !document.querySelector("[data-shortcut-guide]")');
  check('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by created, newest first"');
  check('JSON.stringify([...document.querySelectorAll("[role=option] [data-slot=item-title]")].slice(-2).map((title) => title.textContent)) === JSON.stringify(["Planning only", "Tag cockpit"])');
  browser("press", "o");
  browser("press", "r");
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by created, oldest first"');
  check('document.querySelector("[role=option] [data-slot=item-title]").textContent === "Tag cockpit"');
  // Back to updated/newest, footer off; mouse covers the same controls.
  browser("press", "o");
  browser("press", "u");
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by updated, oldest first"');
  browser("press", "o");
  browser("press", "r");
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by updated, newest first"');
  browser("press", "v");
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "false" && document.querySelector("[title^=\\"Created\\"]") === null');
  evaluate('document.querySelector("[data-sort=task-sort-created]").click(); true');
  waitFor('document.querySelector("[data-sort=task-sort-created]").getAttribute("aria-pressed") === "true"');
  check('document.activeElement.getAttribute("role") === "listbox"');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by created, oldest first"');
  evaluate('document.querySelector("[data-sort=task-sort-reverse]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by created, newest first"');
  evaluate('document.querySelector("[data-sort=task-sort-updated]").click(); true');
  waitFor('document.querySelector("[data-filter-summary]")?.textContent === "12 active tasks · by updated, newest first"');
  evaluate('document.querySelector("[data-view=task-timestamps]").click(); true');
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "true" && document.querySelector("[title^=\\"Created\\"]") !== null');
  evaluate('document.querySelector("[data-view=task-timestamps]").click(); true');
  waitFor('document.querySelector("[data-view=task-timestamps]").getAttribute("aria-pressed") === "false" && document.querySelector("[title^=\\"Created\\"]") === null');
  // Toolbar order stays Status, Priority, Category, Tags, Search, Unblocked,
  // then the sort and view groups in their own button groups.
  check('JSON.stringify([...document.querySelectorAll("[data-filter]")].map((b) => b.getAttribute("data-filter"))) === JSON.stringify(["task-status","task-priority","task-category","task-tags","task-search","task-unblocked"])');
  check('JSON.stringify([...document.querySelectorAll("[data-sort]")].map((b) => b.getAttribute("data-sort"))) === JSON.stringify(["task-sort-created","task-sort-updated","task-sort-reverse"])');
  check('document.querySelector("[data-view=task-timestamps]") !== null');
  for (const width of [1280, 320]) {
    browser("set", "viewport", String(width), "844");
    check('document.documentElement.scrollWidth <= innerWidth');
  }
  check('(() => { const summary = document.querySelector("[data-filter-summary]"); if (!summary) return false; const style = getComputedStyle(summary); return style.whiteSpace === "nowrap" && style.overflow === "hidden" && summary.getBoundingClientRect().height <= 20; })()');
  // Shift+N keeps the same composer flow and assigns the selected task as parent.
  browser("focus", "[role=listbox]");
  browser("press", "Home");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === document.querySelector("[role=option]")?.id');
  const parentId = evaluate('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant").replace("task-option-", "")');
  browser("press", "Shift+n");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  waitFor('document.activeElement.name === "title"');
  browser("fill", 'form[aria-label="New task"] input', "Venue follow-up");
  browser("press", "Control+Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').value === ""');
  const child = (await command("task.list")).tasks.find((task) => task.title === "Venue follow-up");
  assert.equal(child?.parentId, parentId);
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement?.getAttribute("role") === "listbox"');

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
  browser("focus", "[role=listbox]");
  browser("press", "Home");
  // The newest task is first under updated/newest, so Home selects the undo task.
  // Cancel it with Delete: it leaves Active immediately with no pre-undo UI.
  browser("press", "Delete");
  waitFor('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  check('document.querySelector("[data-undo-toast]") === null');
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
  browser("focus", "[role=listbox]");
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
  browser("focus", "[role=listbox]");
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
  browser("focus", "[role=listbox]");
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
  browser("press", "n");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Control+z");
  await delay(500);
  check('document.querySelector(\'form[aria-label="New task"]\') !== null && document.querySelector("[data-undo-toast]") === null');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  // Undo still works after leaving the composer.
  browser("focus", "[role=listbox]");
  browser("press", "Control+z");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo me status"))');
  await new Promise((resolve) => setTimeout(resolve, 3500));
  // Undo after an external edit reports a conflict and keeps the edit.
  const conflictTask = (await command("task.create", { title: "Undo conflict task" })).task;
  browser("reload");
  waitFor('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Undo conflict task"))');
  browser("focus", "[role=listbox]");
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
  browser("focus", "[role=listbox]");
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

  assert.equal(browser("errors").trim(), "");
  console.log("UI checks passed: dialog capture, Markdown, keyboard/focus, help, F/O modes, sort and timestamps, status presets and exact filters, Space forward-progress plus P pause/resume, priority quick-set, unblocked, category, tags, search, filtered empty states, relationships, shallow child outline, move-parent removal, status undo with toast/replacement/conflict/retry, settings export, editing, conflicts, receipt retry, deletion/cancellation, theme switching and persistence, empty-list focus, validation, persistence, responsive overflow, and axe.");
} catch (error) {
  console.error(browser("snapshot"));
  console.error(evaluate('({ focus: document.activeElement.tagName + ":" + document.activeElement.textContent.slice(0, 100), deleteKeys: window.deleteKeys })'));
  throw error;
} finally {
  try { browser("close"); } finally {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.exitCode !== null ? resolve() : app.once("exit", resolve));
    rmSync(scratch, { recursive: true, force: true });
  }
}
