import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readPhysicalRoot, readRegularFile, exactHash } from "./canonicalReader.js";
import { directoryIdentity } from "./copyFiles.js";
import type { RootBinding } from "./queryCache.js";
import { isRecord } from "./protocol.js";
import { validateGraph, validateManifest, validateTask } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

type DoctorFile = { relativePath: string; beforeBytes: string; identity: string };
export type DoctorVersion = {
  versionRef: string;
  relativePath: string;
  taskId: string;
  sha256: string;
  canonical: boolean;
  valid: boolean;
  task?: CanonicalTask;
};
export type DoctorRecord = { taskId: string } | { versionRef: string };
export type DoctorLink = {
  record: DoctorRecord;
  field: "parentId" | "dependencyIds";
  fromId: string;
};
export type DoctorIssue = {
  code: string;
  relativePath?: string;
  taskId?: string;
  field?: string;
  targetId?: string;
  issueId?: string;
  versionRefs?: string[];
};
export type DoctorSource = {
  root: RootBinding;
  taskDirectoryIdentity: string | null;
  rootEntries: string[];
  taskEntries: string[];
  files: DoctorFile[];
  issues: DoctorIssue[];
  versionRefs: DoctorVersion[];
  incomingLinks: DoctorLink[];
};
function fingerprint(value: unknown): string {
  return exactHash(Buffer.from(JSON.stringify(value)));
}
function fileIdentity(filePath: string): string {
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new CommandError("INVALID_CANONICAL", "doctor refuses unsafe file entries");
  return `${stat.dev}:${stat.ino}`;
}
function observeFile(source: DoctorSource, relativePath: string): Buffer | undefined {
  const target = path.join(source.root.rootPath, relativePath);
  try {
    const identity = fileIdentity(target),
      bytes = readRegularFile(target);
    if (fileIdentity(target) !== identity)
      throw new CommandError("STALE_FILE", "doctor file changed while opening");
    source.files.push({ relativePath, identity, beforeBytes: bytes.toString("base64") });
    return bytes;
  } catch (error) {
    if (error instanceof CommandError && ["STALE_FILE", "STALE_SCOPE"].includes(error.code))
      throw error;
    source.issues.push({ code: "UNREADABLE_OR_UNSAFE_ENTRY", relativePath });
    return undefined;
  }
}
function projectVersions(source: DoctorSource): void {
  for (const file of source.files) {
    const match = /^tasks\/([A-Za-z0-9_-]+)(\.sync-conflict-.+)?\.json$/.exec(file.relativePath);
    if (!match) continue;
    const taskId = match[1],
      bytes = Buffer.from(file.beforeBytes, "base64"),
      sha256 = exactHash(bytes);
    const version: DoctorVersion = {
      versionRef: `version-${fingerprint([file.relativePath, taskId, sha256])}`,
      relativePath: file.relativePath,
      taskId,
      sha256,
      canonical: !match[2],
      valid: false,
    };
    try {
      version.task = validateTask(parseCanonicalJson(bytes), taskId);
      version.valid = true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      source.issues.push({ code: "INVALID_TASK", taskId, relativePath: file.relativePath });
    }
    source.versionRefs.push(version);
  }
  const canonical = source.versionRefs.filter((version) => version.canonical),
    tasks = canonical.flatMap((version) => (version.task ? [version.task] : []));
  const ids = new Set(canonical.map((version) => version.taskId));
  for (const version of source.versionRefs) {
    if (!version.task) continue;
    const record = version.canonical
      ? { taskId: version.taskId }
      : { versionRef: version.versionRef };
    if (version.task.parentId !== null)
      source.incomingLinks.push({ record, field: "parentId", fromId: version.task.parentId });
    for (const id of version.task.dependencyIds)
      source.incomingLinks.push({ record, field: "dependencyIds", fromId: id });
    if (!version.canonical) continue;
    if (version.task.parentId !== null && !ids.has(version.task.parentId))
      source.issues.push({
        code: "DANGLING_LINK",
        taskId: version.taskId,
        field: "parentId",
        targetId: version.task.parentId,
      });
    for (const id of version.task.dependencyIds)
      if (!ids.has(id))
        source.issues.push({
          code: "DANGLING_LINK",
          taskId: version.taskId,
          field: "dependencyIds",
          targetId: id,
        });
  }
  for (const id of [
    ...new Set(
      source.versionRefs.filter((version) => !version.canonical).map((version) => version.taskId),
    ),
  ].sort()) {
    const versions = source.versionRefs
      .filter((version) => version.taskId === id)
      .map((version) => version.versionRef);
    source.issues.push({
      code: ids.has(id) ? "CONFLICT_COPY" : "ORPHAN_CONFLICT",
      taskId: id,
      issueId: `issue-${fingerprint([source.root, id, versions])}`,
      versionRefs: versions,
    });
  }
  if (
    canonical.every((version) => version.valid) &&
    !source.issues.some((issue) => issue.code === "DANGLING_LINK")
  ) {
    try {
      validateGraph(tasks);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      source.issues.push({ code: "INVALID_GRAPH" });
    }
  }
}

