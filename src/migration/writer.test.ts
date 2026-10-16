import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCopyTestWorkspace } from "../backend/copyTestWorkspace.js";
import { fail, send, success } from "../backend/copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "../backend/copyTestWorkspace.js";
import { readCanonicalRoot } from "../backend/canonicalReader.js";
import { readSchema1MigrationSnapshot } from "./schema1Source.js";
import { SCHEMA1_ROLLBACK_WARNING } from "./journal.js";
import { contentHash } from "../legacy/backend/requestHash.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/", import.meta.url));
const v1 = path.join(fixtures, "schema1/sync");
const golden = path.join(fixtures, "workspace/root");
const cli = fileURLToPath(new URL("../backend/cli.js", import.meta.url));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const linuxOnly = { skip: process.platform !== "linux" };
const corpus = JSON.parse(readFileSync(path.join(fixtures, "workspace/cases.json"), "utf8")) as {
  cases: {
    id: string;
    given: { patchSchema1?: object; rehashSchema1?: boolean; removeSchema1?: string };
    expect: { error?: string; fields?: Record<string, unknown>; taskCount?: number };
  }[];
};
function prepare(workspace: Workspace) {
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.equal(info.result.schemaVersion, 1);
  return {
    command: "workspace.migrate",
    writeContext: info.writeContext,
    idempotencyKey: "migrate",
    args: { destinationDirectory: workspace.destination },
  };
}
function patch(root: string, fields: object) {
  const file = path.join(root, "tasks", `${id}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(record, fields);
  const { contentHash: _oldHash, ...sync } = record.sync;
  record.sync.contentHash = contentHash({ ...record, sync });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}
function rawFiles(root: string) {
  return [
    "workspace.json",
    ...["tasks", ...(existsSync(path.join(root, "order")) ? ["order"] : [])].flatMap((directory) =>
      readdirSync(path.join(root, directory))
        .sort()
        .map((name) => `${directory}/${name}`),
    ),
  ].map((relativePath) => [
    relativePath,
    readFileSync(path.join(root, relativePath)).toString("base64"),
  ]);
}

for (const caseId of [
  "migrate-golden",
  "migrate-title-only-tokens",
  "migrate-legacy-escape",
  "migrate-offset",
  "migrate-invalid-time",
  "migrate-order-missing",
  "migrate-unknown-field",
  "migrate-markdown",
]) {
  test(
    `public migration executes ${caseId} without changing v1 source or selection`,
    linuxOnly,
    (t) => {
      const entry = corpus.cases.find((entry) => entry.id === caseId)!;
      const workspace = createCopyTestWorkspace(t, v1);
      const request = prepare(workspace);
      if (entry.given.patchSchema1) {
        assert.equal(entry.given.rehashSchema1, true);
        patch(workspace.root, entry.given.patchSchema1);
      }
      if (entry.given.removeSchema1) rmSync(path.join(workspace.root, entry.given.removeSchema1));
      const before = rawFiles(workspace.root);
      const response = send(workspace, request);
      if (entry.expect.error) {
        fail(response, entry.expect.error);
        assert.equal(existsSync(workspace.destination), false);
        if (!response.ok) assert.ok(response.error.details?.path);
      } else {
        const result = success(response);
        assert.equal(result.result.taskCount, 4);
        assert.equal(result.result.selectionChanged, false);
        assert.equal(result.result.sourceDirectory, workspace.root);
        assert.equal(result.result.rollbackWarning, SCHEMA1_ROLLBACK_WARNING);
        assert.deepEqual(
          result.result.transformedIds,
          readSchema1MigrationSnapshot(workspace.root).tasks.map((task) => task.id),
        );
        const target = readCanonicalRoot(workspace.destination);
        if (caseId === "migrate-golden")
          assert.deepEqual(rawFiles(workspace.destination), rawFiles(golden));
        if (entry.expect.fields) {
          const task = target.tasks.find((task) => task.id === id)!;
          for (const [field, expected] of Object.entries(entry.expect.fields))
            assert.deepEqual(task[field as keyof typeof task], expected);
        }
        const recovery = JSON.parse(readFileSync(result.result.recoveryLocation as string, "utf8"));
        assert.equal(recovery.format, "taskdb.v1-migration-recovery");
        assert.deepEqual(
          recovery.files.map((file: { relativePath: string; bytes: string }) => [
            file.relativePath,
            file.bytes,
          ]),
          before,
        );
        assert.deepEqual(success(send(workspace, request)).result, result.result);
      }
      assert.deepEqual(rawFiles(workspace.root), before);
      fail(send(workspace, { command: "task.list" }), "UNSUPPORTED_SCHEMA");
      assert.equal(
        success(send(workspace, { command: "workspace.info" })).writeContext,
        request.writeContext,
      );
    },
  );
}

test(
  "public migration executes migrate-destination and overlap refusals before staging",
  linuxOnly,
  (t) => {
    const workspace = createCopyTestWorkspace(t, v1);
    const request = prepare(workspace);
    const before = rawFiles(workspace.root);
    assert.equal(
      corpus.cases.find((entry) => entry.id === "migrate-destination")!.expect.error,
      "DESTINATION_NOT_EMPTY",
    );
    mkdirSync(workspace.destination);
    writeFileSync(path.join(workspace.destination, "keep"), "outside data");
    fail(send(workspace, request), "DESTINATION_NOT_EMPTY");
    assert.equal(readFileSync(path.join(workspace.destination, "keep"), "utf8"), "outside data");
    for (const destinationDirectory of [
      workspace.root,
      path.join(workspace.root, "nested"),
      workspace.directory,
    ]) {
      fail(send(workspace, { ...request, args: { destinationDirectory } }), "INVALID_ARGUMENT");
    }
    assert.deepEqual(rawFiles(workspace.root), before);
  },
);

test(
  "migration previews, shape/authority failures and failed-precondition key reuse have no target effects",
  linuxOnly,
  (t) => {
    const workspace = createCopyTestWorkspace(t, v1);
    const request = prepare(workspace);
    for (const preview of [{ readOnly: true }, { dryRun: true }]) {
      const result = success(
        send(workspace, { ...request, idempotencyKey: undefined, ...preview }),
      );
      assert.equal(result.result.selectionChanged, false);
      assert.equal(existsSync(workspace.destination), false);
    }
    fail(send(workspace, { ...request, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
    fail(send(workspace, { ...request, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
    fail(send(workspace, { ...request, writeContext: "wrong" }), "STALE_WRITE_CONTEXT");
    for (const args of [
      {},
      { destinationDirectory: " " },
      { destinationDirectory: workspace.destination, sourceDirectory: workspace.root },
      { destinationDirectory: workspace.destination, force: true },
    ]) {
      fail(send(workspace, { ...request, args }), "INVALID_ARGUMENT");
    }
    success(send(workspace, request));
    for (const extra of [
      { actor: { kind: "agent", label: "other" } },
      { readOnly: true },
      { args: { destinationDirectory: path.join(workspace.directory, "other") } },
    ]) {
      fail(send(workspace, { ...request, ...extra }), "IDEMPOTENCY_KEY_REUSED");
    }
  },
);

test(
  "historical migration replay precedes later v1 task/conflict/destination validation",
  linuxOnly,
  (t) => {
    const workspace = createCopyTestWorkspace(t, v1);
    const request = prepare(workspace);
    const result = success(send(workspace, request));
    rmSync(path.join(workspace.root, "tasks", `${id}.json`));
    writeFileSync(path.join(workspace.root, "tasks", "late.sync-conflict-device.json"), "keep");
    writeFileSync(path.join(workspace.destination, "keep"), "target edit");
    assert.deepEqual(success(send(workspace, request)), result);
    assert.equal(readFileSync(path.join(workspace.destination, "keep"), "utf8"), "target edit");
  },
);

test(
  "public migration executes rollback via explicit fresh v2 selection then preserved v1 client, retaining later edits",
  linuxOnly,
  (t) => {
    const entry = corpus.cases.find((entry) => entry.id === "rollback")!;
    assert.deepEqual(entry.expect, {
      schema1PreMigrationBytes: true,
      preserveEditsSeparately: true,
      reverseConversion: false,
      freshAuthority: true,
    });
    const workspace = createCopyTestWorkspace(t, v1);
    const before = rawFiles(workspace.root);
    const request = prepare(workspace);
    const migrated = success(send(workspace, request));
    assert.equal(migrated.result.rollbackWarning, SCHEMA1_ROLLBACK_WARNING);
    const selected = {
      ...workspace,
      root: workspace.destination,
      cache: path.join(workspace.directory, "fresh-v2.db"),
    };
    const first = success(send(selected, { command: "task.get", args: { id } }));
    assert.notEqual(first.writeContext, request.writeContext);
    const version = (first.result.task as { version: number }).version;
    fail(
      send(selected, {
        command: "task.update",
        args: { id, expectedVersion: version, title: "old authority" },
        writeContext: request.writeContext,
        idempotencyKey: "old",
      }),
      "STALE_WRITE_CONTEXT",
    );
    success(
      send(selected, {
        command: "task.update",
        args: { id, expectedVersion: version, title: "Later v2 edit" },
        writeContext: first.writeContext,
        idempotencyKey: "new",
      }),
    );
    const recovery = JSON.parse(readFileSync(migrated.result.recoveryLocation as string, "utf8"));
    const preserved = path.join(workspace.directory, "explicit-preserved-v1");
    mkdirSync(path.join(preserved, "tasks"), { recursive: true });
    mkdirSync(path.join(preserved, "order"));
    // Explicit test adapter materializes the retained raw archive, not an automatic command/selection.
    for (const file of recovery.files)
      writeFileSync(path.join(preserved, file.relativePath), Buffer.from(file.bytes, "base64"));
    assert.deepEqual(rawFiles(preserved), before);
    const child = spawnSync(
      process.execPath,
      [cli, "--stdio", "--database", path.join(workspace.directory, "rollback-v1.db")],
      {
        input: JSON.stringify({
          version: 1,
          requestId: "rollback-v1",
          command: "task.list",
          args: { sort: "manual" },
        }),
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, TASKS_SYNC_ROOT: preserved },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const restored = JSON.parse(child.stdout);
    assert.equal(restored.ok, true, child.stdout);
    assert.equal(restored.result.total, 4);
    assert.equal(
      restored.result.tasks.find((task: { id: string }) => task.id === id).title,
      "Plan launch @planning #product",
    );
    assert.deepEqual(rawFiles(preserved), before);
    assert.deepEqual(rawFiles(workspace.root), before);
    assert.equal(
      readCanonicalRoot(workspace.destination).tasks.find((task) => task.id === id)!.title,
      "Later v2 edit",
    );
  },
);

test(
  "migration refuses selected schema two and never imports a v1 database as control authority",
  linuxOnly,
  (t) => {
    const workspace = createCopyTestWorkspace(t, v1);
    const schema2 = path.join(workspace.directory, "schema2");
    cpSync(golden, schema2, { recursive: true });
    fail(
      send(
        { ...workspace, root: schema2 },
        { command: "workspace.migrate", args: { destinationDirectory: workspace.destination } },
      ),
      "MIGRATION_INVALID_SOURCE",
    );
    const legacyCache = path.join(workspace.directory, "old-v1.db");
    const child = spawnSync(process.execPath, [cli, "--stdio", "--database", legacyCache], {
      input: JSON.stringify({ version: 1, requestId: "v1-cache", command: "task.list" }),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, TASKS_SYNC_ROOT: workspace.root },
    });
    assert.equal(child.status, 0, child.stderr);
    fail(
      send({ ...workspace, cache: legacyCache }, { command: "workspace.info" }),
      "INVALID_STORAGE",
    );
    const request = prepare(workspace);
    rmSync(workspace.cache);
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    assert.equal(existsSync(workspace.destination), false);
  },
);
