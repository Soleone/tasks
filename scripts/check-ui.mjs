import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
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
    headers: { "content-type": "application/json" },
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
  // C opens the shared create dialog with the title focused and notes closed.
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  waitFor('document.activeElement.name === "title"');
  check('document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  browser("press", "Tab");
  waitFor('document.activeElement?.textContent?.includes("Add description")');
  browser("press", "Enter");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "title" && document.querySelector(\'form[aria-label="New task"] textarea\') === null');
  browser("press", "Enter");
  waitFor('document.querySelector(\'form[aria-label="New task"] input\').getAttribute("aria-invalid") === "true"');
  browser("fill", 'form[aria-label="New task"] input', "Book venue @launch #planning");
  browser("press", "Tab");
  waitFor('document.activeElement?.textContent?.includes("Add description")');
  browser("press", "Enter");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.name === "title"');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("fill", 'form[aria-label="New task"] textarea', "## Shortlist");
  browser("press", "Enter");
  browser("keyboard", "inserttext", "- Ask about accessibility");
  assert.equal((await command("task.list")).tasks.length, 0);
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("New task") && item.textContent.includes("C"))');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Switch active or inactive") && item.textContent.includes("A"))');
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
  check('document.querySelectorAll("[role=option] [data-slot=badge]").length === 2');
  check('![...document.querySelectorAll("[role=option] [data-slot=item-title]")].some((title) => title.textContent.includes("#planning"))');
  // Close the create dialog to return to the list.
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  waitFor('document.activeElement?.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("aria-label").includes("Status: Open")');
  evaluate('document.querySelector("[role=option] [data-status]").click(); true');
  waitFor('document.querySelector("form[aria-label^=Edit]") === null && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "In progress"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  check('document.querySelector("[role=option] [data-status]").getAttribute("title") === null');
  check('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false"');
  browser("focus", "[role=listbox]");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "true"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Inactive"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Active"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "true" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "paused"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "done"');
  browser("press", "Space");
  waitFor('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "open"');
  saved[0] = (await command("task.get", { id: saved[0].id })).task;
  assert.equal(saved[0].status, "open");

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

  // A light palette drops the dark class, and a file beside the database joins the picker.
  writeFileSync(path.join(scratch, "themes", "sunset.toml"), 'mode = "light"\naccent = "#c2410c"\nbackground = "#fff7ed"\ndark_background = "#ffedd5"\nforeground = "#431407"\n');
  browser("press", "Alt+t");
  waitFor('document.activeElement.matches("[cmdk-input]")');
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

  // Tab cycles New task and the list; C opens create from the list.
  browser("focus", "[role=listbox]");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== null');
  check('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  evaluate('window.beforeNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeNav');
  browser("press", "ArrowUp");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === window.beforeNav');
  browser("press", "Tab");
  waitFor('document.activeElement?.textContent?.includes("New task")');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
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

  browser("focus", "[role=listbox]");
  evaluate('[...document.querySelectorAll("[role=option]")].find((entry) => entry.textContent.includes("Call the venue")).click(); true');
  waitFor('document.querySelector(\'form[aria-label="Edit task"]\') !== null');
  browser("fill", 'form[aria-label="Edit task"] input', "Confirm the venue");
  browser("press", "Enter");
  waitFor('document.querySelector("form[aria-label^=Edit]") === null');
  assert.ok((await command("task.list")).tasks.some((task) => task.title === "Confirm the venue"));

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
  check('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false"');
  check('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false"');
  // Delete is scoped to a focused row and marks it cancelled. C never fires while typing.
  browser("focus", "[role=listbox]");
  browser("press", "c");
  waitFor('document.querySelector(\'form[aria-label="New task"]\') !== null');
  browser("press", "Delete");
  check('document.querySelector(\'form[aria-label="New task"]\') !== null && !document.body.textContent.includes("Cancel task?")');
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]")');
  browser("focus", "[role=listbox]");
  evaluate('window.deleteList = document.activeElement; true');
  browser("press", "Delete");
  waitFor('document.activeElement.textContent === "Cancel task"');
  const dialogAudit = JSON.parse(browser("--json", "a11y"));
  assert.equal(dialogAudit.data.violations.length, 0, JSON.stringify(dialogAudit.data));
  for (const width of [1280, 320]) {
    browser("set", "viewport", String(width), "844");
    check('document.documentElement.scrollWidth <= innerWidth');
    browser("screenshot", path.join(tmpdir(), `tasks-delete-dialog-${width}.png`));
  }
  browser("press", "Escape");
  waitFor('document.activeElement === window.deleteList && !document.querySelector("[role=dialog]")');
  assert.equal((await command("task.list")).tasks.length, 4);

  // Keep the original version while confirmation is open, even across a refresh.
  const deletingId = evaluate('window.deleteList.getAttribute("aria-activedescendant").slice("task-option-".length)');
  const deletingTask = (await command("task.get", { id: deletingId })).task;
  browser("press", "Delete");
  waitFor('document.activeElement.textContent === "Cancel task"');
  await command("task.update", { id: deletingId, expectedVersion: deletingTask.version, title: "Changed before delete" });
  evaluate('window.dispatchEvent(new Event("focus")); true');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("This task changed elsewhere")');
  assert.equal((await command("task.list")).tasks.length, 4);
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement === window.deleteList');

  // A committed cancellation with a lost reply can be confirmed again safely.
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
  waitFor('document.activeElement.textContent === "Cancel task"');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("Could not cancel task")');
  check('document.activeElement.textContent === "Cancel task"');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 3');
  check('window.deleteKeys.length === 2 && window.deleteKeys[0] === window.deleteKeys[1]');
  check('document.activeElement.matches("[role=listbox]")');
  evaluate('window.fetch = window.originalFetch; true');
  assert.equal((await command("task.get", { id: deletingId })).task.status, "canceled");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "canceled"');
  browser("press", "Space");
  waitFor('!document.querySelector("[role=option]")');
  assert.equal((await command("task.get", { id: deletingId })).task.status, "open");
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 4');
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
  // toggled from the focused list with U.
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
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "true"');
  waitFor('document.querySelectorAll("[role=option]").length === 6');
  check('![...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Blocked task"))');
  check('[...document.querySelectorAll("[role=option]")].some((item) => item.textContent.includes("Release blocker"))');
  browser("press", "u");
  waitFor('document.querySelector("[data-filter=task-unblocked]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 7');
  assert.equal((await command("task.list", { unblocked: true })).total, 8);

  // P opens the project selector. Choosing a project enables the Folder
  // filter button; clicking it again clears the project filter.
  await command("task.create", { title: "Roadmap task @roadmap" });
  await command("task.create", { title: "Launch follow-up @launch" });
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 9');
  check('document.querySelector("[data-filter=task-project]").getAttribute("aria-pressed") === "false"');
  browser("focus", "[role=listbox]");
  browser("press", "p");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("roadmap"))');
  browser("fill", 'input[role="combobox"]', "roadmap");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  browser("press", "Enter");
  waitFor('document.querySelector("[data-filter=task-project]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[role=option]").length === 1');
  check('document.querySelector("[role=option]").textContent.includes("Roadmap task")');
  check('document.querySelector("[data-filter=task-project]").getAttribute("aria-label").includes("roadmap")');
  evaluate('document.querySelector("[data-filter=task-project]").click(); true');
  waitFor('document.querySelector("[data-filter=task-project]").getAttribute("aria-pressed") === "false" && document.querySelectorAll("[role=option]").length === 9');
  evaluate('document.querySelector("[data-filter=task-project]").click(); true');
  waitFor('document.activeElement.matches("[cmdk-input]")');
  browser("press", "Escape");
  waitFor('document.querySelector("[data-filter=task-project]").getAttribute("aria-pressed") === "false"');
  assert.equal(browser("errors").trim(), "");
  console.log("UI checks passed: dialog capture, Markdown, keyboard/focus, help, active/inactive, unblocked and project filtering, relationships, shallow child outline, settings export, editing, conflicts, receipt retry, deletion/cancellation, theme switching and persistence, empty-list focus, validation, persistence, responsive overflow, and axe.");
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
