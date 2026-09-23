import assert from "node:assert/strict";
import { test } from "node:test";
import { filesToRecover } from "../src/platform/androidPendingWrite.ts";

const pending = {
  files: [
    { relativePath: "tasks/new.json", previousContent: null, content: "new task" },
    { relativePath: "order/root.json", previousContent: "old order", content: "new order" },
  ],
};
const file = (relativePath, content) => ({ relativePath, content, modifiedAt: null });

test("recovery writes missing or partially written files without changing verified files", () => {
  assert.deepEqual(filesToRecover(pending, [file("order/root.json", "old order")]), pending.files);
  assert.deepEqual(filesToRecover(pending, [file("tasks/new.json", "new"), file("order/root.json", "new order")]), [pending.files[0]]);
  assert.deepEqual(filesToRecover(pending, [file("tasks/new.json", "new task"), file("order/root.json", "new order")]), []);
});

test("recovery completes a staged task or order deletion only when the original file is unchanged", () => {
  for (const [relativePath, originalContent, editedContent] of [
    ["tasks/old.json", "old task", "edited task"],
    ["order/old-parent.json", "old order", "edited order"],
  ]) {
    const deletion = { files: [{ relativePath, previousContent: originalContent, content: null }] };
    assert.deepEqual(filesToRecover(deletion, [file(relativePath, originalContent)]), deletion.files);
    assert.deepEqual(filesToRecover(deletion, []), []);
    assert.throws(() => filesToRecover(deletion, [file(relativePath, editedContent)]), /changed/);
  }
});

test("recovery refuses a concurrent edit instead of overwriting it", () => {
  assert.throws(() => filesToRecover(pending, [file("tasks/new.json", "other task")]), /tasks\/new.json changed/);
  assert.throws(() => filesToRecover(pending, [file("order/root.json", "other order")]), /order\/root.json changed/);
});
