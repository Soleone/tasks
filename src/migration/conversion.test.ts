import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { readCanonicalRoot } from "../backend/canonicalReader.js";
import {
  contentHash,
  normalizeSchema1MigrationTimestamp,
  readSchema1MigrationSnapshot,
  Schema1MigrationSourceError,
} from "./schema1Source.js";
import { planSchema1Conversion } from "./conversion.js";
import { compareTasks } from "../backend/taskModel.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/", import.meta.url));
const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
const doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";
const taskPath = `tasks/${parentId}.json`;
type RecordValue = Record<string, unknown> & { sync: Record<string, unknown> };
const corpus = JSON.parse(readFileSync(path.join(fixtures, "workspace/cases.json"), "utf8")) as {
  cases: {
    id: string;
    given: {
      patchSchema1?: Record<string, unknown>;
      removeSchema1?: string;
      rehashSchema1?: boolean;
    };
    expect: {
      error?: string;
      fields?: Record<string, unknown>;
      taskCount?: number;
      goldenRoot?: string;
    };
  }[];
};

function setup(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-conversion-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  cpSync(path.join(fixtures, "schema1/sync"), root, { recursive: true });
  return { directory, root };
}

function patch(
  root: string,
  relativePath: string,
  edit: (record: RecordValue) => void,
  rehash = true,
) {
  const file = path.join(root, relativePath);
  const record = JSON.parse(readFileSync(file, "utf8")) as RecordValue;
  edit(record);
  if (rehash) {
    const { contentHash: _oldHash, ...sync } = record.sync;
    record.sync.contentHash = contentHash({ ...record, sync });
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

function tree(root: string, prefix = ""): unknown[] {
  return readdirSync(root)
    .sort()
    .flatMap((name): unknown[] => {
      const file = path.join(root, name);
      const stat = lstatSync(file);
      const relative = `${prefix}${name}`;
      return stat.isSymbolicLink()
        ? [[relative, "link", readlinkSync(file)]]
        : stat.isDirectory()
          ? [[relative, "directory", stat.ino, stat.mtimeMs], ...tree(file, `${relative}/`)]
          : [[relative, stat.ino, stat.mtimeMs, readFileSync(file).toString("base64")]];
    });
}

function invalid(root: string, expectedPath?: string, field?: string) {
  const before = tree(root);
  assert.throws(
    () => planSchema1Conversion(root),
    (error: unknown) => {
      assert.ok(error instanceof Schema1MigrationSourceError);
      assert.equal(error.code, "MIGRATION_INVALID_SOURCE");
      assert.ok(error.details.reason);
      if (expectedPath) assert.equal(error.details.path, expectedPath);
      if (field) assert.equal(error.details.field, field);
      return true;
    },
  );
  assert.deepEqual(tree(root), before);
}

test("read-only converter adapts migrate-golden: independent full-field AND exact byte equality", (t) => {
  const entry = corpus.cases.find((entry) => entry.id === "migrate-golden")!;
  assert.equal(entry.expect.taskCount, 4);
  const { directory, root } = setup(t);
  const selection = path.join(directory, "selection.json");
  const cache = path.join(directory, "old-cache.db");
  writeFileSync(selection, JSON.stringify({ root }));
  writeFileSync(cache, "not a conversion input");
  const before = tree(directory);
  const plan = planSchema1Conversion(root);
  const golden = path.join(fixtures, "workspace", entry.expect.goldenRoot!);
  assert.deepEqual(
    plan.tasks,
    readCanonicalRoot(golden).tasks.sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
  assert.equal(plan.tasks.length, entry.expect.taskCount);
  for (const file of plan.files)
    assert.deepEqual(
      file.bytes,
      readFileSync(path.join(golden, file.relativePath)),
      file.relativePath,
    );
  assert.deepEqual(plan.files, planSchema1Conversion(root).files);
  assert.deepEqual(plan.source.files, readSchema1MigrationSnapshot(root).files);
  assert.equal(plan.source.orders.length, 2);
  assert.equal(plan.source.directories.length, 3);
  assert.equal(plan.source.rootPath, root);
  assert.deepEqual(tree(directory), before);
  assert.equal(existsSync(path.join(directory, "destination")), false);
});

for (const id of [
  "migrate-title-only-tokens",
  "migrate-legacy-escape",
  "migrate-offset",
  "migrate-invalid-time",
  "migrate-order-missing",
  "migrate-unknown-field",
  "migrate-markdown",
]) {
  test(`read-only converter adapts ${id} source/mapping vector, not migration command execution`, (t) => {
    const entry = corpus.cases.find((entry) => entry.id === id)!;
    const { root } = setup(t);
    if (entry.given.patchSchema1) {
      assert.equal(entry.given.rehashSchema1, true);
      patch(root, taskPath, (record) => Object.assign(record, entry.given.patchSchema1));
    }
    if (entry.given.removeSchema1) rmSync(path.join(root, entry.given.removeSchema1));
    const before = tree(root);
    if (entry.expect.error) invalid(root);
    else {
      const converted = planSchema1Conversion(root).tasks.find((task) => task.id === parentId)!;
      for (const [field, value] of Object.entries(entry.expect.fields!))
        assert.deepEqual(converted[field as keyof typeof converted], value, field);
    }
    assert.deepEqual(tree(root), before);
  });
}

test("migration preserves nonmetadata spacing, Unicode, protected code and unknown legacy escapes", (t) => {
  const { root } = setup(t);
  patch(root, taskPath, (record) => {
    record.title =
      "  Prépare  😃\t launch @WORK #Zoo #alpha #ZOO @work `  @code #literal  ` \\q\n```\n#fenced @ignored\n```  ";
    record.descriptionMarkdown = "## Notes\r\n\r\n#not-a-tag\n\\@literal\r\n😃";
  });
  const converted = planSchema1Conversion(root).tasks.find((task) => task.id === parentId)!;
  assert.equal(
    converted.title,
    "Prépare  😃\t launch      `  @code #literal  ` \\q\n```\n#fenced @ignored\n```",
  );
  assert.equal(converted.description, "## Notes\r\n\r\n#not-a-tag\n\\@literal\r\n😃");
  assert.equal(converted.category, "work");
  assert.deepEqual(converted.tags, ["alpha", "zoo"]);
});

test("migration keeps all inactive siblings, exact legacy IDs, edge membership and legacy updatedAt", (t) => {
  const { root } = setup(t);
  patch(root, taskPath, (record) => {
    record.status = "canceled";
    record.canceledAt = "2026-09-26T06:00:00+02:00";
    record.updatedAt = "2026-09-26T04:00:00.000Z";
    record.dependencyIds = [doneId, "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed"];
    record.priority = 0;
  });
  const plan = planSchema1Conversion(root);
  const converted = plan.tasks.find((task) => task.id === parentId)!;
  assert.equal(converted.orderKey, "a2");
  assert.equal(converted.status, "canceled");
  assert.equal(converted.priority, 0);
  assert.equal(converted.closedAt, "2026-09-26T04:00:00.000Z");
  assert.equal(converted.updatedAt, "2026-09-26T04:00:00.000Z");
  assert.deepEqual(converted.dependencyIds, ["62f159c1-22a7-45cb-89a0-c0c35aaeb1ed", doneId]);
  assert.equal(plan.tasks.find((task) => task.id === childId)!.parentId, parentId);
  renameSync(path.join(root, taskPath), path.join(root, "tasks/Legacy_ID-7.json"));
  patch(root, "tasks/Legacy_ID-7.json", (record) => {
    record.id = "Legacy_ID-7";
  });
  patch(root, `tasks/${childId}.json`, (record) => {
    record.parentId = "Legacy_ID-7";
    record.dependencyIds = ["Legacy_ID-7"];
    record.priority = 4;
  });
  patch(root, "order/root.json", (record) => {
    record.taskIds = (record.taskIds as string[]).map((id) =>
      id === parentId ? "Legacy_ID-7" : id,
    );
  });
  renameSync(path.join(root, `order/${parentId}.json`), path.join(root, "order/Legacy_ID-7.json"));
  patch(root, "order/Legacy_ID-7.json", (record) => {
    record.parentId = "Legacy_ID-7";
  });
  const legacy = planSchema1Conversion(root);
  assert.equal(legacy.tasks.find((task) => task.id === "Legacy_ID-7")!.orderKey, "a2");
  assert.deepEqual(legacy.tasks.find((task) => task.id === childId)!.dependencyIds, [
    "Legacy_ID-7",
  ]);
  assert.ok(legacy.files.some((file) => file.relativePath === "tasks/Legacy_ID-7.json"));
});

test("migrate.source-valid: stale ordering keeps valid positions and appends every missing sibling", (t) => {
  const { root } = setup(t);
  const baseline = planSchema1Conversion(root);
  patch(root, "order/root.json", (record) => {
    record.taskIds = [parentId, "missing-task", childId];
  });
  rmSync(path.join(root, `order/${parentId}.json`));
  const before = tree(root);
  const plan = planSchema1Conversion(root);
  const remaining = baseline.tasks
    .filter((task) => task.parentId === null && task.id !== parentId)
    .map((task) => task.id)
    .sort();
  assert.deepEqual(
    plan.tasks
      .filter((task) => task.parentId === null)
      .sort(compareTasks)
      .map((task) => task.id),
    [parentId, ...remaining],
  );
  assert.deepEqual(
    plan.tasks.map(({ orderKey: _key, ...task }) => task),
    baseline.tasks.map(({ orderKey: _key, ...task }) => task),
  );
  assert.deepEqual(plan.files, planSchema1Conversion(root).files);
  assert.deepEqual(tree(root), before);
});

for (const missing of ["order/root.json", "order"]) {
  test(`migrate.source-valid: absent ${missing} uses deterministic sibling ordering`, (t) => {
    const { root } = setup(t);
    rmSync(path.join(root, missing), { recursive: true });
    const before = tree(root);
    const plan = planSchema1Conversion(root);
    assert.equal(plan.tasks.length, 4);
    assert.deepEqual(
      plan.tasks
        .filter((task) => task.parentId === null)
        .sort(compareTasks)
        .map((task) => task.id),
      ["62f159c1-22a7-45cb-89a0-c0c35aaeb1ed", parentId, doneId],
    );
    assert.equal(plan.tasks.find((task) => task.id === childId)!.parentId, parentId);
    assert.deepEqual(plan.files, planSchema1Conversion(root).files);
    assert.deepEqual(tree(root), before);
  });
}

test("empty source and valid empty leaf scope convert without inventing tasks", (t) => {
  const { root } = setup(t);
  patch(root, `order/${parentId}.json`, (record) => {
    record.taskIds = [];
  });
  rmSync(path.join(root, `tasks/${childId}.json`));
  assert.equal(planSchema1Conversion(root).tasks.length, 3);
  rmSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, "tasks"));
  rmSync(path.join(root, `order/${parentId}.json`));
  patch(root, "order/root.json", (record) => {
    record.taskIds = [];
  });
  const empty = planSchema1Conversion(root);
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(
    empty.files.map((file) => file.relativePath),
    ["workspace.json"],
  );
});

test("known physical Syncthing artifacts are excluded, not copied or parsed as tasks", (t) => {
  const { root } = setup(t);
  mkdirSync(path.join(root, ".stfolder"));
  mkdirSync(path.join(root, ".stversions"));
  writeFileSync(
    path.join(root, ".stversions", "old-task.json"),
    "unrelated historical transport bytes",
  );
  writeFileSync(path.join(root, ".stignore"), "# marker");
  writeFileSync(path.join(root, "tasks/.syncthing.transfer.tmp"), "partial { arbitrary bytes");
  const before = tree(root);
  assert.equal(planSchema1Conversion(root).files.length, 5);
  assert.deepEqual(tree(root), before);
});

test("migrate.source-valid: plain non-JSON files at the top are left behind, other JSON refuses", (t) => {
  const { root } = setup(t);
  writeFileSync(path.join(root, "tasks-saf-benchmark-report.txt"), "device benchmark report");
  writeFileSync(path.join(root, "cache.db"), "stray cache bytes");
  const before = tree(root);
  assert.deepEqual(
    planSchema1Conversion(root).files.map((file) => file.relativePath),
    planSchema1Conversion(setup(t).root).files.map((file) => file.relativePath),
  );
  assert.deepEqual(tree(root), before);
  writeFileSync(path.join(root, "notes.json"), "{}");
  invalid(root, "notes.json", "entry");
});

const invalidEdits: [string, string, (record: RecordValue) => void, boolean?][] = [
  [
    "unknown descriptor member",
    "workspace.json",
    (record) => {
      record.extra = "no loss";
    },
    false,
  ],
  [
    "legacy export is not canonical",
    "workspace.json",
    (record) => {
      record.format = "tasks.tasks-export";
      record.formatVersion = 2;
    },
    false,
  ],
  [
    "schema two is not v1 source",
    "workspace.json",
    (record) => {
      record.schemaVersion = 2;
    },
    false,
  ],
  [
    "blank workspace identity",
    "workspace.json",
    (record) => {
      record.workspaceId = " ";
    },
    false,
  ],
  [
    "mixed workspace IDs",
    taskPath,
    (record) => {
      record.workspaceId = "other";
    },
  ],
  [
    "unsafe task ID",
    taskPath,
    (record) => {
      record.id = "../escape";
    },
  ],
  [
    "exact filename mismatch",
    taskPath,
    (record) => {
      record.id = parentId.toUpperCase();
    },
  ],
  [
    "missing task field",
    taskPath,
    (record) => {
      delete record.descriptionMarkdown;
    },
  ],
  [
    "unknown nested sync field",
    taskPath,
    (record) => {
      record.sync.extra = true;
    },
  ],
  [
    "invalid prior hash",
    taskPath,
    (record) => {
      record.sync.basedOnHash = "not-a-hash";
    },
  ],
  [
    "unsafe revision",
    taskPath,
    (record) => {
      record.sync.revision = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "unsupported priority",
    taskPath,
    (record) => {
      record.priority = 5;
    },
  ],
  [
    "invalid priority type",
    taskPath,
    (record) => {
      record.priority = "2";
    },
  ],
  [
    "unsupported status",
    taskPath,
    (record) => {
      record.status = "complete";
    },
  ],
  [
    "title limit",
    taskPath,
    (record) => {
      record.title = "x".repeat(1001);
    },
  ],
  [
    "Markdown limit",
    taskPath,
    (record) => {
      record.descriptionMarkdown = "x".repeat(10001);
    },
  ],
  [
    "multiple categories",
    taskPath,
    (record) => {
      record.title = "Call @one @two";
    },
  ],
  [
    "missing parent",
    taskPath,
    (record) => {
      record.parentId = "missing";
    },
  ],
  [
    "missing dependency",
    taskPath,
    (record) => {
      record.dependencyIds = ["missing"];
    },
  ],
  [
    "duplicate dependencies",
    taskPath,
    (record) => {
      record.dependencyIds = [doneId, doneId];
    },
  ],
  [
    "self dependency",
    taskPath,
    (record) => {
      record.dependencyIds = [parentId];
    },
  ],
  [
    "active terminal timestamp",
    taskPath,
    (record) => {
      record.completedAt = record.createdAt;
    },
  ],
  [
    "terminal missing timestamp",
    `tasks/${doneId}.json`,
    (record) => {
      record.completedAt = null;
    },
  ],
  [
    "both terminal timestamps",
    `tasks/${doneId}.json`,
    (record) => {
      record.canceledAt = record.createdAt;
    },
  ],
  [
    "terminal invalid time",
    `tasks/${doneId}.json`,
    (record) => {
      record.completedAt = "2026-02-30T00:00:00Z";
    },
  ],
  [
    "duplicate sibling member",
    "order/root.json",
    (record) => {
      record.taskIds = [parentId, parentId];
    },
  ],
  [
    "unknown order field",
    "order/root.json",
    (record) => {
      record.extra = "preserve me";
    },
  ],
  [
    "ambiguous root scope",
    "order/root.json",
    (record) => {
      record.parentId = "root";
    },
  ],
  [
    "wrong order filename",
    `order/${parentId}.json`,
    (record) => {
      record.parentId = childId;
    },
  ],
  [
    "stale task hash",
    taskPath,
    (record) => {
      record.title = "do not import";
    },
    false,
  ],
  [
    "stale order hash",
    "order/root.json",
    (record) => {
      record.taskIds = (record.taskIds as string[]).reverse();
    },
    false,
  ],
];
for (const [name, relativePath, edit, rehash] of invalidEdits) {
  test(`strict v1 source refuses ${name} without source writes`, (t) => {
    const { root } = setup(t);
    patch(root, relativePath, edit, rehash);
    invalid(root);
  });
}

for (const name of [
  "workspace.sync-conflict-device.json",
  "unknown.json",
  "tasks/extra.txt",
  "tasks/a.sync-conflict-device.json",
  "order/root.sync-conflict-device.json",
]) {
  test(`strict v1 source refuses unknown/conflicted entry ${name}`, (t) => {
    const { root } = setup(t);
    writeFileSync(path.join(root, name), "preserved raw bytes");
    invalid(root, name);
  });
}

for (const name of ["workspace.json", "tasks", taskPath]) {
  test(`strict v1 source refuses incomplete inventory missing ${name}`, (t) => {
    const { root } = setup(t);
    rmSync(path.join(root, name), { recursive: true });
    invalid(root);
  });
}

for (const [name, bytes] of [
  [
    "duplicate decoded member",
    Buffer.from(
      '{"format":"tasks.workspace","formatVersion":1,"workspaceId":"secret","schemaVersion":1,"schema\\u0056ersion":1}',
    ),
  ],
  ["nonfinite number", Buffer.from('{"value":1e999}')],
  ["unpaired surrogate", Buffer.from('{"value":"\\ud800"}')],
  ["UTF-8 BOM", Buffer.from('\ufeff{"schemaVersion":1}')],
  ["invalid UTF-8", Buffer.from([0xff])],
  ["partial JSON", Buffer.from('{"format":')],
] as const) {
  test(`strict v1 JSON refuses ${name} with safe path/field diagnostics`, (t) => {
    const { root } = setup(t);
    writeFileSync(path.join(root, taskPath), bytes);
    invalid(root, taskPath, "JSON");
    assert.throws(
      () => planSchema1Conversion(root),
      (error: unknown) => {
        assert.ok(error instanceof Schema1MigrationSourceError);
        assert.equal(error.details.taskId, parentId);
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
  });
}

test("strict v1 source refuses complete but cyclic parent/dependency graphs", (t) => {
  const { root } = setup(t);
  patch(root, `tasks/${childId}.json`, (record) => {
    record.dependencyIds = [parentId];
  });
  patch(root, taskPath, (record) => {
    record.dependencyIds = [childId];
  });
  invalid(root, `tasks/${childId}.json`, "dependencyIds");
  patch(root, taskPath, (record) => {
    record.dependencyIds = [];
    record.parentId = childId;
  });
  patch(root, "order/root.json", (record) => {
    record.taskIds = (record.taskIds as string[]).filter((id) => id !== parentId);
  });
  cpSync(path.join(root, `order/${parentId}.json`), path.join(root, `order/${childId}.json`));
  patch(root, `order/${childId}.json`, (record) => {
    record.parentId = childId;
    record.taskIds = [parentId];
  });
  invalid(root, `tasks/${childId}.json`, "parentId");
});

test("strict v1 source refuses empty order for nonexistent parent", (t) => {
  const { root } = setup(t);
  cpSync(path.join(root, `order/${parentId}.json`), path.join(root, "order/missing.json"));
  patch(root, "order/missing.json", (record) => {
    record.parentId = "missing";
    record.taskIds = [];
  });
  invalid(root, "order/missing.json", "parentId");
});

test(
  "strict v1 source conservatively refuses ASCII case aliases even on case-sensitive Linux",
  { skip: process.platform !== "linux" },
  (t) => {
    const { root } = setup(t);
    cpSync(path.join(root, taskPath), path.join(root, `tasks/${parentId.toUpperCase()}.json`));
    invalid(root, "tasks", "filenames");
  },
);

for (const relativePath of [
  taskPath,
  "workspace.json",
  "tasks",
  "order",
  ".stignore",
  "tasks/.syncthing.unsafe.tmp",
]) {
  test(
    `strict v1 source refuses descendant symlink ${relativePath} without following or modifying it`,
    { skip: process.platform === "win32" },
    (t) => {
      const { directory, root } = setup(t);
      const target = path.join(directory, "outside");
      if (relativePath === "tasks" || relativePath === "order") {
        renameSync(path.join(root, relativePath), target);
        symlinkSync(target, path.join(root, relativePath), "dir");
      } else {
        writeFileSync(target, "external bytes");
        rmSync(path.join(root, relativePath), { force: true });
        symlinkSync(target, path.join(root, relativePath));
      }
      const before = tree(directory);
      invalid(root);
      assert.deepEqual(tree(directory), before);
    },
  );
}

const validTimes = [
  ["2026-09-08T14:00:00.123+02:00", "2026-09-08T12:00:00.123Z"],
  ["2026-01-01T00:00:00-01:30", "2026-01-01T01:30:00.000Z"],
  ["2026-01-01t00:00:00.12z", "2026-01-01T00:00:00.120Z"],
  ["2026-01-01T00:00:00.123000000Z", "2026-01-01T00:00:00.123Z"],
  ["0000-02-29T00:00:00Z", "0000-02-29T00:00:00.000Z"],
  ["2000-02-29T00:00:00+00:00", "2000-02-29T00:00:00.000Z"],
  ["9999-12-31T23:59:59.999Z", "9999-12-31T23:59:59.999Z"],
];
for (const [input, expected] of validTimes) {
  test(`migration normalizes lossless instant ${input}`, () => {
    assert.equal(normalizeSchema1MigrationTimestamp(input, taskPath, "createdAt"), expected);
  });
}
for (const input of [
  "2026-09-08T14:00:00-00:00",
  "2026-09-08T14:00:00.1231Z",
  "2026-09-08T14:00:00.00000001Z",
  "2026-02-29T00:00:00Z",
  "1900-02-29T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-00-01T00:00:00Z",
  "2026-01-00T00:00:00Z",
  "2026-01-01T24:00:00Z",
  "2026-01-01T00:60:00Z",
  "2026-01-01T00:00:60Z",
  "2026-01-01T00:00:00+24:00",
  "2026-01-01T00:00:00+00:60",
  "0000-01-01T00:00:00+00:01",
  "9999-12-31T23:59:59-00:01",
  "10000-01-01T00:00:00Z",
  "2026-01-01",
  "2026-01-01T00:00:00",
  " 2026-01-01T00:00:00Z",
  "2026-01-01T00:00:00Z ",
]) {
  test(`migration refuses ambiguous/invalid/lossy instant ${input}`, (t) => {
    const { root } = setup(t);
    patch(root, taskPath, (record) => {
      record.createdAt = input;
    });
    invalid(root, taskPath, "createdAt");
  });
}
