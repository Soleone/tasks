import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "../backend/errors.js";
import { canonicalJson } from "../backend/canonicalJson.js";
import { parseCanonicalJson } from "../backend/strictJson.js";
import { readRegularFile, type FileObservation } from "../backend/canonicalReader.js";
import {
  GraphError,
  validateGraph,
  type TaskPriority,
  type TaskStatus,
} from "../backend/taskModel.js";

type CanonicalSync = {
  revision: number;
  modifiedBy: string;
  basedOnHash: string | null;
  contentHash: string;
};

type CanonicalWorkspaceFile = {
  format: "tasks.workspace";
  formatVersion: 1;
  workspaceId: string;
  schemaVersion: 1;
};

export type CanonicalTaskFile = {
  format: "tasks.task";
  formatVersion: 1;
  workspaceId: string;
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  parentId: string | null;
  dependencyIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  sync: CanonicalSync;
};

type CanonicalOrderFile = {
  format: "tasks.sibling-order";
  formatVersion: 1;
  workspaceId: string;
  parentId: string | null;
  taskIds: string[];
  sync: CanonicalSync;
};

function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export type Schema1MigrationSnapshot = {
  rootPath: string;
  rootIdentity: string;
  directories: { relativePath: string; identity: string }[];
  workspace: CanonicalWorkspaceFile;
  tasks: CanonicalTaskFile[];
  orders: CanonicalOrderFile[];
  files: FileObservation[];
};

export type Schema1MigrationDiagnostic = {
  path: string;
  taskId?: string;
  field: string;
  reason: string;
};

export class Schema1MigrationSourceError extends CommandError {
  readonly details: Schema1MigrationDiagnostic;

  constructor(
    code: "MIGRATION_INVALID_SOURCE" | "MIGRATION_CONFLICT",
    details: Schema1MigrationDiagnostic,
  ) {
    super(code, `${details.path}: ${details.field}: ${details.reason}`);
    this.details = details;
  }
}

export function invalidSchema1Source(relativePath: string, field: string, reason: string): never {
  const taskId = /^tasks\/([A-Za-z0-9_-]+)\.json$/.exec(relativePath)?.[1];
  throw new Schema1MigrationSourceError("MIGRATION_INVALID_SOURCE", {
    path: relativePath,
    ...(taskId ? { taskId } : {}),
    field,
    reason,
  });
}

function changedSchema1Source(relativePath: string): never {
  throw new Schema1MigrationSourceError("MIGRATION_CONFLICT", {
    path: relativePath,
    field: "inventory",
    reason: "source changed during observation",
  });
}

function sourceBoundary<T>(relativePath: string, field: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Schema1MigrationSourceError) throw error;
    if (error instanceof CommandError && error.code === "STALE_FILE")
      changedSchema1Source(relativePath);
    return invalidSchema1Source(
      relativePath,
      field,
      field === "JSON"
        ? "invalid syntax, encoding or duplicate members"
        : "missing, unreadable or unsafe entry",
    );
  }
}

function recordFields(
  value: unknown,
  fields: readonly string[],
  relativePath: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalidSchema1Source(relativePath, "fields", "expected an object");
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find((field) => !fields.includes(field));
  // Unknown member names may themselves contain task text, so do not echo them.
  if (unexpected !== undefined) invalidSchema1Source(relativePath, "fields", "unsupported member");
  const missing = fields.find((field) => !Object.hasOwn(record, field));
  if (missing !== undefined) invalidSchema1Source(relativePath, missing, "missing required member");
  return record;
}

const safeId = /^[A-Za-z0-9_-]+$/;
const hash = /^[a-f0-9]{64}$/;
const taskFields = [
  "format",
  "formatVersion",
  "workspaceId",
  "id",
  "title",
  "descriptionMarkdown",
  "status",
  "priority",
  "parentId",
  "dependencyIds",
  "createdAt",
  "updatedAt",
  "completedAt",
  "canceledAt",
  "sync",
];
const orderFields = ["format", "formatVersion", "workspaceId", "parentId", "taskIds", "sync"];

function requireId(value: unknown, relativePath: string, field: string): asserts value is string {
  if (typeof value !== "string" || !safeId.test(value))
    invalidSchema1Source(relativePath, field, "unsafe or missing ID");
}

function requireIds(
  value: unknown,
  relativePath: string,
  field: string,
): asserts value is string[] {
  if (!Array.isArray(value)) invalidSchema1Source(relativePath, field, "expected ID array");
  for (const id of value) requireId(id, relativePath, field);
  if (new Set(value).size !== value.length)
    invalidSchema1Source(relativePath, field, "duplicate IDs");
}

