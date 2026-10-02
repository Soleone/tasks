import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { CanonicalOrderFile, CanonicalTaskFile, CanonicalWorkspaceFile } from "./canonicalWorkspace.js";
import { CommandError } from "./errors.js";
import { contentHash } from "./requestHash.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2RegularFile, type V2FileObservation } from "./v2CanonicalReader.js";
import { V2GraphError, validateV2Graph } from "./v2TaskModel.js";

export type V1MigrationSnapshot = {
  rootPath: string;
  rootIdentity: string;
  directories: { relativePath: string; identity: string }[];
  workspace: CanonicalWorkspaceFile;
  tasks: CanonicalTaskFile[];
  orders: CanonicalOrderFile[];
  files: V2FileObservation[];
};

export type V1MigrationDiagnostic = { path: string; taskId?: string; field: string; reason: string };

export class V1MigrationSourceError extends CommandError {
  readonly details: V1MigrationDiagnostic;

  constructor(code: "MIGRATION_INVALID_SOURCE" | "MIGRATION_CONFLICT", details: V1MigrationDiagnostic) {
    super(code, `${details.path}: ${details.field}: ${details.reason}`);
    this.details = details;
  }
}

export function invalidV1Source(relativePath: string, field: string, reason: string): never {
  const taskId = /^tasks\/([A-Za-z0-9_-]+)\.json$/.exec(relativePath)?.[1];
  throw new V1MigrationSourceError("MIGRATION_INVALID_SOURCE", { path: relativePath, ...(taskId ? { taskId } : {}), field, reason });
}

function changedV1Source(relativePath: string): never {
  throw new V1MigrationSourceError("MIGRATION_CONFLICT", { path: relativePath, field: "inventory", reason: "source changed during observation" });
}

function sourceBoundary<T>(relativePath: string, field: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof V1MigrationSourceError) throw error;
    if (error instanceof CommandError && error.code === "STALE_FILE") changedV1Source(relativePath);
    return invalidV1Source(relativePath, field, field === "JSON" ? "invalid syntax, encoding or duplicate members" : "missing, unreadable or unsafe entry");
  }
}

function recordFields(value: unknown, fields: readonly string[], relativePath: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidV1Source(relativePath, "fields", "expected an object");
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find((field) => !fields.includes(field));
  // Unknown member names may themselves contain task text, so do not echo them.
  if (unexpected !== undefined) invalidV1Source(relativePath, "fields", "unsupported member");
  const missing = fields.find((field) => !Object.hasOwn(record, field));
  if (missing !== undefined) invalidV1Source(relativePath, missing, "missing required member");
  return record;
}

const safeId = /^[A-Za-z0-9_-]+$/;
const hash = /^[a-f0-9]{64}$/;
const taskFields = ["format", "formatVersion", "workspaceId", "id", "title", "descriptionMarkdown", "status", "priority", "parentId", "dependencyIds", "createdAt", "updatedAt", "completedAt", "canceledAt", "sync"];
const orderFields = ["format", "formatVersion", "workspaceId", "parentId", "taskIds", "sync"];

function requireId(value: unknown, relativePath: string, field: string): void {
  if (typeof value !== "string" || !safeId.test(value)) invalidV1Source(relativePath, field, "unsafe or missing ID");
}

function requireIds(value: unknown, relativePath: string, field: string): asserts value is string[] {
  if (!Array.isArray(value)) invalidV1Source(relativePath, field, "expected ID array");
  for (const id of value) requireId(id, relativePath, field);
  if (new Set(value).size !== value.length) invalidV1Source(relativePath, field, "duplicate IDs");
}

