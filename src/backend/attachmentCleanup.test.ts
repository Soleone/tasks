import assert from "node:assert/strict";
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
import type { TestContext } from "node:test";
import { crc32 } from "node:zlib";
import {
  createCopyTestWorkspace as setup,
  fail,
  recover,
  run,
  send,
  success,
} from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import type { CanonicalTask } from "./taskModel.js";

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
const linux = { skip: process.platform !== "linux" };
const OLD = "2026-01-02-030405-0000000a.png";
const OLDER = "2026-01-01-000000-0000000b.png";
const done = (closedAt: string) => ({ status: "done" as const, closedAt });
const canceled = { status: "canceled" as const, closedAt: "2026-09-08T14:00:00.000Z" };

/** A name stamped now, so the 7-day grace still covers it. */
function recentName(): string {
  const at = new Date().toISOString();
  return `${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(":", "")}-0000000c.png`;
}

function png(marker: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
}

function materialize(
  t: TestContext,
  records: Record<string, Partial<CanonicalTask>>,
  images: readonly string[] = [],
): Workspace {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks")))
    rmSync(path.join(w.root, "tasks", file));
  for (const [index, [id, fields]] of Object.entries(records).entries())
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, orderKey: `a${index}`, ...fields, id }) + "\n",
    );
  mkdirSync(path.join(w.root, "attachments"));
  for (const [index, name] of images.entries())
    writeFileSync(path.join(w.root, "attachments", name), png(index));
  return w;
}

function request(
  w: Workspace,
  command: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const info = success(send(w, { command: "workspace.info" }));
  return {
    version: 2,
    command,
    args,
    writeContext: info.writeContext,
    idempotencyKey: `${command}-${JSON.stringify(args)}`,
    actor: { kind: "human", label: "cleanup test" },
    ...extra,
  };
}

function clearDone(w: Workspace, args: Record<string, unknown>, extra = {}) {
  return send(w, request(w, "task.clearDone", args, extra));
}

function images(w: Workspace): string[] {
  return readdirSync(path.join(w.root, "attachments")).sort();
}