function verifySchema1Record(
  record: Record<string, unknown>,
  workspaceId: string,
  relativePath: string,
  format: string,
): void {
  if (record.format !== format)
    invalidSchema1Source(relativePath, "format", "unsupported record format");
  if (record.formatVersion !== 1)
    invalidSchema1Source(relativePath, "formatVersion", "unsupported record version");
  if (record.workspaceId !== workspaceId)
    invalidSchema1Source(relativePath, "workspaceId", "does not match descriptor");
  const sync = recordFields(
    record.sync,
    ["revision", "modifiedBy", "basedOnHash", "contentHash"],
    relativePath,
  );
  if (!Number.isSafeInteger(sync.revision) || (sync.revision as number) < 1)
    invalidSchema1Source(relativePath, "sync.revision", "expected positive safe integer");
  if (typeof sync.modifiedBy !== "string" || sync.modifiedBy.trim() === "")
    invalidSchema1Source(relativePath, "sync.modifiedBy", "expected nonempty writer label");
  if (
    sync.basedOnHash !== null &&
    (typeof sync.basedOnHash !== "string" || !hash.test(sync.basedOnHash))
  )
    invalidSchema1Source(relativePath, "sync.basedOnHash", "expected prior hash or null");
  if (typeof sync.contentHash !== "string" || !hash.test(sync.contentHash))
    invalidSchema1Source(relativePath, "sync.contentHash", "expected SHA-256 hash");
  const { contentHash: expected, ...withoutHash } = sync;
  if (contentHash({ ...record, sync: withoutHash }) !== expected)
    invalidSchema1Source(relativePath, "sync.contentHash", "content hash mismatch");
}

/** RFC 3339 instants only; Date alone silently normalizes invalid calendar dates. */
export function normalizeSchema1MigrationTimestamp(
  value: unknown,
  relativePath: string,
  field: string,
): string {
  if (typeof value !== "string") invalidSchema1Source(relativePath, field, "expected timestamp");
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match)
    invalidSchema1Source(relativePath, field, "expected explicit-offset RFC 3339 instant");
  const [, calendar, time, fraction = "", offset] = match;
  if (offset === "-00:00") invalidSchema1Source(relativePath, field, "unknown UTC offset");
  if (/[^0]/.test(fraction.slice(3)))
    invalidSchema1Source(relativePath, field, "sub-millisecond instant would lose precision");
  const localIso = `${calendar}T${time}.${fraction.slice(0, 3).padEnd(3, "0")}Z`;
  const local = new Date(localIso);
  if (!Number.isFinite(local.getTime()) || local.toISOString() !== localIso)
    invalidSchema1Source(relativePath, field, "invalid calendar or clock time");
  const hours = /^[Zz]$/.test(offset) ? 0 : Number(offset.slice(1, 3));
  const minutes = /^[Zz]$/.test(offset) ? 0 : Number(offset.slice(4, 6));
  if (hours > 23 || minutes > 59) invalidSchema1Source(relativePath, field, "invalid UTC offset");
  const delta = (hours * 60 + minutes) * 60_000 * (offset[0] === "-" ? -1 : 1);
  const normalized = new Date(local.getTime() - delta).toISOString();
  if (!/^\d{4}-/.test(normalized))
    invalidSchema1Source(relativePath, field, "instant is outside target year range");
  return normalized;
}

function validateSchema1Task(
  value: unknown,
  workspaceId: string,
  relativePath: string,
): CanonicalTaskFile {
  const record = recordFields(value, taskFields, relativePath);
  verifySchema1Record(record, workspaceId, relativePath, "tasks.task");
  requireId(record.id, relativePath, "id");
  if (`tasks/${record.id}.json` !== relativePath)
    invalidSchema1Source(relativePath, "id", "filename does not match exact ID spelling");
  if (typeof record.title !== "string" || record.title.trim() === "" || record.title.length > 1000)
    invalidSchema1Source(relativePath, "title", "invalid legacy title");
  if (typeof record.descriptionMarkdown !== "string" || record.descriptionMarkdown.length > 10000)
    invalidSchema1Source(relativePath, "descriptionMarkdown", "invalid Markdown string");
  if (!["open", "in_progress", "paused", "done", "canceled"].includes(record.status as string))
    invalidSchema1Source(relativePath, "status", "unsupported status");
  if (
    !Number.isInteger(record.priority) ||
    (record.priority as number) < 0 ||
    (record.priority as number) > 4
  )
    invalidSchema1Source(relativePath, "priority", "expected integer 0–4");
  if (record.parentId !== null) requireId(record.parentId, relativePath, "parentId");
  requireIds(record.dependencyIds, relativePath, "dependencyIds");
  normalizeSchema1MigrationTimestamp(record.createdAt, relativePath, "createdAt");
  normalizeSchema1MigrationTimestamp(record.updatedAt, relativePath, "updatedAt");
  for (const [field, status] of [
    ["completedAt", "done"],
    ["canceledAt", "canceled"],
  ]) {
    if ((record.status === status) !== (record[field] !== null))
      invalidSchema1Source(relativePath, field, "inconsistent terminal timestamp");
    if (record[field] !== null)
      normalizeSchema1MigrationTimestamp(record[field], relativePath, field);
  }
  return record as unknown as CanonicalTaskFile;
}

