import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, run, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { CanonicalTask } from "./taskModel.js";

const template = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
).taskTemplate as CanonicalTask;
const linuxOnly = { skip: process.platform !== "linux" };
type Projection = CanonicalTask & { version: number };
function makeTask(workspace: Workspace, id: string, patch: Partial<CanonicalTask> = {}) {
  writeFileSync(
    path.join(workspace.root, "tasks", `${id}.json`),
    JSON.stringify({ ...template, ...patch, id }),
  );
}
function materialize(t: TestContext) {
  const workspace = setup(t);
  for (const file of readdirSync(path.join(workspace.root, "tasks")))
    rmSync(path.join(workspace.root, "tasks", file));
  for (const [id, patch] of Object.entries({
    a: {
      parentId: "old",
      dependencyIds: ["d"],
      status: "done",
      closedAt: "2026-09-08T14:00:00.000Z",
    },
    old: {},
    next: { orderKey: "a1" },
    d: {},
    blocker: { status: "done", closedAt: "2026-09-08T14:00:00.000Z" },
    leaf: { parentId: "a" },
    oldSibling: { parentId: "old", orderKey: "a1" },
    hidden: { parentId: "next", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" },
    tie: { parentId: "next", status: "paused" },
  }) as [string, Partial<CanonicalTask>][])
    makeTask(workspace, id, patch);
  return workspace;
}
function prepare(workspace: Workspace, command = "task.move") {
  const info = success(send(workspace, { command: "workspace.info" }));
  const task = success(send(workspace, { command: "task.get", args: { id: "a" } })).result
    .task as Projection;
  return {
    version: 2,
    command,
    writeContext: info.writeContext,
    idempotencyKey: "fixed-relationship",
    actor: { kind: "human", label: "relationship test" },
    args: {
      id: "a",
      expectedVersion: task.version,
      ...(command === "task.move"
        ? { parentId: "next" }
        : { dependsOnId: command === "task.dependency.add" ? "blocker" : "d" }),
    },
  };
}
for (const fault of [
  "old-arrival",
  "new-arrival",
  "old-delete",
  "new-delete",
  "formatting",
  "target-canceled",
]) {
  test(
    `move racing ${fault} refuses with zero intended canonical writes or pending`,
    linuxOnly,
    (t) => {
      const workspace = materialize(t);
      const request = prepare(workspace);
      const loader = path.join(workspace.directory, "relationship-preflight-race.mjs");
      let mutation = "";
      if (fault.endsWith("arrival"))
        mutation = `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/arrival.json"))},JSON.stringify({...${JSON.stringify(template)},id:'arrival',parentId:${JSON.stringify(fault === "old-arrival" ? "old" : "next")}}));`;
      if (fault.endsWith("delete"))
        mutation = `faultRemove(${JSON.stringify(path.join(workspace.root, "tasks", fault === "old-delete" ? "oldSibling.json" : "hidden.json"))});`;
      if (fault === "formatting")
        mutation = `faultAppend(${JSON.stringify(path.join(workspace.root, "tasks/hidden.json"))},' ');`;
      if (fault === "target-canceled")
        mutation = `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/next.json"))},JSON.stringify({...${JSON.stringify(template)},id:'next',orderKey:'a1',status:'canceled',closedAt:'2026-09-08T14:00:00.000Z'}));`;
      writeFileSync(
        loader,
        `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/updateWriter.js'))return result;let source=result.source.toString(),n='guardObservedRoot(snapshot);';if(source.split(n).length!==2)throw Error('unique preflight cut required');source='import {writeFileSync as faultWrite,appendFileSync as faultAppend,rmSync as faultRemove} from "node:fs";'+source.replace(n,${JSON.stringify(mutation)}+n);return {...result,source};}});`,
      );
      const child = run(workspace, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(
        JSON.parse(child.stdout),
        fault.endsWith("arrival") || fault.endsWith("delete") ? "STALE_SCOPE" : "STALE_FILE",
      );
      const task = JSON.parse(readFileSync(path.join(workspace.root, "tasks/a.json"), "utf8"));
      assert.equal(task.parentId, "old");
      assert.equal(task.updatedAt, template.updatedAt);
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
      assert.equal(
        readdirSync(path.join(workspace.root, "tasks")).some((file) =>
          file.startsWith(".syncthing.taskdb-"),
        ),
        false,
      );
    },
  );
}
