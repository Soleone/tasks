import assert from "node:assert/strict";
import { test } from "node:test";
import { listAndroidSyncConflicts } from "../src/legacy/platform/androidSyncConflicts.ts";

const file = (relativePath) => ({ relativePath, content: "{}", modifiedAt: null });

test("lists realistic Syncthing conflict copies for canonical workspace files", () => {
  const conflicts = listAndroidSyncConflicts([
    file("tasks/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141530-AB12CDE.json"),
    file("order/root.sync-conflict-20260920-141531-AB12CDE.json"),
    file("order/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141532-AB12CDE.json"),
    file("workspace.sync-conflict-20260920-141533-AB12CDE.json"),
  ]);

  assert.deepEqual(conflicts, [
    {
      id: 1,
      canonicalPath: "order/550e8400-e29b-41d4-a716-446655440000.json",
      sourcePath:
        "order/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141532-AB12CDE.json",
      kind: "order",
      status: "unresolved",
      resolutionSupported: false,
    },
    {
      id: 2,
      canonicalPath: "order/root.json",
      sourcePath: "order/root.sync-conflict-20260920-141531-AB12CDE.json",
      kind: "order",
      status: "unresolved",
      resolutionSupported: false,
    },
    {
      id: 3,
      canonicalPath: "tasks/550e8400-e29b-41d4-a716-446655440000.json",
      sourcePath:
        "tasks/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141530-AB12CDE.json",
      kind: "task",
      status: "unresolved",
      resolutionSupported: false,
    },
    {
      id: 4,
      canonicalPath: "workspace.json",
      sourcePath: "workspace.sync-conflict-20260920-141533-AB12CDE.json",
      kind: "workspace",
      status: "unresolved",
      resolutionSupported: false,
    },
  ]);
});

test("does not report canonical files, unrelated JSON, or malformed conflict names", () => {
  assert.deepEqual(
    listAndroidSyncConflicts([
      file("workspace.json"),
      file("tasks/550e8400-e29b-41d4-a716-446655440000.json"),
      file("tasks/550e8400-e29b-41d4-a716-446655440000.sync-conflict-tablet.json"),
      file("tasks/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141530-AB12CDE.txt"),
      file("notes/550e8400-e29b-41d4-a716-446655440000.sync-conflict-20260920-141530-AB12CDE.json"),
    ]),
    [],
  );
});
