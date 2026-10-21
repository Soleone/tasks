import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { readCanonicalRoot } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { executeLine } from "./gateway.js";
import type { Response } from "./protocol.js";
import { observeQueryAuthority, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
function setup(t: TestContext): { root: string; cache: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-authority-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { root, cache: path.join(directory, "cache.db") };
}

function request(root: string, cache: string, command: string): Response {
  return executeLine(Buffer.from(JSON.stringify({ version: 2, command })), root, cache);
}

test("query context and versions persist across cache reopen; complete cache loss rotates authority", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const second = observeQueryAuthority(cache, readCanonicalRoot(root), readCanonicalRoot(root));
  assert.deepEqual(second, first);
  rmSync(cache);
  const lost = observeQueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(lost.writeContext, first.writeContext);
  assert.deepEqual(readCanonicalRoot(root).files, snapshot.files);
});

test("auth.fresh-context: a copied or replaced cache is refused, never wiped or adopted", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const copy = `${cache}.copy`;
  cpSync(cache, copy);
  assert.throws(() => observeQueryAuthority(copy, snapshot, snapshot), {
    code: "CACHE_FROM_ELSEWHERE",
  });
  assert.deepEqual(observeQueryAuthority(cache, snapshot, snapshot), first);
  const replacement = `${cache}.replacement`;
  cpSync(cache, replacement);
  renameSync(cache, `${cache}.old`);
  renameSync(replacement, cache);
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot), {
    code: "CACHE_FROM_ELSEWHERE",
  });
});

test("auth.fresh-context: a new history sets the copied cache aside and starts a new context", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const copy = path.join(path.dirname(cache), "copy.db");
  cpSync(cache, copy);
  const copied = request(root, copy, "workspace.newHistory");
  assert.equal(copied.ok, true, JSON.stringify(copied));
  if (!copied.ok) return;
  assert.notEqual(copied.writeContext, first.writeContext);
  const retired = copied.result.retiredPath as string;
  assert.equal(path.dirname(retired), path.join(path.dirname(cache), "retired"));
  assert.deepEqual(readFileSync(retired), readFileSync(cache));
  const again = request(root, copy, "workspace.newHistory");
  assert.equal(again.ok ? "" : again.error.code, "UNSUPPORTED_COMMAND");
});

test("auth.moved-home: a moved folder and cache keep their history only after confirmation", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const moved = `${path.dirname(root)}-moved`;
  renameSync(path.dirname(root), moved);
  t.after(() => rmSync(moved, { recursive: true, force: true }));
  const movedRoot = path.join(moved, path.basename(root));
  const movedCache = path.join(moved, path.basename(cache));
  snapshot = readCanonicalRoot(movedRoot);
  assert.throws(() => observeQueryAuthority(movedCache, snapshot, snapshot), {
    code: "HOME_MOVED",
  });
  const confirmed = request(movedRoot, movedCache, "workspace.rebind");
  assert.equal(confirmed.ok && confirmed.writeContext, first.writeContext);
  assert.equal(
    observeQueryAuthority(movedCache, snapshot, snapshot).writeContext,
    first.writeContext,
  );
});

test("auth.moved-home: a new device number for the same files keeps the context silently", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const database = new DatabaseSync(cache);
  const { binding } = database.prepare("SELECT binding FROM v2_query_state").get() as {
    binding: string;
  };
  const [rootPath, rootIdentity, cachePath, cacheIdentity] = JSON.parse(binding) as string[];
  const remounted = (identity: string) => `9${identity}`;
  database
    .prepare("UPDATE v2_query_state SET binding = ?")
    .run(JSON.stringify([rootPath, remounted(rootIdentity), cachePath, remounted(cacheIdentity)]));
  database.close();
  assert.equal(observeQueryAuthority(cache, snapshot, snapshot).writeContext, first.writeContext);
});