function verifyV1Record(record: Record<string, unknown>, workspaceId: string, relativePath: string, format: string): void {
  if (record.format !== format) invalidV1Source(relativePath, "format", "unsupported record format");
  if (record.formatVersion !== 1) invalidV1Source(relativePath, "formatVersion", "unsupported record version");
  if (record.workspaceId !== workspaceId) invalidV1Source(relativePath, "workspaceId", "does not match descriptor");
  const sync = recordFields(record.sync, ["revision", "modifiedBy", "basedOnHash", "contentHash"], relativePath);
  if (!Number.isSafeInteger(sync.revision) || (sync.revision as number) < 1) invalidV1Source(relativePath, "sync.revision", "expected positive safe integer");
  if (typeof sync.modifiedBy !== "string" || sync.modifiedBy.trim() === "") invalidV1Source(relativePath, "sync.modifiedBy", "expected nonempty writer label");
  if (sync.basedOnHash !== null && (typeof sync.basedOnHash !== "string" || !hash.test(sync.basedOnHash))) invalidV1Source(relativePath, "sync.basedOnHash", "expected prior hash or null");
  if (typeof sync.contentHash !== "string" || !hash.test(sync.contentHash)) invalidV1Source(relativePath, "sync.contentHash", "expected SHA-256 hash");
  const { contentHash: expected, ...withoutHash } = sync;
  if (contentHash({ ...record, sync: withoutHash }) !== expected) invalidV1Source(relativePath, "sync.contentHash", "content hash mismatch");
}

/** RFC 3339 instants only; Date alone silently normalizes invalid calendar dates. */
export function normalizeV1MigrationTimestamp(value: unknown, relativePath: string, field: string): string {
  if (typeof value !== "string") invalidV1Source(relativePath, field, "expected timestamp");
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalidV1Source(relativePath, field, "expected explicit-offset RFC 3339 instant");
  const [, calendar, time, fraction = "", offset] = match;
  if (offset === "-00:00") invalidV1Source(relativePath, field, "unknown UTC offset");
  if (/[^0]/.test(fraction.slice(3))) invalidV1Source(relativePath, field, "sub-millisecond instant would lose precision");
  const localIso = `${calendar}T${time}.${fraction.slice(0, 3).padEnd(3, "0")}Z`;
  const local = new Date(localIso);
  if (!Number.isFinite(local.getTime()) || local.toISOString() !== localIso) invalidV1Source(relativePath, field, "invalid calendar or clock time");
  const hours = /^[Zz]$/.test(offset) ? 0 : Number(offset.slice(1, 3));
  const minutes = /^[Zz]$/.test(offset) ? 0 : Number(offset.slice(4, 6));
  if (hours > 23 || minutes > 59) invalidV1Source(relativePath, field, "invalid UTC offset");
  const delta = (hours * 60 + minutes) * 60_000 * (offset[0] === "-" ? -1 : 1);
  const normalized = new Date(local.getTime() - delta).toISOString();
  if (!/^\d{4}-/.test(normalized)) invalidV1Source(relativePath, field, "instant is outside target year range");
  return normalized;
}

function validateV1Task(value: unknown, workspaceId: string, relativePath: string): CanonicalTaskFile {
  const record = recordFields(value, taskFields, relativePath);
  verifyV1Record(record, workspaceId, relativePath, "tasks.task");
  requireId(record.id, relativePath, "id");
  if (`tasks/${record.id}.json` !== relativePath) invalidV1Source(relativePath, "id", "filename does not match exact ID spelling");
  if (typeof record.title !== "string" || record.title.trim() === "" || record.title.length > 1000) invalidV1Source(relativePath, "title", "invalid legacy title");
  if (typeof record.descriptionMarkdown !== "string" || record.descriptionMarkdown.length > 10000) invalidV1Source(relativePath, "descriptionMarkdown", "invalid Markdown string");
  if (!["open", "in_progress", "paused", "done", "canceled"].includes(record.status as string)) invalidV1Source(relativePath, "status", "unsupported status");
  if (!Number.isInteger(record.priority) || (record.priority as number) < 0 || (record.priority as number) > 4) invalidV1Source(relativePath, "priority", "expected integer 0–4");
  if (record.parentId !== null) requireId(record.parentId, relativePath, "parentId");
  requireIds(record.dependencyIds, relativePath, "dependencyIds");
  normalizeV1MigrationTimestamp(record.createdAt, relativePath, "createdAt");
  normalizeV1MigrationTimestamp(record.updatedAt, relativePath, "updatedAt");
  for (const [field, status] of [["completedAt", "done"], ["canceledAt", "canceled"]]) {
    if ((record.status === status) !== (record[field] !== null)) invalidV1Source(relativePath, field, "inconsistent terminal timestamp");
    if (record[field] !== null) normalizeV1MigrationTimestamp(record[field], relativePath, field);
  }
  return record as unknown as CanonicalTaskFile;
}

