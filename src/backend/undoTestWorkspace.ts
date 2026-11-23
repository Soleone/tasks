import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import type { CanonicalTask } from "./taskModel.js";
export const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
export const linux = { skip: process.platform !== "linux" };
export type Projection = CanonicalTask & { version: number };
export function materialize(
  t: TestContext,
  records: Record<string, Partial<CanonicalTask>> = { a: {} },
) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks")))
    rmSync(path.join(w.root, "tasks", file));
  for (const [id, patch] of Object.entries(records))
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, ...patch, id }),
    );
  return w;
}
export function get(w: Workspace, id = "a") {
  return success(send(w, { command: "task.get", args: { id } })).result.task as Projection;
}
export function raw(w: Workspace) {
  return readdirSync(path.join(w.root, "tasks"))
    .sort()
    .map((file) => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]);
}
export function rows(w: Workspace, taskId?: string) {
  return success(send(w, { command: "activity.list", args: taskId ? { taskId } : {} })).result
    .activity as {
    operationId: string;
    createdAt: string;
    command: string;
    before: unknown;
    after: unknown;
  }[];
}
export function prepared(
  w: Workspace,
  command: string,
  args: Record<string, unknown>,
  key = command,
): {
  command: string;
  writeContext: string;
  idempotencyKey: string;
  args: Record<string, unknown>;
} {
  const ctx = success(send(w, { command: "workspace.info" })).writeContext;
  return {
    command,
    writeContext: ctx,
    idempotencyKey: key,
    args: {
      ...args,
      ...(typeof args.id === "string" ? { expectedVersion: get(w, args.id).version } : {}),
    },
  };
}
export function batch(
  w: Workspace,
  command: string,
  items: { id: string; command?: string }[],
  key = command,
) {
  return prepared(
    w,
    command,
    { tasks: items.map((item) => ({ ...item, expectedVersion: get(w, item.id).version })) },
    key,
  );
}
export function patch(w: Workspace, id: string, fields: object) {
  const file = path.join(w.root, "tasks", `${id}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...fields }));
}
export function counts(w: Workspace) {
  const db = new DatabaseSync(w.cache);
  try {
    return ["v2_receipts", "v2_operations", "v2_undo_claims"].map(
      (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
    );
  } finally {
    db.close();
  }
}