test("auth.fresh-context: one cache never serves another folder, even at the same path", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const otherRoot = `${root}-other`;
  cpSync(golden, otherRoot, { recursive: true });
  snapshot = readCanonicalRoot(otherRoot);
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot), {
    code: "CACHE_FROM_ELSEWHERE",
  });
  snapshot = readCanonicalRoot(root);
  assert.deepEqual(observeQueryAuthority(cache, snapshot, snapshot), first);
  renameSync(root, `${root}-old`);
  cpSync(golden, root, { recursive: true });
  snapshot = readCanonicalRoot(root);
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot), {
    code: "CACHE_FROM_ELSEWHERE",
  });
});

test("query tokens notice formatting, deletion/reappearance and moves whose selected key stays unchanged", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const scope = snapshot.tasks.filter((task) => task.parentId === null);
  const selected = scope[1];
  const before = first.versions.get(selected.id)!;
  const neighbor = scope[0];
  const neighborPath = path.join(root, "tasks", `${neighbor.id}.json`);
  writeFileSync(neighborPath, JSON.stringify({ ...neighbor, orderKey: "a3" }));
  snapshot = readCanonicalRoot(root);
  const moved = observeQueryAuthority(cache, snapshot, snapshot);
  assert.equal(moved.writeContext, first.writeContext);
  assert.ok(moved.versions.get(selected.id)! > before);
  assert.equal(snapshot.tasks.find((task) => task.id === selected.id)!.orderKey, selected.orderKey);
  const selectedPath = path.join(root, "tasks", `${selected.id}.json`);
  const original = readFileSync(selectedPath);
  writeFileSync(selectedPath, ` ${original.toString()} `);
  snapshot = readCanonicalRoot(root);
  const formatted = observeQueryAuthority(cache, snapshot, snapshot);
  assert.ok(formatted.versions.get(selected.id)! > moved.versions.get(selected.id)!);
  rmSync(selectedPath);
  snapshot = readCanonicalRoot(root);
  observeQueryAuthority(cache, snapshot, snapshot);
  writeFileSync(selectedPath, original);
  snapshot = readCanonicalRoot(root);
  const restored = observeQueryAuthority(cache, snapshot, snapshot);
  assert.ok(restored.versions.get(selected.id)! > formatted.versions.get(selected.id)!);
  assert.ok(restored.workspaceRevision > first.workspaceRevision);
});

test("cache rejects dangling aliases into canonical data before SQLite can create files", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  const inside = path.join(root, "must-not-create.db");
  try {
    symlinkSync(inside, cache);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM")
      throw error;
    t.skip("Windows symlink privilege unavailable");
    return;
  }
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot));
  assert.equal(existsSync(inside), false);
  rmSync(cache);
  symlinkSync(inside, `${cache}-journal`);
  // Rollback-journal sidecars also cannot redirect writes into the root.
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot), {
    code: "INVALID_STORAGE",
  });
  assert.equal(existsSync(inside), false);
});

test("cache cannot be canonical data or a legacy/foreign SQLite database", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readCanonicalRoot(root);
  assert.throws(() => observeQueryAuthority(path.join(root, "cache.db"), snapshot, snapshot), {
    code: "INVALID_STORAGE",
  });
  const foreign = new DatabaseSync(cache);
  foreign.exec(
    "CREATE TABLE personal_data (value TEXT); INSERT INTO personal_data VALUES ('retained')",
  );
  foreign.close();
  const before = readFileSync(cache);
  assert.throws(() => observeQueryAuthority(cache, snapshot, snapshot), {
    code: "INVALID_STORAGE",
  });
  assert.deepEqual(readFileSync(cache), before);
});

function legacyObservations(cache: string, snapshot: CanonicalSnapshot): void {
  const database = new DatabaseSync(cache);
  try {
    const update = database.prepare("UPDATE v2_query_tasks SET fingerprint = ? WHERE id = ?");
    for (const task of snapshot.tasks) {
      const hash = snapshot.files.find(
        (file) => file.relativePath === `tasks/${task.id}.json`,
      )!.sha256;
      const siblings = snapshot.tasks
        .filter((sibling) => sibling.parentId === task.parentId)
        .map((sibling) => sibling.id);
      update.run(JSON.stringify([hash, siblings]), task.id);
    }
    assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 5);
  } finally {
    database.close();
  }
}

