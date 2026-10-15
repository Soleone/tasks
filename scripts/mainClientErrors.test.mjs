import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build, transformSync } from "esbuild";

const compiled = await build({
  stdin: { contents: `export {BackendCommandError} from './src/platform/backendClient'; export {EditorError} from './src/platform/editorClient';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false, define: { "import.meta.env": "{}" },
});
const { BackendCommandError, EditorError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

// Execute the real catch blocks with inert UI callbacks. This checks error
// handling only, not rendering, focus, request execution or native acceptance.
function failureHandler(file, functionName, bindings) {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`  async function ${functionName}(`);
  assert.ok(start >= 0, `${file}: ${functionName} missing`);
  // These handlers use the component's four-space catch indentation.
  const handler = source.slice(start).match(/} catch \(caught\) \{\n([\s\S]*?)\n    }/);
  assert.ok(handler, `${file}: ${functionName} catch block missing`);
  const body = transformSync(handler[1], { loader: "ts", target: "esnext" }).code;
  const execute = new Function("caught", ...Object.keys(bindings), body);
  return caught => execute(caught, ...Object.values(bindings));
}

const undoSource = "src/App.tsx";
const deleteSource = "src/components/TaskList.tsx";
for (const ErrorClass of [BackendCommandError, EditorError]) {
  for (const code of ["STALE_TASK_VERSION", "TASK_NOT_FOUND"]) {
    test(`undo retires ${ErrorClass.name} ${code}`, () => {
      const events = [];
      const bindings = {
        BackendCommandError, EditorError, entry: { title: "Task" },
        retireUndo: () => events.push("retire"),
        setExitingTaskIds: ids => events.push([...ids]),
        setAnnouncement: text => events.push(text),
        refreshTasks: () => events.push("refresh"),
      };
      failureHandler(undoSource, "handleUndoStatus", bindings)(new ErrorClass(code, "Failure"));
      assert.deepEqual(events, ["retire", [], "Task changed elsewhere. Undo is no longer available.", "refresh"]);
    });
  }
  test(`delete refreshes ${ErrorClass.name} stale failure`, () => {
    const events = [];
    const bindings = {
      BackendCommandError, EditorError, task: { title: "Task" },
      onAnnounce: text => events.push(text), onRefresh: () => events.push("refresh"),
    };
    failureHandler(deleteSource, "deleteTaskRecord", bindings)(new ErrorClass("STALE_TASK_VERSION", "Failure"));
    assert.deepEqual(events, ["Task changed elsewhere. Refresh and try again.", "refresh"]);
  });
}

for (const error of [new EditorError("INVALID_STORAGE", "Preserve request"), new Error("Lost reply")]) {
  test(`undo and delete keep other failures on their existing path: ${error.message}`, () => {
    const events = [];
    const bindings = {
      BackendCommandError, EditorError, entry: { title: "Task" }, task: { title: "Task" },
      retireUndo: () => events.push("retire"), setExitingTaskIds: () => events.push("exit"),
      setAnnouncement: text => events.push(text), refreshTasks: () => events.push("refresh"),
      onAnnounce: text => events.push(text), onRefresh: () => events.push("refresh"),
    };
    failureHandler(undoSource, "handleUndoStatus", bindings)(error);
    failureHandler(deleteSource, "deleteTaskRecord", bindings)(error);
    assert.deepEqual(events, [error.message, `Could not cancel Task: ${error.message}`]);
  });
}