function validateV1Order(value: unknown, workspaceId: string, relativePath: string): CanonicalOrderFile {
  const record = recordFields(value, orderFields, relativePath);
  verifyV1Record(record, workspaceId, relativePath, "tasks.sibling-order");
  if (record.parentId !== null) requireId(record.parentId, relativePath, "parentId");
  const expectedPath = `order/${record.parentId === null ? "root" : record.parentId}.json`;
  if (expectedPath !== relativePath || (relativePath === "order/root.json" && record.parentId !== null)) invalidV1Source(relativePath, "parentId", "filename does not match unambiguous scope");
  requireIds(record.taskIds, relativePath, "taskIds");
  return record as unknown as CanonicalOrderFile;
}

function verifyV1Relationships(tasks: CanonicalTaskFile[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const relativePath = `tasks/${task.id}.json`;
    if (task.parentId !== null && !byId.has(task.parentId)) invalidV1Source(relativePath, "parentId", "missing referenced task");
    if (task.dependencyIds.some((id) => !byId.has(id))) invalidV1Source(relativePath, "dependencyIds", "missing referenced task");
  }
  try {
    validateV2Graph(tasks);
  } catch (error) {
    if (!(error instanceof V2GraphError)) throw error;
    invalidV1Source(`tasks/${error.taskId}.json`, error.relation, "cyclic relationship graph");
  }
}

function verifyV1Scopes(tasks: CanonicalTaskFile[], orders: CanonicalOrderFile[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const members = new Map<string | null, Set<string>>([[null, new Set()]]);
  for (const task of tasks) {
    if (!members.has(task.parentId)) members.set(task.parentId, new Set());
    members.get(task.parentId)!.add(task.id);
  }
  const byScope = new Map(orders.map((order) => [order.parentId, order]));
  if (byScope.size !== orders.length) invalidV1Source("order", "parentId", "duplicate sibling scopes");
  for (const order of orders) {
    const relativePath = `order/${order.parentId ?? "root"}.json`;
    if (order.parentId !== null && !byId.has(order.parentId)) invalidV1Source(relativePath, "parentId", "missing referenced parent");
    const expected = members.get(order.parentId) ?? new Set<string>();
    if (order.taskIds.length !== expected.size || order.taskIds.some((id) => !expected.has(id))) invalidV1Source(relativePath, "taskIds", "sequence must contain every sibling exactly once, including inactive tasks");
  }
  for (const parentId of members.keys()) {
    if (!byScope.has(parentId)) invalidV1Source(`order/${parentId ?? "root"}.json`, "taskIds", "missing complete sibling sequence");
  }
}

type DirectoryInventory = { relativePath: string; identity: string; names: string[] };

function directoryInventory(rootPath: string, relativePath: string): DirectoryInventory {
  return sourceBoundary(relativePath, "directory", () => {
    const directory = path.join(rootPath, relativePath);
    const stat = lstatSync(directory, { bigint: true });
    if (!stat.isDirectory()) invalidV1Source(relativePath, "directory", "expected physical directory");
    const names = readdirSync(directory).sort();
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) invalidV1Source(relativePath, "filenames", "ambiguous ASCII case aliases");
    return { relativePath, identity: `${stat.dev}:${stat.ino}`, names };
  });
}

function transferTemporary(name: string): boolean {
  return name.startsWith(".syncthing.") && name.endsWith(".tmp");
}

function validateV1Descriptor(value: unknown): CanonicalWorkspaceFile {
  const descriptor = recordFields(value, ["format", "formatVersion", "workspaceId", "schemaVersion"], "workspace.json");
  if (descriptor.format !== "tasks.workspace" || descriptor.formatVersion !== 1 || descriptor.schemaVersion !== 1) invalidV1Source("workspace.json", "format/schemaVersion", "expected canonical v1 descriptor");
  if (typeof descriptor.workspaceId !== "string" || descriptor.workspaceId.trim() === "") invalidV1Source("workspace.json", "workspaceId", "expected nonempty workspace identity");
  return descriptor as unknown as CanonicalWorkspaceFile;
}