for (const nested of [false, true])
  for (const count of [1_000, 5_000]) {
    test(`authority fingerprints grow linearly for ${count} ${nested ? "nested" : "flat"} tasks`, (t) => {
      const { root, cache } = setup(t);
      const original = readCanonicalRoot(root);
      const tasks = Array.from({ length: count }, (_, index) => ({
        ...original.tasks[0],
        id: `task-${String(index).padStart(5, "0")}`,
        orderKey: "a0",
        parentId: nested && index >= 10 ? `task-${String(index % 10).padStart(5, "0")}` : null,
      }));
      const snapshot = {
        ...original,
        tasks,
        files: tasks.map((task) => ({
          relativePath: `tasks/${task.id}.json`,
          sha256: createHash("sha256").update(JSON.stringify(task)).digest("hex"),
        })),
      };
      const first = observeQueryAuthority(cache, snapshot, snapshot);
      assert.deepEqual(observeQueryAuthority(cache, snapshot, snapshot), first);
      const database = new DatabaseSync(cache);
      try {
        const lengths = database
          .prepare(
            "SELECT count(*) AS n, min(length(fingerprint)) AS min, max(length(fingerprint)) AS max, sum(length(fingerprint)) AS total FROM v2_query_tasks",
          )
          .get()!;
        assert.deepEqual({ ...lengths }, { n: count, min: 135, max: 135, total: count * 135 });
        const rows = database
          .prepare("SELECT id, fingerprint FROM v2_query_tasks ORDER BY id")
          .all();
        const expectedScopes = new Map<string | null, string[]>();
        for (const task of tasks) {
          const ids = expectedScopes.get(task.parentId) ?? [];
          ids.push(task.id);
          expectedScopes.set(task.parentId, ids);
        }
        const expectedSignatures = new Map(
          [...expectedScopes].map(([parentId, ids]) => [
            parentId,
            createHash("sha256").update(JSON.stringify(ids.sort())).digest("hex"),
          ]),
        );
        rows.forEach((row, index) => {
          const [hash, signature] = JSON.parse(row.fingerprint as string);
          assert.equal(hash, snapshot.files[index].sha256);
          assert.equal(signature, expectedSignatures.get(tasks[index].parentId));
        });
        assert.equal(
          new Set(rows.map((row) => JSON.parse(row.fingerprint as string)[1])).size,
          nested ? 11 : 1,
        );
      } finally {
        database.close();
      }
    });
  }