function validateSchema1Order(
  value: unknown,
  workspaceId: string,
  relativePath: string,
): CanonicalOrderFile {
  const record = recordFields(value, orderFields, relativePath);
  verifySchema1Record(record, workspaceId, relativePath, "tasks.sibling-order");
  if (record.parentId !== null) requireId(record.parentId, relativePath, "parentId");
  const expectedPath = `order/${record.parentId === null ? "root" : record.parentId}.json`;
  if (
    expectedPath !== relativePath ||
    (relativePath === "order/root.json" && record.parentId !== null)
  )
    invalidSchema1Source(relativePath, "parentId", "filename does not match unambiguous scope");
  requireIds(record.taskIds, relativePath, "taskIds");
  return record as unknown as CanonicalOrderFile;
}

function verifySchema1Relationships(tasks: CanonicalTaskFile[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const relativePath = `tasks/${task.id}.json`;
    if (task.parentId !== null && !byId.has(task.parentId))
      invalidSchema1Source(relativePath, "parentId", "missing referenced task");
    if (task.dependencyIds.some((id) => !byId.has(id)))
      invalidSchema1Source(relativePath, "dependencyIds", "missing referenced task");
  }
  try {
    validateGraph(tasks);
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    invalidSchema1Source(`tasks/${error.taskId}.json`, error.relation, "cyclic relationship graph");
  }
}

function verifySchema1Scopes(tasks: CanonicalTaskFile[], orders: CanonicalOrderFile[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const members = new Map<string | null, Set<string>>([[null, new Set()]]);
  for (const task of tasks) {
    if (!members.has(task.parentId)) members.set(task.parentId, new Set());
    members.get(task.parentId)!.add(task.id);
  }
  const byScope = new Map(orders.map((order) => [order.parentId, order]));
  if (byScope.size !== orders.length)
    invalidSchema1Source("order", "parentId", "duplicate sibling scopes");
  for (const order of orders) {
    const relativePath = `order/${order.parentId ?? "root"}.json`;
    if (order.parentId !== null && !byId.has(order.parentId))
      invalidSchema1Source(relativePath, "parentId", "missing referenced parent");
    const expected = members.get(order.parentId) ?? new Set<string>();
    if (order.taskIds.length !== expected.size || order.taskIds.some((id) => !expected.has(id)))
      invalidSchema1Source(
        relativePath,
        "taskIds",
        "sequence must contain every sibling exactly once, including inactive tasks",
      );
  }
  for (const parentId of members.keys()) {
    if (!byScope.has(parentId))
      invalidSchema1Source(
        `order/${parentId ?? "root"}.json`,
        "taskIds",
        "missing complete sibling sequence",
      );
  }
}

type DirectoryInventory = { relativePath: string; identity: string; names: string[] };

function directoryInventory(rootPath: string, relativePath: string): DirectoryInventory {
  return sourceBoundary(relativePath, "directory", () => {
    const directory = path.join(rootPath, relativePath);
    const stat = lstatSync(directory, { bigint: true });
    if (!stat.isDirectory())
      invalidSchema1Source(relativePath, "directory", "expected physical directory");
    const names = readdirSync(directory).sort();
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length)
      invalidSchema1Source(relativePath, "filenames", "ambiguous ASCII case aliases");
    return { relativePath, identity: `${stat.dev}:${stat.ino}`, names };
  });
}

function transferTemporary(name: string): boolean {
  return name.startsWith(".syncthing.") && name.endsWith(".tmp");
}

function validateSchema1Descriptor(value: unknown): CanonicalWorkspaceFile {
  const descriptor = recordFields(
    value,
    ["format", "formatVersion", "workspaceId", "schemaVersion"],
    "workspace.json",
  );
  if (
    descriptor.format !== "tasks.workspace" ||
    descriptor.formatVersion !== 1 ||
    descriptor.schemaVersion !== 1
  )
    invalidSchema1Source(
      "workspace.json",
      "format/schemaVersion",
      "expected canonical v1 descriptor",
    );
  if (typeof descriptor.workspaceId !== "string" || descriptor.workspaceId.trim() === "")
    invalidSchema1Source("workspace.json", "workspaceId", "expected nonempty workspace identity");
  return descriptor as unknown as CanonicalWorkspaceFile;
}