// Reconstruct private plan witnesses from exact raw originals, never trust cached task projections.
export function restoreDoctorSource(value: unknown): DoctorSource {
  if (!isRecord(value)) throw new Error("invalid doctor source");
  const saved = value as unknown as DoctorSource;
  if (
    !path.isAbsolute(saved.root.rootPath) ||
    !/^\d+:\d+$/.test(saved.root.rootIdentity) ||
    !/^\d+:\d+$/.test(saved.taskDirectoryIdentity ?? "")
  )
    throw new Error("invalid doctor binding");
  for (const names of [saved.rootEntries, saved.taskEntries]) {
    if (
      !Array.isArray(names) ||
      names.some((name) => typeof name !== "string" || !name || /[/\\]/.test(name)) ||
      JSON.stringify([...new Set(names)].sort()) !== JSON.stringify(names)
    )
      throw new Error("invalid doctor inventory");
  }
  if (
    !Array.isArray(saved.files) ||
    new Set(saved.files.map((file) => file.relativePath)).size !== saved.files.length
  )
    throw new Error("invalid doctor files");
  for (const file of saved.files) {
    if (
      (file.relativePath !== "workspace.json" &&
        !/^tasks\/[A-Za-z0-9_-]+(?:\.sync-conflict-[^/\\]+)?\.json$/.test(file.relativePath)) ||
      !/^\d+:\d+$/.test(file.identity) ||
      typeof file.beforeBytes !== "string" ||
      Buffer.from(file.beforeBytes, "base64").toString("base64") !== file.beforeBytes
    )
      throw new Error("invalid doctor original");
  }
  const descriptor = saved.files.find((file) => file.relativePath === "workspace.json");
  if (
    !descriptor ||
    !saved.rootEntries.includes("workspace.json") ||
    !saved.rootEntries.includes("tasks") ||
    JSON.stringify(
      saved.taskEntries
        .filter((name) => !(name.startsWith(".syncthing.") && name.endsWith(".tmp")))
        .map((name) => `tasks/${name}`),
    ) !==
      JSON.stringify(
        saved.files
          .filter((file) => file.relativePath.startsWith("tasks/"))
          .map((file) => file.relativePath),
      )
  )
    throw new Error("incomplete doctor originals");
  validateManifest(parseCanonicalJson(Buffer.from(descriptor.beforeBytes, "base64")));
  const source: DoctorSource = {
    root: saved.root,
    taskDirectoryIdentity: saved.taskDirectoryIdentity,
    rootEntries: saved.rootEntries,
    taskEntries: saved.taskEntries,
    files: saved.files,
    issues: [],
    versionRefs: [],
    incomingLinks: [],
  };
  projectVersions(source);
  return source;
}