/** Descriptor-only control binding permits historical replay before live inventory checks. */
export function readV1MigrationRootDescriptor(directory: string): { rootPath: string; rootIdentity: string } {
  const rootPath = sourceBoundary(".", "directory", () => realpathSync(directory));
  const rootIdentity = sourceBoundary(".", "directory", () => {
    const stat = lstatSync(rootPath, { bigint: true });
    if (!stat.isDirectory()) invalidV1Source(".", "directory", "expected physical directory");
    return `${stat.dev}:${stat.ino}`;
  });
  const bytes = sourceBoundary("workspace.json", "file", () => readV2RegularFile(path.join(rootPath, "workspace.json")));
  validateV1Descriptor(sourceBoundary("workspace.json", "JSON", () => parseV2CanonicalJson(bytes)));
  return { rootPath, rootIdentity };
}

/** Strict read-only observation, not a writer lock, pinned filesystem snapshot or migration. */
export function readV1MigrationSnapshot(directory: string): V1MigrationSnapshot {
  const rootPath = sourceBoundary(".", "directory", () => realpathSync(directory));
  const inventories = [".", "tasks", "order"].map((relativePath) => directoryInventory(rootPath, relativePath));
  for (const name of inventories[0].names) {
    if (["workspace.json", "tasks", "order"].includes(name)) continue;
    if (![".stfolder", ".stignore", ".stversions"].includes(name) && !transferTemporary(name)) invalidV1Source(name, "entry", "unexpected root entry or conflict copy");
    sourceBoundary(name, "entry", () => {
      const stat = lstatSync(path.join(rootPath, name));
      const isDirectoryMarker = name === ".stfolder" || name === ".stversions";
      if (stat.isSymbolicLink() || (!stat.isFile() && !(isDirectoryMarker && stat.isDirectory()))) invalidV1Source(name, "entry", "unsafe transport artifact");
    });
  }
  const files: V2FileObservation[] = [];
  const readRecord = (relativePath: string): unknown => {
    const bytes = sourceBoundary(relativePath, "file", () => readV2RegularFile(path.join(rootPath, relativePath)));
    files.push({ relativePath, sha256: createHash("sha256").update(bytes).digest("hex") });
    return sourceBoundary(relativePath, "JSON", () => parseV2CanonicalJson(bytes));
  };
  const descriptor = validateV1Descriptor(readRecord("workspace.json"));
  const tasks: CanonicalTaskFile[] = [];
  const orders: CanonicalOrderFile[] = [];
  for (const inventory of inventories.slice(1)) {
    for (const name of inventory.names) {
      if (transferTemporary(name)) {
        sourceBoundary(`${inventory.relativePath}/${name}`, "file", () => {
          if (!lstatSync(path.join(rootPath, inventory.relativePath, name)).isFile()) invalidV1Source(`${inventory.relativePath}/${name}`, "file", "unsafe transfer temporary");
        });
        continue;
      }
      const relativePath = `${inventory.relativePath}/${name}`;
      if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) invalidV1Source(relativePath, "filename", "unexpected entry or unresolved conflict copy");
      const value = readRecord(relativePath);
      if (inventory.relativePath === "tasks") tasks.push(validateV1Task(value, descriptor.workspaceId, relativePath));
      else orders.push(validateV1Order(value, descriptor.workspaceId, relativePath));
    }
  }
  verifyV1Relationships(tasks);
  verifyV1Scopes(tasks, orders);
  for (const inventory of inventories) {
    const next = directoryInventory(rootPath, inventory.relativePath);
    if (next.identity !== inventory.identity || JSON.stringify(next.names) !== JSON.stringify(inventory.names)) changedV1Source(inventory.relativePath);
  }
  for (const file of files) {
    const bytes = sourceBoundary(file.relativePath, "file", () => readV2RegularFile(path.join(rootPath, file.relativePath)));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) changedV1Source(file.relativePath);
  }
  return {
    rootPath, rootIdentity: inventories[0].identity,
    directories: inventories.map(({ relativePath, identity }) => ({ relativePath, identity })),
    workspace: descriptor, tasks, orders, files,
  };
}