test("sibling signatures include hidden tied IDs and invalidate only the complete changed scope", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readCanonicalRoot(root);
  const first = observeQueryAuthority(cache, snapshot, snapshot);
  const roots = snapshot.tasks.filter((task) => task.parentId === null);
  const hidden = roots[0];
  const file = path.join(root, "tasks", `${hidden.id}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      ...hidden,
      status: "canceled",
      closedAt: hidden.createdAt,
      orderKey: roots[1].orderKey,
    }),
  );
  snapshot = readCanonicalRoot(root);
  const tied = observeQueryAuthority(cache, snapshot, snapshot);
  // Equal keys still have an exact ID order, including canceled tasks.
  const database = new DatabaseSync(cache);
  try {
    const fingerprint = database
      .prepare("SELECT fingerprint FROM v2_query_tasks WHERE id = ?")
      .get(hidden.id)!.fingerprint as string;
    const expectedIds = snapshot.tasks
      .filter((task) => task.parentId === null)
      .map((task) => task.id);
    assert.equal(
      JSON.parse(fingerprint)[1],
      createHash("sha256").update(JSON.stringify(expectedIds)).digest("hex"),
    );
  } finally {
    database.close();
  }
  rmSync(file);
  snapshot = readCanonicalRoot(root);
  const removed = observeQueryAuthority(cache, snapshot, snapshot);
  for (const task of snapshot.tasks) {
    if (task.parentId === null)
      assert.ok(removed.versions.get(task.id)! > tied.versions.get(task.id)!);
    else assert.equal(removed.versions.get(task.id), first.versions.get(task.id));
  }
  assert.equal(removed.versions.has(hidden.id), false);
});

test(
  "schema-5 array observations refresh atomically without losing retained local evidence",
  { skip: process.platform !== "linux" },
  (t) => {
    const { root, cache } = setup(t);
    const send = (request: object) => {
      const response = executeLine(
        Buffer.from(JSON.stringify({ version: 2, ...request })),
        root,
        cache,
      );
      assert.equal(response.ok, true, JSON.stringify(response));
      if (!response.ok) throw Error("failed");
      return response;
    };
    let snapshot = readCanonicalRoot(root);
    const first = observeQueryAuthority(cache, snapshot, snapshot);
    const task = snapshot.tasks.find((task) => task.status === "open")!;
    const request = {
      command: "task.complete",
      writeContext: first.writeContext,
      idempotencyKey: "complete",
      args: { id: task.id, expectedVersion: first.versions.get(task.id) },
    };
    const completed = send(request);
    const undo = {
      command: "task.status.undo",
      writeContext: first.writeContext,
      idempotencyKey: "undo",
      args: {
        id: task.id,
        expectedVersion: (completed.result.task as { version: number }).version,
      },
    };
    const undone = send(undo);
    snapshot = readCanonicalRoot(root);
    const before = observeQueryAuthority(cache, snapshot, snapshot);
    legacyObservations(cache, snapshot);
    const retainedTables = [
      "v2_receipts",
      "v2_operations",
      "v2_operation_members",
      "v2_undo_claims",
      "v2_doctor_plans",
    ];
    const database = new DatabaseSync(cache);
    database
      .prepare("INSERT INTO v2_doctor_plans VALUES (?, ?, ?)")
      .run("retained-plan", before.writeContext, "preserved opaque plan payload");
    const retained = retainedTables.map((table) =>
      database.prepare(`SELECT * FROM ${table}`).all(),
    );
    const legacy = database.prepare("SELECT * FROM v2_query_tasks ORDER BY id").all();
    const state = database.prepare("SELECT * FROM v2_query_state").get();
    database.close();
    // Pending/incomplete reads have no snapshot and must not refresh observations.
    assert.equal(observeQueryAuthority(cache, snapshot).writeContext, before.writeContext);
    assert.throws(
      () =>
        withCacheTransaction(cache, snapshot, (database) => {
          synchronizeAuthority(database, snapshot, snapshot);
          throw Error("abort refresh");
        }),
      /abort refresh/,
    );
    const rolledBack = new DatabaseSync(cache);
    assert.deepEqual(rolledBack.prepare("SELECT * FROM v2_query_tasks ORDER BY id").all(), legacy);
    assert.deepEqual(rolledBack.prepare("SELECT * FROM v2_query_state").get(), state);
    rolledBack.close();
    const refreshed = observeQueryAuthority(cache, snapshot, snapshot);
    assert.equal(refreshed.writeContext, before.writeContext);
    assert.equal(refreshed.workspaceRevision, before.workspaceRevision);
    for (const version of refreshed.versions.values())
      assert.ok(version > Math.max(...before.versions.values()));
    assert.deepEqual(observeQueryAuthority(cache, snapshot, snapshot), refreshed);
    assert.deepEqual(send(request).result, completed.result);
    assert.deepEqual(send(undo).result, undone.result);
    const verify = new DatabaseSync(cache);
    assert.deepEqual(
      retainedTables.map((table) => verify.prepare(`SELECT * FROM ${table}`).all()),
      retained,
    );
    assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 5);
    verify.close();
    assert.deepEqual(readCanonicalRoot(root).files, snapshot.files);
    const stale = executeLine(
      Buffer.from(
        JSON.stringify({
          version: 2,
          command: "task.update",
          writeContext: before.writeContext,
          idempotencyKey: "unsent-old-version",
          args: {
            id: task.id,
            expectedVersion: before.versions.get(task.id),
            title: "Refused old authority",
          },
        }),
      ),
      root,
      cache,
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, "STALE_TASK_VERSION");
  },
);