/** Inspect raw candidates without treating an incomplete graph as ordinary task authority. */
export function readDoctorSource(directory: string): DoctorSource {
  const root = readPhysicalRoot(directory),
    rootEntries = readdirSync(root.rootPath).sort();
  const source: DoctorSource = {
    root,
    rootEntries,
    taskEntries: [],
    taskDirectoryIdentity: null,
    files: [],
    issues: [],
    versionRefs: [],
    incomingLinks: [],
  };
  const descriptor = observeFile(source, "workspace.json");
  let schema2 = false;
  if (descriptor) {
    try {
      validateManifest(parseCanonicalJson(descriptor));
      schema2 = true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      source.issues.push({ code: error.code, relativePath: "workspace.json" });
    }
  }
  for (const name of rootEntries.filter((name) =>
    /^workspace\.sync-conflict-.+\.json$/.test(name),
  )) {
    observeFile(source, name);
    source.issues.push({ code: "DESCRIPTOR_CONFLICT", relativePath: name });
  }
  const tasks = path.join(root.rootPath, "tasks"),
    stat = lstatSync(tasks, { throwIfNoEntry: false });
  if (schema2 && stat?.isDirectory() && !stat.isSymbolicLink()) {
    source.taskDirectoryIdentity = directoryIdentity(tasks);
    source.taskEntries = readdirSync(tasks).sort();
    for (const name of source.taskEntries) {
      if (name.startsWith(".syncthing.") && name.endsWith(".tmp")) continue;
      if (!/^[A-Za-z0-9_-]+(?:\.sync-conflict-.+)?\.json$/.test(name)) {
        source.issues.push({ code: "UNREADABLE_OR_UNSAFE_ENTRY", relativePath: `tasks/${name}` });
        continue;
      }
      observeFile(source, `tasks/${name}`);
    }
    const order = path.join(root.rootPath, "order"),
      orderStat = lstatSync(order, { throwIfNoEntry: false });
    if (
      orderStat &&
      (!orderStat.isDirectory() || orderStat.isSymbolicLink() || readdirSync(order).length)
    )
      source.issues.push({ code: "MIXED_FORMAT", relativePath: "order" });
    projectVersions(source);
  } else if (schema2)
    source.issues.push({ code: "UNREADABLE_OR_UNSAFE_ENTRY", relativePath: "tasks" });
  if (
    readPhysicalRoot(root.rootPath).rootIdentity !== root.rootIdentity ||
    JSON.stringify(readdirSync(root.rootPath).sort()) !== JSON.stringify(rootEntries) ||
    (source.taskDirectoryIdentity !== null &&
      (directoryIdentity(tasks) !== source.taskDirectoryIdentity ||
        JSON.stringify(readdirSync(tasks).sort()) !== JSON.stringify(source.taskEntries)))
  )
    throw new CommandError("STALE_SCOPE", "doctor tree changed during inspection");
  for (const file of source.files) {
    const target = path.join(root.rootPath, file.relativePath);
    if (
      fileIdentity(target) !== file.identity ||
      !readRegularFile(target).equals(Buffer.from(file.beforeBytes, "base64"))
    )
      throw new CommandError("STALE_FILE", "doctor bytes changed during inspection");
  }
  return source;
}
export function guardDoctorSource(source: DoctorSource): void {
  const current = readDoctorSource(source.root.rootPath);
  if (
    current.root.rootIdentity !== source.root.rootIdentity ||
    current.taskDirectoryIdentity !== source.taskDirectoryIdentity ||
    JSON.stringify(current.rootEntries) !== JSON.stringify(source.rootEntries) ||
    JSON.stringify(current.taskEntries) !== JSON.stringify(source.taskEntries) ||
    JSON.stringify(current.files) !== JSON.stringify(source.files) ||
    JSON.stringify(current.issues) !== JSON.stringify(source.issues)
  )
    throw new CommandError(
      "STALE_REPAIR_PLAN",
      "doctor source bytes, inventory or bindings changed",
    );
}