/** Descriptor-only control binding permits historical replay before live inventory checks. */
export function readSchema1MigrationRootDescriptor(directory: string): {
  rootPath: string;
  rootIdentity: string;
} {
  const rootPath = sourceBoundary(".", "directory", () => realpathSync(directory));
  const rootIdentity = sourceBoundary(".", "directory", () => {
    const stat = lstatSync(rootPath, { bigint: true });
    if (!stat.isDirectory()) invalidSchema1Source(".", "directory", "expected physical directory");
    return `${stat.dev}:${stat.ino}`;
  });
  const bytes = sourceBoundary("workspace.json", "file", () =>
    readRegularFile(path.join(rootPath, "workspace.json")),
  );
  validateSchema1Descriptor(
    sourceBoundary("workspace.json", "JSON", () => parseCanonicalJson(bytes)),
  );
  return { rootPath, rootIdentity };
}

/** Strict read-only observation, not a writer lock, pinned filesystem snapshot or migration. */
export function readSchema1MigrationSnapshot(directory: string): Schema1MigrationSnapshot {
  const rootPath = sourceBoundary(".", "directory", () => realpathSync(directory));
  const inventories = [".", "tasks", "order"].map((relativePath) =>
    directoryInventory(rootPath, relativePath),
  );
  for (const name of inventories[0].names) {
    if (["workspace.json", "tasks", "order"].includes(name)) continue;
    const stat = sourceBoundary(name, "entry", () => lstatSync(path.join(rootPath, name)));
    // Other plain files at the top, like an old report, can't hold tasks and stay behind.
    if (stat.isFile() && !name.toLowerCase().endsWith(".json")) continue;
    if (![".stfolder", ".stignore", ".stversions"].includes(name) && !transferTemporary(name))
      invalidSchema1Source(name, "entry", "unexpected root entry or conflict copy");
    const isDirectoryMarker = name === ".stfolder" || name === ".stversions";
    if (stat.isSymbolicLink() || (!stat.isFile() && !(isDirectoryMarker && stat.isDirectory())))
      invalidSchema1Source(name, "entry", "unsafe transport artifact");
  }
  const files: FileObservation[] = [];
  const readRecord = (relativePath: string): unknown => {
    const bytes = sourceBoundary(relativePath, "file", () =>
      readRegularFile(path.join(rootPath, relativePath)),
    );
    files.push({ relativePath, sha256: createHash("sha256").update(bytes).digest("hex") });
    return sourceBoundary(relativePath, "JSON", () => parseCanonicalJson(bytes));
  };
  const descriptor = validateSchema1Descriptor(readRecord("workspace.json"));
  const tasks: CanonicalTaskFile[] = [];
  const orders: CanonicalOrderFile[] = [];
  for (const inventory of inventories.slice(1)) {
    for (const name of inventory.names) {
      if (transferTemporary(name)) {
        sourceBoundary(`${inventory.relativePath}/${name}`, "file", () => {
          if (!lstatSync(path.join(rootPath, inventory.relativePath, name)).isFile())
            invalidSchema1Source(
              `${inventory.relativePath}/${name}`,
              "file",
              "unsafe transfer temporary",
            );
        });
        continue;
      }
      const relativePath = `${inventory.relativePath}/${name}`;
      if (!/^[A-Za-z0-9_-]+\.json$/.test(name))
        invalidSchema1Source(
          relativePath,
          "filename",
          "unexpected entry or unresolved conflict copy",
        );
      const value = readRecord(relativePath);
      if (inventory.relativePath === "tasks")
        tasks.push(validateSchema1Task(value, descriptor.workspaceId, relativePath));
      else orders.push(validateSchema1Order(value, descriptor.workspaceId, relativePath));
    }
  }
  verifySchema1Relationships(tasks);
  verifySchema1Scopes(tasks, orders);
  for (const inventory of inventories) {
    const next = directoryInventory(rootPath, inventory.relativePath);
    if (
      next.identity !== inventory.identity ||
      JSON.stringify(next.names) !== JSON.stringify(inventory.names)
    )
      changedSchema1Source(inventory.relativePath);
  }
  for (const file of files) {
    const bytes = sourceBoundary(file.relativePath, "file", () =>
      readRegularFile(path.join(rootPath, file.relativePath)),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      changedSchema1Source(file.relativePath);
  }
  return {
    rootPath,
    rootIdentity: inventories[0].identity,
    directories: inventories.map(({ relativePath, identity }) => ({ relativePath, identity })),
    workspace: descriptor,
    tasks,
    orders,
    files,
  };
}
