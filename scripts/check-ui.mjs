import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Requires agent-browser with Linux Chromium installed. All writes use a scratch database.
const root = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-ui-check-"));
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

  // Severe tab control: title -> description -> list -> title, arrows move in the list.
  browser("press", "Tab");
  waitFor('document.activeElement.name === "description"');
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
  // Delete is scoped to a focused row, never the capture input.
  browser("focus", "input[name=title]");
  browser("press", "Delete");
  check('document.querySelector("[role=dialog]") === null');
  browser("focus", "[role=listbox]");
  evaluate('window.deleteList = document.activeElement; true');
  browser("press", "Delete");
  waitFor('document.activeElement.textContent === "Delete task"');
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
  waitFor('document.activeElement.textContent === "Delete task"');
  await command("task.update", { id: deletingId, expectedVersion: deletingTask.version, title: "Changed before delete" });
  evaluate('window.dispatchEvent(new Event("focus")); true');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("This task changed elsewhere")');
  assert.equal((await command("task.list")).tasks.length, 4);
  browser("press", "Escape");
  waitFor('!document.querySelector("[role=dialog]") && document.activeElement === window.deleteList');

  // A committed delete with a lost reply can be confirmed again safely.
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
  waitFor('document.activeElement.textContent === "Delete task"');
  browser("press", "Enter");
  waitFor('document.body.textContent.includes("Could not delete task")');
  check('document.activeElement.textContent === "Delete task"');
  browser("press", "Enter");
  waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === 3');
  check('window.deleteKeys.length === 2 && window.deleteKeys[0] === window.deleteKeys[1]');
  check('document.activeElement.matches("[role=listbox]")');
  evaluate('window.fetch = window.originalFetch; true');
  assert.ok(!(await command("task.list")).tasks.some((task) => task.id === deletingId));
  browser("reload");
  waitFor('document.querySelectorAll("[role=option]").length === 3');
  for (let remaining = 3; remaining > 0; remaining--) {
    browser("focus", "[role=listbox]");
    browser("press", "Delete");
    waitFor('document.activeElement.textContent === "Delete task"');
    browser("press", "Enter");
    waitFor(`!document.querySelector("[role=dialog]") && document.querySelectorAll("[role=option]").length === ${remaining - 1}`);
  }
  waitFor('document.body.textContent.includes("No tasks yet")');
  check('document.activeElement.matches("section[aria-label=\\"Saved tasks\\"]")');
  assert.equal((await command("task.list")).total, 0);
  assert.equal(browser("errors").trim(), "");
  console.log("UI checks passed: capture, Markdown, keyboard/focus, help, editing, conflicts, receipt retry, deletion/cancellation, empty-list focus, validation, persistence, responsive overflow, and axe.");
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
