import { generateKeyBetween } from "fractional-indexing";
import { CommandError } from "./errors.js";
import { assertArgs, isRecord } from "./protocol.js";
import type { DoctorRecord, DoctorSource, DoctorVersion } from "./doctorSource.js";
import { compareTasks, isOrderKey, validateGraph, validateTask, GraphError } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

type LinkChoice = {
  record: DoctorRecord;
  field: "parentId" | "dependencyIds";
  fromId: string;
  targetVersionRef: string;
};
type LinkEdit = { taskId: string; parentId?: string | null; removeDependencyIds?: string[] };
export type DoctorInput =
  | {
      kind: "keep-both";
      issueIds: string[];
      canonicalVersions: { issueId: string; versionRef: string }[];
      linkChoices: LinkChoice[];
    }
  | { kind: "repair-links"; edits: LinkEdit[] };
export type DoctorAllocation = { planId: string; cloneIds: Record<string, string> };
export type DoctorPlan = {
  format: "taskdb.doctor-plan";
  version: 1;
  planId: string;
  input: DoctorInput;
  source: DoctorSource;
  allocation: DoctorAllocation;
  nextTasks: CanonicalTask[];
  clones: { versionRef: string; taskId: string; parentId: string | null; orderKey: string }[];
  linkEdits: { taskId: string; parentId?: string | null; dependencyIds?: string[] }[];
  editedIds: string[];
  removedConflictPaths: string[];
};
function invalid(): never {
  throw new CommandError("INVALID_ARGUMENT", "invalid reviewed repair choices");
}
function stale(): never {
  throw new CommandError(
    "STALE_REPAIR_PLAN",
    "repair references or fixed identities are unavailable or stale",
  );
}
function safeId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
}
function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item === "") ||
    new Set(value).size !== value.length
  )
    invalid();
  return value as string[];
}
export function parseDoctorInput(args: Record<string, unknown>): DoctorInput {
  if (args.kind === "keep-both") {
    assertArgs(args, ["kind", "issueIds", "canonicalVersions", "linkChoices"]);
    const issueIds = strings(args.issueIds);
    if (
      !issueIds.length ||
      !Array.isArray(args.canonicalVersions) ||
      !Array.isArray(args.linkChoices)
    )
      invalid();
    const canonicalVersions = args.canonicalVersions.map((value) => {
      if (!isRecord(value)) invalid();
      assertArgs(value, ["issueId", "versionRef"]);
      if (
        typeof value.issueId !== "string" ||
        !value.issueId ||
        typeof value.versionRef !== "string" ||
        !value.versionRef
      )
        invalid();
      return { issueId: value.issueId, versionRef: value.versionRef };
    });
    if (
      canonicalVersions.length !== issueIds.length ||
      new Set(canonicalVersions.map((choice) => choice.issueId)).size !== issueIds.length ||
      canonicalVersions.some((choice) => !issueIds.includes(choice.issueId))
    )
      invalid();
    const linkChoices = args.linkChoices.map((value) => {
      if (!isRecord(value) || !isRecord(value.record)) invalid();
      assertArgs(value, ["record", "field", "fromId", "targetVersionRef"]);
      assertArgs(value.record, ["taskId", "versionRef"]);
      if (
        Object.keys(value.record).length !== 1 ||
        ("taskId" in value.record
          ? !safeId(value.record.taskId)
          : typeof value.record.versionRef !== "string" || !value.record.versionRef) ||
        !["parentId", "dependencyIds"].includes(value.field as string) ||
        !safeId(value.fromId) ||
        typeof value.targetVersionRef !== "string" ||
        !value.targetVersionRef
      )
        invalid();
      return {
        record: value.record as DoctorRecord,
        field: value.field as LinkChoice["field"],
        fromId: value.fromId,
        targetVersionRef: value.targetVersionRef,
      };
    });
    return { kind: "keep-both", issueIds, canonicalVersions, linkChoices };
  }
  if (args.kind !== "repair-links") invalid();
  assertArgs(args, ["kind", "edits"]);
  if (!Array.isArray(args.edits) || !args.edits.length) invalid();
  const edits = args.edits.map((value) => {
    if (!isRecord(value)) invalid();
    assertArgs(value, ["taskId", "parentId", "removeDependencyIds"]);
    if (
      !safeId(value.taskId) ||
      Object.keys(value).length < 2 ||
      ("parentId" in value && value.parentId !== null && !safeId(value.parentId))
    )
      invalid();
    const remove = "removeDependencyIds" in value ? strings(value.removeDependencyIds) : undefined;
    if (remove && (!remove.length || remove.some((id) => !safeId(id)))) invalid();
    return {
      taskId: value.taskId,
      ...("parentId" in value ? { parentId: value.parentId as string | null } : {}),
      ...(remove ? { removeDependencyIds: remove } : {}),
    };
  });
  if (new Set(edits.map((edit) => edit.taskId)).size !== edits.length) invalid();
  return { kind: "repair-links", edits };
}
export function doctorCloneVersions(input: DoctorInput, source: DoctorSource): DoctorVersion[] {
  if (input.kind === "repair-links") return [];
  return input.issueIds.flatMap((id) => {
    const issue = source.issues.find((issue) => issue.issueId === id);
    if (!issue) stale();
    if (issue.code !== "CONFLICT_COPY")
      throw new CommandError(
        "INVALID_ARGUMENT",
        "orphan or invalid conflict evidence requires explicit restore or reconciliation",
      );
    const versions = source.versionRefs.filter((version) =>
      issue.versionRefs!.includes(version.versionRef),
    );
    const chosen = input.canonicalVersions.find((choice) => choice.issueId === id)!.versionRef;
    if (!versions.some((version) => version.versionRef === chosen)) stale();
    if (versions.some((version) => !version.valid))
      throw new CommandError("INVALID_CANONICAL", "reviewed repair requires valid source versions");
    return versions.filter((version) => version.versionRef !== chosen);
  });
}
function prospectiveGraph(tasks: CanonicalTask[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (tasks.some((task) => task.parentId !== null && !ids.has(task.parentId)))
    throw new CommandError("INVALID_PARENT", "prospective repair still has a missing parent");
  if (tasks.some((task) => task.dependencyIds.some((id) => !ids.has(id))))
    throw new CommandError("INVALID_DEPENDENCY", "prospective repair still has a missing blocker");
  for (const task of tasks) validateTask(task, task.id);
  try {
    validateGraph(tasks);
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    throw new CommandError(
      error.relation === "parentId" ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE",
      "prospective reviewed repair graph is invalid",
    );
  }
}
function firstKey(task: CanonicalTask, tasks: CanonicalTask[]): string {
  const first = tasks
    .filter((other) => other.id !== task.id && other.parentId === task.parentId)
    .sort(compareTasks)[0];
  try {
    const key = generateKeyBetween(null, first?.orderKey ?? null);
    if (!isOrderKey(key)) throw Error("key limit");
    return key;
  } catch {
    throw new CommandError(
      "ORDER_KEY_LIMIT",
      "reviewed reparent allocation exceeds the canonical key limit",
    );
  }
}

export function buildDoctorPlan(
  input: DoctorInput,
  source: DoctorSource,
  allocation: DoctorAllocation,
): DoctorPlan {
  if (
    source.taskDirectoryIdentity === null ||
    source.issues.some((issue) =>
      ["UNREADABLE_OR_UNSAFE_ENTRY", "DESCRIPTOR_CONFLICT", "MIXED_FORMAT"].includes(issue.code),
    ) ||
    source.versionRefs.some((version) => version.canonical && !version.valid)
  )
    throw new CommandError(
      "INVALID_CANONICAL",
      "planning requires a complete safe schema-2 tree with valid canonical records",
    );
  const cloneVersions = doctorCloneVersions(input, source),
    cloneIds = Object.values(allocation.cloneIds);
  if (
    cloneIds.length !== cloneVersions.length ||
    cloneVersions.some((version) => !allocation.cloneIds[version.versionRef]) ||
    new Set(cloneIds).size !== cloneIds.length ||
    cloneIds.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
        source.versionRefs.some((version) => version.taskId === id),
    )
  )
    stale();
  const outputs = new Map<string, { source: DoctorVersion; task: CanonicalTask }>();
  for (const version of source.versionRefs.filter((version) => version.canonical && version.task))
    outputs.set(version.versionRef, { source: version, task: version.task! });
  const removedConflictPaths: string[] = [];
  if (input.kind === "keep-both") {
    for (const issueId of input.issueIds) {
      const issue = source.issues.find((issue) => issue.issueId === issueId)!;
      const chosen = input.canonicalVersions.find(
        (choice) => choice.issueId === issueId,
      )!.versionRef;
      for (const version of source.versionRefs.filter((version) =>
        issue.versionRefs!.includes(version.versionRef),
      )) {
        outputs.set(version.versionRef, {
          source: version,
          task: {
            ...version.task!,
            id:
              version.versionRef === chosen
                ? issue.taskId!
                : allocation.cloneIds[version.versionRef],
          },
        });
        if (!version.canonical) removedConflictPaths.push(version.relativePath);
      }
    }
    const splitIds = new Set(
      input.issueIds.map((id) => source.issues.find((issue) => issue.issueId === id)!.taskId),
    );
    const choices = new Map<string, LinkChoice>();
    for (const choice of input.linkChoices) {
      const record = choice.record;
      const sourceVersion =
        "taskId" in record
          ? source.versionRefs.find(
              (version) => version.canonical && version.taskId === record.taskId,
            )
          : source.versionRefs.find((version) => version.versionRef === record.versionRef);
      const target = outputs.get(choice.targetVersionRef);
      if (
        !sourceVersion ||
        !outputs.has(sourceVersion.versionRef) ||
        !target ||
        !splitIds.has(choice.fromId) ||
        target.source.taskId !== choice.fromId
      )
        stale();
      const key = JSON.stringify([sourceVersion.versionRef, choice.field, choice.fromId]);
      if (choices.has(key)) invalid();
      choices.set(key, choice);
    }
    for (const [ref, output] of outputs) {
      const links = source.incomingLinks.filter(
        (link) =>
          ("taskId" in link.record
            ? output.source.canonical && link.record.taskId === output.source.taskId
            : link.record.versionRef === ref) && splitIds.has(link.fromId),
      );
      const next = { ...output.task, dependencyIds: [...output.task.dependencyIds] };
      for (const link of links) {
        const key = JSON.stringify([ref, link.field, link.fromId]),
          choice = choices.get(key);
        if (!choice)
          throw new CommandError(
            "AMBIGUOUS_LINK",
            "every observed reference to a split task needs an explicit version choice",
          );
        const targetId = outputs.get(choice.targetVersionRef)!.task.id;
        if (link.field === "parentId") next.parentId = targetId;
        else
          next.dependencyIds = next.dependencyIds.map((id) => (id === link.fromId ? targetId : id));
        choices.delete(key);
      }
      next.dependencyIds.sort();
      output.task = next;
    }
    if (choices.size) invalid();
  } else {
    for (const edit of input.edits) {
      const output = [...outputs.values()].find((output) => output.task.id === edit.taskId);
      if (!output) stale();
      const old = output.task;
      if (
        "parentId" in edit &&
        !source.issues.some(
          (issue) =>
            issue.code === "DANGLING_LINK" && issue.taskId === old.id && issue.field === "parentId",
        )
      )
        invalid();
      if (
        edit.removeDependencyIds?.some(
          (id) =>
            !source.issues.some(
              (issue) =>
                issue.code === "DANGLING_LINK" &&
                issue.taskId === old.id &&
                issue.field === "dependencyIds" &&
                issue.targetId === id,
            ),
        )
      )
        invalid();
      output.task = {
        ...old,
        ...("parentId" in edit ? { parentId: edit.parentId! } : {}),
        dependencyIds: old.dependencyIds.filter((id) => !edit.removeDependencyIds?.includes(id)),
      };
    }
  }
  const nextTasks = [...outputs.values()].map((output) => output.task),
    editedIds: string[] = [],
    linkEdits: DoctorPlan["linkEdits"] = [];
  prospectiveGraph(nextTasks);
  for (const output of [...outputs.values()].sort((a, b) =>
    a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0,
  )) {
    const task = output.task,
      before = output.source.task!;
    const parentChanged = before.parentId !== task.parentId,
      dependenciesChanged =
        JSON.stringify(before.dependencyIds) !== JSON.stringify(task.dependencyIds);
    if (!parentChanged && !dependenciesChanged) continue;
    if (
      parentChanged &&
      task.parentId !== null &&
      !nextTasks.some((target) => target.id === task.parentId && target.status !== "canceled")
    )
      throw new CommandError("INVALID_PARENT", "chosen parent must exist and not be canceled");
    if (
      dependenciesChanged &&
      task.dependencyIds.some(
        (id) =>
          !before.dependencyIds.includes(id) &&
          !nextTasks.some((target) => target.id === id && target.status !== "canceled"),
      )
    )
      throw new CommandError("INVALID_DEPENDENCY", "chosen blocker must exist and not be canceled");
    if (parentChanged) task.orderKey = firstKey(task, nextTasks);
    editedIds.push(task.id);
    linkEdits.push({
      taskId: task.id,
      ...(parentChanged ? { parentId: task.parentId } : {}),
      ...(dependenciesChanged ? { dependencyIds: task.dependencyIds } : {}),
    });
  }
  prospectiveGraph(nextTasks);
  return {
    format: "taskdb.doctor-plan",
    version: 1,
    planId: allocation.planId,
    input,
    source,
    allocation,
    nextTasks,
    clones: cloneVersions.map((version) => {
      const task = outputs.get(version.versionRef)!.task;
      return {
        versionRef: version.versionRef,
        taskId: task.id,
        parentId: task.parentId,
        orderKey: task.orderKey,
      };
    }),
    editedIds,
    linkEdits,
    removedConflictPaths: removedConflictPaths.sort(),
  };
}
