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
  waitFor('document.activeElement.name === "title"');
  check('document.querySelector("textarea") === null');
  browser("press", "Tab");
  waitFor('document.activeElement.matches("section[aria-label=\\"Saved tasks\\"]")');
  browser("focus", 'input[name=title]');
  browser("find", "role", "button", "click", "--name", "Add description");
  waitFor('document.activeElement.name === "description"');
  browser("click", 'input[name=title]');
  waitFor('document.activeElement.name === "title" && document.querySelector("textarea") === null');
  browser("press", "Enter");
  waitFor('document.querySelector("input[name=title]").getAttribute("aria-invalid") === "true"');
  browser("fill", 'input[name=title]', "Book venue @launch #planning");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.name === "title" && document.querySelector("textarea") === null');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("fill", 'textarea[name=description]', "## Shortlist");
  browser("press", "Enter");
  browser("keyboard", "inserttext", "- Ask about accessibility");
  assert.equal((await command("task.list")).tasks.length, 0);
  browser("press", "Shift+Tab");
  check('document.activeElement.name === "title"');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Control+k");
  waitFor('document.activeElement.matches("[cmdk-input]")');
  check('[...document.querySelectorAll("[data-slot=command-item]")].some((item) => item.textContent.includes("Switch active or inactive") && item.textContent.includes("A"))');
  browser("fill", 'input[role="combobox"]', "@category");
  waitFor('document.querySelectorAll("[data-slot=command-item]").length === 1');
  check('document.querySelector("[data-slot=command-item]").textContent.includes("One per task")');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  check('document.activeElement.name === "title" && document.querySelector("textarea").value.includes("accessibility")');
  browser("press", "Control+Enter");
  waitFor('document.activeElement.name === "title" && document.activeElement.value === ""');
  let saved = (await command("task.list")).tasks;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].descriptionMarkdown, "## Shortlist\n- Ask about accessibility");
  assert.equal(saved[0].category.slug, "launch");
  assert.equal(saved[0].tags[0].slug, "planning");
  waitFor('document.querySelector("[role=option] [data-slot=item-title]")?.textContent === "Book venue"');
  check('document.querySelectorAll("[role=option] [data-slot=badge]").length === 2');
  check('![...document.querySelectorAll("[role=option] [data-slot=item-title]")].some((title) => title.textContent.includes("#planning"))');
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
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Inactive tasks"');
  check('document.querySelector("[data-slot=tooltip-content]").getAttribute("data-side") === "top"');
  waitFor('!document.querySelector("[role=option]")');
  browser("press", "a");
  waitFor('document.querySelector("[data-filter=task-activity]").getAttribute("aria-pressed") === "false" && document.querySelector("[role=option] [data-status]").getAttribute("data-status") === "in_progress"');
  waitFor('document.querySelector("[data-slot=tooltip-content]")?.textContent === "Active tasks"');
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

  // Keep a capture draft while editing, and retain stale editor contents after refresh.
  browser("fill", 'input[name=title]', "Next capture draft");
  evaluate('document.querySelector("[role=option]").click(); true');
  waitFor('document.querySelector("form[aria-label^=Edit]") !== null');
  check('document.querySelector("section") === null');
  browser("fill", 'form[aria-label="Edit task"] input', "My unsaved title");
  await command("task.update", { id: saved[0].id, expectedVersion: saved[0].version, title: "Agent updated title", descriptionMarkdown: saved[0].descriptionMarkdown });
  evaluate('window.dispatchEvent(new Event("focus")); true');
  browser("press", "Control+Enter");
  waitFor('document.body.textContent.includes("This task changed elsewhere")');
  check('document.querySelector("form[aria-label^=Edit] input").value === "My unsaved title"');
  browser("find", "role", "button", "click", "--name", "Discard changes");
  waitFor('document.activeElement.name === "title" && document.activeElement.value === "Next capture draft"');

  // Simulate commit-before-lost-reply. Retrying must not duplicate the task.
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
  check('document.querySelector("input[name=title]").value === "Next capture draft"');
  browser("press", "Enter");
  waitFor('document.activeElement.value === ""');
  assert.equal((await command("task.list")).tasks.length, 2);
  evaluate("window.fetch = window.originalFetch; true");

  browser("fill", 'input[name=title]', "Ambiguous @work @home");
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("only one @category")');
  check('document.activeElement.value === "Ambiguous @work @home"');
  browser("fill", 'input[name=title]', "Call the venue");
  browser("press", "Enter");
  waitFor('document.activeElement.value === ""');
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
  waitFor('getComputedStyle(document.querySelector("form button[type=submit]")).backgroundColor === "rgb(125, 174, 163)"');
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
  waitFor('getComputedStyle(document.querySelector("form button[type=submit]")).backgroundColor === "rgb(194, 65, 12)"');
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
  browser("focus", 'input[name=title]');

  // Empty title skips description and goes to the list; filled title reveals it.
  browser("press", "Tab");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  check('document.activeElement.tagName !== "BUTTON"');
  check('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== null');
  check('document.querySelectorAll("[role=option][aria-selected=true]").length === 1');
  evaluate('window.beforeNav = document.querySelector("[role=listbox]").getAttribute("aria-activedescendant"); true');
  browser("press", "ArrowDown");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") !== window.beforeNav');
  browser("press", "ArrowUp");
  waitFor('document.querySelector("[role=listbox]").getAttribute("aria-activedescendant") === window.beforeNav');
  browser("press", "Tab");
  waitFor('document.activeElement.name === "title"');
  check('document.querySelector("[role=option][aria-selected=true]") === null');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  browser("press", "Shift+Tab");
  waitFor('document.activeElement.name === "title"');
  browser("fill", 'input[name=title]', "Keyboard navigation");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Tab");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "title"');
  check('document.querySelector("[role=option][aria-selected=true]") === null');
  // Enter on the list opens the highlighted task.
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Tab");
  waitFor('document.activeElement.getAttribute("role") === "listbox"');
  browser("press", "Enter");
  waitFor('document.querySelector("form[aria-label^=Edit]") !== null');
  // Esc from the edit title goes back to the list.
  waitFor('document.querySelector(\'form[aria-label="Edit task"] input\') === document.activeElement');
  browser("press", "Escape");
  waitFor('document.querySelectorAll("[role=option]").length === 3 && document.activeElement.name === "title"');
  // Leave capture notes closed so the edit flow below starts from the same state as before.
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  waitFor('document.activeElement.name === "title" && document.querySelector("textarea") === null');

  evaluate('[...document.querySelectorAll("[role=option]")].find((entry) => entry.textContent.includes("Call the venue")).click(); true');
  browser("fill", 'form[aria-label="Edit task"] input', "Confirm the venue");
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
  browser("press", "Escape");
  check('document.activeElement.name === "title" && document.querySelector("textarea") === null');
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
  // Delete is scoped to a focused row, never the capture input, and marks it cancelled.
  browser("focus", "input[name=title]");
  browser("press", "Delete");
  check('document.querySelector("[role=dialog]") === null');
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
  check('document.activeElement.name === "title"');
  assert.equal((await command("task.list")).total, 4);
  assert.equal(browser("errors").trim(), "");
  console.log("UI checks passed: capture, Markdown, keyboard/focus, help, active/inactive filtering, settings export, editing, conflicts, receipt retry, deletion/cancellation, theme switching and persistence, empty-list focus, validation, persistence, responsive overflow, and axe.");
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