function task(w: Workspace, id: string): CanonicalTask | undefined {
  const file = path.join(w.root, "tasks", `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/** Entries of a stored zip, read from its central directory. */
function unzip(file: string): Map<string, Buffer> {
  const bytes = readFileSync(file);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const entries = new Map<string, Buffer>();
  let at = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const size = bytes.readUInt32LE(at + 24),
      nameLength = bytes.readUInt16LE(at + 28),
      offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString();
    const start = offset + 30 + bytes.readUInt16LE(offset + 26);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), bytes.readUInt32LE(at + 16));
    entries.set(name, data);
    at += 46 + nameLength;
  }
  return entries;
}

test("purge.attachments: images only purged tasks list go with them", linux, (t) => {
  const w = materialize(
    t,
    { a: { ...canceled, attachments: [OLD, OLDER] }, z: { attachments: [OLDER] } },
    [OLD, OLDER],
  );
  const result = success(send(w, request(w, "task.purgeCanceled", {}))).result;
  assert.deepEqual(result.purgedIds, ["a"]);
  assert.deepEqual(result.removedAttachments, [OLD]);
  assert.deepEqual(images(w), [OLDER]);
});

test("purge.unlisted: only old, pattern-named images no task lists go", linux, (t) => {
  const recent = recentName();
  const w = materialize(t, { a: { attachments: [OLDER] } }, [OLD, OLDER, recent, "notes.png"]);
  const result = success(send(w, request(w, "task.purgeCanceled", {}))).result;
  assert.deepEqual(result.purgedIds, []);
  assert.deepEqual(result.removedAttachments, [OLD]);
  assert.equal(result.changed, true);
  assert.deepEqual(images(w), [OLDER, recent, "notes.png"].sort());
});

test("purge.empty: no canceled tasks and nothing unlisted changes nothing", linux, (t) => {
  const w = materialize(t, { a: { attachments: [OLD] } }, [OLD]);
  const result = success(send(w, request(w, "task.purgeCanceled", {}))).result;
  assert.deepEqual(result, { purgedIds: [], removedAttachments: [], changed: false });
  assert.deepEqual(images(w), [OLD]);
});

test("clear-done.selection: done tasks closed before the cutoff, or all with null", linux, (t) => {
  const w = materialize(t, {
    old: done("2026-01-05T00:00:00.000Z"),
    recent: done("2026-09-05T00:00:00.000Z"),
    gone: canceled,
    open: {},
  });
  const preview = clearDone(
    w,
    { closedBefore: "2026-06-01T00:00:00.000Z", scope: "tasks" },
    { dryRun: true },
  );
  assert.deepEqual(success(preview).result.clearedIds, ["old"]);
  const all = success(clearDone(w, { closedBefore: null, scope: "tasks" })).result;
  assert.deepEqual(all.clearedIds, ["old", "recent"]);
  assert.deepEqual(readdirSync(path.join(w.root, "tasks")).sort(), ["gone.json", "open.json"]);
});

test("clear-done.tasks: removing tasks takes the images no remaining task lists", linux, (t) => {
  const w = materialize(
    t,
    {
      d: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLD, OLDER] },
      open: { attachments: [OLDER] },
    },
    [OLD, OLDER],
  );
  const preview = success(
    clearDone(w, { closedBefore: null, scope: "tasks" }, { dryRun: true }),
  ).result;
  const taskBytes = readFileSync(path.join(w.root, "tasks", "d.json")).length;
  assert.deepEqual(preview.removedAttachments, [OLD]);
  assert.equal(preview.bytes, taskBytes + png(0).length);
  assert.deepEqual(images(w), [OLDER, OLD]);
  const result = success(clearDone(w, { closedBefore: null, scope: "tasks" })).result;
  assert.deepEqual(result.clearedIds, ["d"]);
  assert.deepEqual(images(w), [OLDER]);
});

test("clear-done.linked: a done task another remaining task links to stays", linux, (t) => {
  const w = materialize(t, {
    parent: done("2026-01-05T00:00:00.000Z"),
    blocker: done("2026-01-05T00:00:00.000Z"),
    grandparent: done("2026-01-05T00:00:00.000Z"),
    loose: done("2026-01-05T00:00:00.000Z"),
    child: { parentId: "parent", dependencyIds: ["blocker"] },
  });
  const raw = path.join(w.root, "tasks", "parent.json");
  writeFileSync(
    raw,
    JSON.stringify({ ...JSON.parse(readFileSync(raw, "utf8")), parentId: "grandparent" }) + "\n",
  );
  const result = success(clearDone(w, { closedBefore: null, scope: "tasks" })).result;
  assert.deepEqual(result.clearedIds, ["loose"]);
  assert.deepEqual(result.keptIds, ["blocker", "grandparent", "parent"]);
});

test(
  "clear-done.attachments: images only strips the list, keeps tasks and updatedAt",
  linux,
  (t) => {
    const w = materialize(
      t,
      {
        d: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLD, OLDER] },
        open: { attachments: [OLDER] },
      },
      [OLD, OLDER],
    );
    const before = task(w, "d")!;
    const result = success(clearDone(w, { closedBefore: null, scope: "attachments" })).result;
    assert.deepEqual(result.clearedIds, ["d"]);
    assert.deepEqual(result.removedAttachments, [OLD]);
    const { attachments: _, ...stripped } = before;
    assert.deepEqual(task(w, "d"), stripped);
    assert.deepEqual(task(w, "open")?.attachments, [OLDER]);
    assert.deepEqual(images(w), [OLDER]);
    fail(
      send(w, request(w, "operation.undo", { operationId: result.operationId })),
      "OPERATION_UNAVAILABLE",
    );
  },
);

test("clear-done.export: the zip holds exactly the removed tasks and images", linux, (t) => {
  const w = materialize(
    t,
    { d: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLD] }, open: {} },
    [OLD],
  );
  const stored = readFileSync(path.join(w.root, "tasks", "d.json"), "utf8");
  const result = success(clearDone(w, { closedBefore: null, scope: "tasks", export: true })).result;
  const location = result.exportLocation as string;
  assert.equal(path.dirname(location), path.join(w.directory, "exports"));
  const entries = unzip(location);
  assert.deepEqual([...entries.keys()], ["tasks.json", `attachments/${OLD}`]);
  assert.deepEqual(JSON.parse(entries.get("tasks.json")!.toString()), [JSON.parse(stored)]);
  assert.deepEqual(entries.get(`attachments/${OLD}`), png(0));
  assert.equal(task(w, "d"), undefined);
});

test("clear-done.export: a bare folder can't export and nothing changes", linux, (t) => {
  const w = materialize(t, { d: done("2026-01-05T00:00:00.000Z") });
  const bare = path.join(w.directory, "bare");
  cpSync(w.root, bare, { recursive: true });
  const moved = { ...w, root: bare, cache: path.join(w.directory, "bare.db") };
  fail(clearDone(moved, { closedBefore: null, scope: "tasks", export: true }), "INVALID_ARGUMENT");
  assert.equal(existsSync(path.join(bare, "tasks", "d.json")), true);
});

test(
  "clear-done.recovery: task files are kept outside the folder, images are deleted",
  linux,
  (t) => {
    const w = materialize(t, { d: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLD] } }, [
      OLD,
    ]);
    const result = success(clearDone(w, { closedBefore: null, scope: "tasks" })).result;
    const location = result.recoveryLocation as string;
    assert.match(path.basename(location), /^clear-done-.+\.recovery\.json$/);
    const archive = JSON.parse(readFileSync(location, "utf8"));
    assert.deepEqual(archive.purgedIds, ["d"]);
    assert.equal(existsSync(location.replace(/\.recovery\.json$/, ".attachments")), false);
    assert.deepEqual(images(w), []);
  },
);

test("clear-done.unlisted: images no task listed are left for purge", linux, (t) => {
  const w = materialize(t, { d: done("2026-01-05T00:00:00.000Z") }, [OLD]);
  const result = success(clearDone(w, { closedBefore: null, scope: "tasks" })).result;
  assert.deepEqual(result.removedAttachments, []);
  assert.deepEqual(images(w), [OLD]);
});

test("clear-done.empty: nothing selected changes nothing and writes no export", linux, (t) => {
  const w = materialize(t, { open: {} });
  const result = success(clearDone(w, { closedBefore: null, scope: "tasks", export: true })).result;
  assert.deepEqual(result, {
    clearedIds: [],
    keptIds: [],
    removedAttachments: [],
    bytes: 0,
    changed: false,
  });
  assert.equal(existsSync(path.join(w.directory, "exports")), false);
});

for (const cut of ["rewrite", "retire"])
  test(`clear-done.recovery: a crash at ${cut} resumes to the same result`, linux, (t) => {
    const w = materialize(
      t,
      {
        d: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLD] },
        e: { ...done("2026-01-05T00:00:00.000Z"), attachments: [OLDER] },
      },
      [OLD, OLDER],
    );
    const loader = path.join(w.directory, "clear-kill-loader.mjs");
    const [file, needle] =
      cut === "rewrite"
        ? ["/purgeJournal.js", "renameSync(stage, target);"]
        : ["/purgeWriter.js", "retirePurgeQuarantines(completed);"];
    writeFileSync(
      loader,
      `import{registerHooks}from'node:module';registerHooks({load(url,context,next){const r=next(url,context);if(!r.source||!url.endsWith(${JSON.stringify(file)}))return r;const source=r.source.toString();const n=${JSON.stringify(needle)};if(source.split(n).length!==2)throw Error('unique cut required');return{...r,source:source.replace(n,${JSON.stringify(cut === "rewrite" ? "" : "process.kill(process.pid,'SIGKILL');")}+n+${JSON.stringify(cut === "rewrite" ? "process.kill(process.pid,'SIGKILL');" : "")})};}});`,
    );
    const crashed = run(
      w,
      request(w, "task.clearDone", { closedBefore: null, scope: "attachments" }),
      loader,
    );
    assert.equal(crashed.signal, "SIGKILL", crashed.stderr);
    const info = success(send(w, { command: "workspace.info" })).result;
    success(recover(w, info.pendingOperationId as string));
    assert.equal(task(w, "d")?.attachments, undefined);
    assert.equal(task(w, "e")?.attachments, undefined);
    assert.deepEqual(images(w), []);
  });
