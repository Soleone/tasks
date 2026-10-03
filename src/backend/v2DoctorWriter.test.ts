import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./v2CopyTestWorkspace.js";
import { executeV2Line } from "./v2Gateway.js";
import type { V2Response } from "./v2Protocol.js";
import type { V2DoctorPlan } from "./v2DoctorPlan.js";
import type { V2DoctorIssue, V2DoctorLink, V2DoctorVersion } from "./v2DoctorSource.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";
const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url)), "utf8"));
const linux = { skip: process.platform !== "linux" };
function send(w: Workspace, request: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...request })), w.root, w.cache); }
function ok(r: V2Response): Extract<V2Response, { ok: true }> { assert.equal(r.ok, true, JSON.stringify(r));if (!r.ok) throw Error("failed");return r; }
function fail(r: V2Response, code: string) { assert.equal(r.ok, false, JSON.stringify(r));if (!r.ok) assert.equal(r.error.code, code); }
function materialize(t: TestContext, records: Record<string, Partial<V2CanonicalTask>> = { a: {} }, alternates: Record<string, Partial<V2CanonicalTask>> = { a: { title: "Other" } }) {
  const w = setup(t);
  for (const name of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", name));
  for (const [id, fields] of Object.entries(records)) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...corpus.taskTemplate, ...fields, id }) + "\n");
  for (const [id, fields] of Object.entries(alternates)) writeFileSync(path.join(w.root, "tasks", `${id}.sync-conflict-test.json`), JSON.stringify({ ...corpus.taskTemplate, ...fields, id }) + "\n");
  return w;
}
function raw(w: Workspace) { return readdirSync(path.join(w.root, "tasks")).sort().map(name => [name, readFileSync(path.join(w.root, "tasks", name)).toString("base64")]); }
function inspect(w: Workspace) { const response = ok(send(w, { command: "workspace.doctor.inspect" }));return { ...response, result: response.result as { issues: V2DoctorIssue[]; versionRefs: V2DoctorVersion[]; incomingLinks: V2DoctorLink[]; canonicalIds: string[]; applyAvailable: boolean } }; }
function keep(w: Workspace, chooseAlternate = false) {
  const response = inspect(w), issue = response.result.issues.find(issue => issue.code === "CONFLICT_COPY")!;
  const version = response.result.versionRefs.find(version => version.taskId === issue.taskId && version.canonical !== chooseAlternate)!;
  return { command: "workspace.doctor.plan", writeContext: response.writeContext, idempotencyKey: "plan", args: { kind: "keep-both", issueIds: [issue.issueId!], canonicalVersions: [{ issueId: issue.issueId!, versionRef: version.versionRef }], linkChoices: [] as object[] }, actor: { kind: "human", label: "review test" } };
}
function retained(w: Workspace, planId: unknown): V2DoctorPlan { const db = new DatabaseSync(w.cache);try { return JSON.parse(db.prepare("SELECT payload FROM v2_doctor_plans WHERE id = ?").get(planId as string)!.payload as string); } finally { db.close(); } }
function counts(w: Workspace) { const db = new DatabaseSync(w.cache);try { return ["v2_doctor_plans", "v2_receipts", "v2_operations"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); } finally { db.close(); } }

for (const id of ["join-conflict", "edit-delete", "doctor-ambiguous"]) test(`doctor controls execute original corpus ${id}`, linux, t => {
  const entry = corpus.cases.find((entry: { id: string }) => entry.id === id), conflict = entry.given.conflict;
  const w = materialize(t, entry.given.records ?? { a: entry.given.patch ?? {} }, { [conflict.id]: conflict.alternate }), before = raw(w);
  const response = entry.action.command === "workspace.doctor.plan" ? send(w, { ...keep(w), actor: { kind: "agent", label: "cli" } }) : send(w, { command: entry.action.command, args: entry.action.args });
  if (entry.expect.error) { fail(response, entry.expect.error);assert.deepEqual(counts(w), [0, 0, 0]); }
  else { const result = ok(response).result;assert.deepEqual(result.canonicalIds, entry.expect.canonicalIds);if (entry.expect.unresolvedIssues) assert.equal((result.issues as V2DoctorIssue[]).length, entry.expect.unresolvedIssues);for (const missing of entry.expect.notResurrected ?? []) assert.equal(existsSync(path.join(w.root, "tasks", `${missing}.json`)), false); }
  assert.deepEqual(raw(w), before);
});
test("stable exact path/ID/byte refs inspect all valid versions and never project them as duplicate canonical tasks", linux, t => {
  const w = materialize(t), before = raw(w), first = inspect(w);assert.equal(first.result.versionRefs.length, 2);assert.deepEqual(inspect(w).result, first.result);
  assert.deepEqual(first.result.canonicalIds, ["a"]);assert.equal(ok(send(w, { command: "task.list" })).result.total, 1);
  writeFileSync(path.join(w.root, "tasks/a.json"), readFileSync(path.join(w.root, "tasks/a.json"), "utf8") + " ");const current = inspect(w);
  assert.notEqual(current.result.versionRefs.find(version => version.canonical)!.versionRef, first.result.versionRefs.find(version => version.canonical)!.versionRef);
  assert.equal(current.result.versionRefs.find(version => !version.canonical)!.versionRef, first.result.versionRefs.find(version => !version.canonical)!.versionRef);fail(send(w, keepFrom(first)), "STALE_REPAIR_PLAN");assert.equal(raw(w).length, before.length);
});
function keepFrom(response: ReturnType<typeof inspect>) { const issue = response.result.issues.find(issue => issue.code === "CONFLICT_COPY")!;return { command: "workspace.doctor.plan", writeContext: response.writeContext, idempotencyKey: "stale-refs", args: { kind: "keep-both", issueIds: [issue.issueId], canonicalVersions: [{ issueId: issue.issueId, versionRef: response.result.versionRefs.find(version => version.canonical)!.versionRef }], linkChoices: [] } }; }
for (const alternate of [false, true]) test(`retained keep-both plan chooses ${alternate ? "alternate" : "original"} original ID, fixed clones/keys/times/raw guards but applies nothing`, linux, t => {
  const w = materialize(t, { a: { description: "**Original**\r\n", orderKey: "a0" }, z: { orderKey: "a2" } }, { a: { description: "Alternate\r\n", title: "Other", orderKey: "a1" } }), before = raw(w), request = keep(w, alternate), response = ok(send(w, request)), plan = retained(w, response.result.planId);
  assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [1, 1, 0]);assert.equal(response.result.applyAvailable, false);assert.equal(response.result.recoveryReady, false);assert.equal(existsSync(response.result.recoveryLocation as string), false);
  const clone = plan.clones[0];assert.match(clone.taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(clone.orderKey, alternate ? "a0" : "a1");
  const original = plan.source.versionRefs.find(version => version.canonical !== alternate && version.taskId === "a")!.task!;
  assert.deepEqual(plan.nextTasks.find(task => task.id === "a"), original);const cloneSource = plan.source.versionRefs.find(version => version.canonical === alternate && version.taskId === "a")!.task!;assert.deepEqual(plan.nextTasks.find(task => task.id === clone.taskId), { ...cloneSource, id: clone.taskId });
  assert.deepEqual(ok(send(w, { ...request, requestId: "other" })).result, response.result);assert.deepEqual(plan.removedConflictPaths, ["tasks/a.sync-conflict-test.json"]);assert.deepEqual(counts(w), [1, 1, 0]);
  fail(send(w, { command: "workspace.doctor.apply", writeContext: response.writeContext, idempotencyKey: "apply", args: { planId: plan.planId } }), "UNSUPPORTED_COMMAND");assert.deepEqual(raw(w), before);
});
for (const flags of [{ readOnly: true }, { dryRun: true }, { readOnly: true, dryRun: true }]) test(`planning preview ${JSON.stringify(flags)} persists no plan/receipt or canonical effects`, linux, t => {
  const w = materialize(t), request = keep(w), before = raw(w), first = ok(send(w, { ...request, idempotencyKey: undefined, ...flags }));assert.equal(first.result.hypothetical, true);assert.deepEqual(counts(w), [0, 0, 0]);
  const next = ok(send(w, { ...request, idempotencyKey: undefined, ...flags }));assert.notEqual(next.result.planId, first.result.planId);assert.deepEqual(raw(w), before);ok(send(w, request));
});
test("all surviving parent/blocker references require independent choices and review reports the actual redirected targets", linux, t => {
  const w = materialize(t, { a: {}, child: { parentId: "a", dependencyIds: ["a"] } }), request = keep(w), versions = inspect(w).result.versionRefs;
  const alternate = versions.find(version => !version.canonical)!, original = versions.find(version => version.canonical && version.taskId === "a")!;
  request.args.linkChoices = [{ record: { taskId: "child" }, field: "parentId", fromId: "a", targetVersionRef: alternate.versionRef }];fail(send(w, request), "AMBIGUOUS_LINK");
  request.args.linkChoices.push({ record: { taskId: "child" }, field: "dependencyIds", fromId: "a", targetVersionRef: original.versionRef });const before = raw(w), result = ok(send(w, request)).result, plan = retained(w, result.planId);
  const cloneId = plan.clones[0].taskId, child = plan.nextTasks.find(task => task.id === "child")!;assert.equal(child.parentId, cloneId);assert.deepEqual(child.dependencyIds, ["a"]);assert.equal(child.orderKey, "a0");assert.equal(child.updatedAt, corpus.taskTemplate.updatedAt);assert.deepEqual(plan.editedIds, ["child"]);
  assert.deepEqual(result.linkEdits, [{ taskId: "child", parentId: cloneId }]);assert.deepEqual(raw(w), before);
});
test("incoming references in copied versions also require explicit target choices across multiple split issues", linux, t => {
  const w = materialize(t, { a: {}, b: { orderKey: "a1" } }, { a: { dependencyIds: ["b"] }, b: { orderKey: "a2" } }), inspected = inspect(w), issues = inspected.result.issues.filter(issue => issue.code === "CONFLICT_COPY"), versions = inspected.result.versionRefs;
  const alternateA = versions.find(version => version.taskId === "a" && !version.canonical)!, alternateB = versions.find(version => version.taskId === "b" && !version.canonical)!;
  const request = { command: "workspace.doctor.plan", writeContext: inspected.writeContext, idempotencyKey: "multi", args: { kind: "keep-both", issueIds: issues.map(issue => issue.issueId), canonicalVersions: issues.map(issue => ({ issueId: issue.issueId, versionRef: versions.find(version => version.canonical && version.taskId === issue.taskId)!.versionRef })), linkChoices: [] as object[] } };
  fail(send(w, request), "AMBIGUOUS_LINK");request.args.linkChoices.push({ record: { versionRef: alternateA.versionRef }, field: "dependencyIds", fromId: "b", targetVersionRef: alternateB.versionRef });
  const result = ok(send(w, request)).result, plan = retained(w, result.planId), aClone = plan.clones.find(clone => clone.versionRef === alternateA.versionRef)!, bClone = plan.clones.find(clone => clone.versionRef === alternateB.versionRef)!;
  assert.deepEqual(plan.nextTasks.find(task => task.id === aClone.taskId)!.dependencyIds, [bClone.taskId]);assert.deepEqual(result.linkEdits, [{ taskId: aClone.taskId, dependencyIds: [bClone.taskId] }]);assert.equal(plan.clones.length, 2);assert.equal(raw(w).length, 4);
});
test("repair-links can plan only reported dangling fields and retains task times until a future executing apply", linux, t => {
  const w = materialize(t, { a: { parentId: "missing", dependencyIds: ["missing"] } }, {}), inspected = inspect(w), before = raw(w);
  assert.equal(inspected.result.issues.filter(issue => issue.code === "DANGLING_LINK").length, 2);fail(send(w, { command: "task.list" }), "INVALID_CANONICAL");
  const request = { command: "workspace.doctor.plan", writeContext: inspected.writeContext, idempotencyKey: "repair", args: { kind: "repair-links", edits: [{ taskId: "a", parentId: null, removeDependencyIds: ["missing"] }] } };
  const result = ok(send(w, request)).result, plan = retained(w, result.planId);assert.deepEqual(plan.nextTasks[0], { ...corpus.taskTemplate, id: "a", parentId: null, dependencyIds: [] });assert.deepEqual(plan.editedIds, ["a"]);assert.deepEqual(plan.clones, []);assert.deepEqual(plan.removedConflictPaths, []);assert.deepEqual(raw(w), before);assert.equal(existsSync(result.recoveryLocation as string), false);
});
for (const args of [
  { kind: "repair-links", edits: [{ taskId: "a", parentId: null }] },
  { kind: "repair-links", edits: [{ taskId: "a", removeDependencyIds: ["z"] }] },
  { kind: "repair-links", edits: [{ taskId: "a", title: "override" }] },
  { kind: "repair-links", edits: [{ taskId: "a", removeDependencyIds: [] }] },
  { kind: "repair-links", edits: [] }, { kind: "keep-both", issueIds: [], canonicalVersions: [], linkChoices: [] },
]) test(`planning refuses unreported/arbitrary/empty repair ${JSON.stringify(args)}`, linux, t => {
  const w = materialize(t, { a: { dependencyIds: ["z"] }, z: {} }, {}), context = inspect(w).writeContext, before = raw(w);fail(send(w, { command: "workspace.doctor.plan", writeContext: context, idempotencyKey: "bad", args }), "INVALID_ARGUMENT");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
for (const relation of ["parentId", "dependencyIds"] as const) test(`split choices cannot create a prospective ${relation} cycle`, linux, t => {
  const w = materialize(t, { a: {}, b: relation === "parentId" ? { parentId: "a" } : { dependencyIds: ["a"] } }, { a: relation === "parentId" ? { parentId: "b" } : { dependencyIds: ["b"] } }), request = keep(w, true), inspected = inspect(w);
  request.args.linkChoices = [{ record: { taskId: "b" }, field: relation, fromId: "a", targetVersionRef: inspected.result.versionRefs.find(version => !version.canonical)!.versionRef }];
  fail(send(w, request), relation === "parentId" ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE");assert.deepEqual(counts(w), [0, 0, 0]);
});
for (const fault of ["invalid-canonical", "invalid-alternate", "descriptor-conflict", "unsafe-entry", "orphan"]) test(`doctor preserves and reports ${fault}, never plans it as valid repair authority`, linux, t => {
  const w = materialize(t), target = path.join(w.root, "tasks/a.json");
  if (fault === "invalid-canonical") writeFileSync(target, '{"secret-title":"DO NOT LEAK"');
  if (fault === "invalid-alternate") writeFileSync(path.join(w.root, "tasks/a.sync-conflict-test.json"), Buffer.from([255]));
  if (fault === "descriptor-conflict") writeFileSync(path.join(w.root, "workspace.sync-conflict-test.json"), '{"schemaVersion":1}');
  if (fault === "unsafe-entry") { writeFileSync(path.join(w.directory, "outside"), 'DO NOT LEAK');symlinkSync(path.join(w.directory, "outside"), path.join(w.root, "tasks/unsafe.json")); }
  if (fault === "orphan") rmSync(target);
  const inspected = inspect(w), before = raw(w);assert.ok(inspected.result.issues.length);assert.equal(JSON.stringify(inspected.result).includes("DO NOT LEAK"), false);
  const issue = inspected.result.issues.find(issue => issue.issueId)!;const canonical = inspected.result.versionRefs.find(version => version.canonical) ?? inspected.result.versionRefs[0];
  fail(send(w, { command: "workspace.doctor.plan", writeContext: inspected.writeContext, idempotencyKey: "unsafe", args: { kind: "keep-both", issueIds: [issue.issueId], canonicalVersions: [{ issueId: issue.issueId, versionRef: canonical.versionRef }], linkChoices: [] } }), fault === "orphan" ? "INVALID_ARGUMENT" : "INVALID_CANONICAL");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
test("repair planning cannot leave an unreviewed dangling edge or infer an implicit unlink", linux, t => {
  const w = materialize(t, { a: { parentId: "missing", dependencyIds: ["missing"] } }, {}), context = inspect(w).writeContext, before = raw(w);
  fail(send(w, { command: "workspace.doctor.plan", writeContext: context, idempotencyKey: "partial", args: { kind: "repair-links", edits: [{ taskId: "a", parentId: null }] } }), "INVALID_DEPENDENCY");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
test("planned first-in-new-parent key exhaustion refuses without normalization or any canonical effects", linux, t => {
  const w = materialize(t, { a: { parentId: "missing" }, first: { orderKey: `A${"0".repeat(25)}1` } }, {}), context = inspect(w).writeContext, before = raw(w);
  fail(send(w, { command: "workspace.doctor.plan", writeContext: context, idempotencyKey: "limit", args: { kind: "repair-links", edits: [{ taskId: "a", parentId: null }] } }), "ORDER_KEY_LIMIT");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
for (const field of ["parentId", "dependencyIds"] as const) test(`reviewed ${field} targets cannot silently create new canceled relationships`, linux, t => {
  const closed = { status: "canceled" as const, closedAt: corpus.taskTemplate.createdAt };
  const w = materialize(t, { a: closed, child: field === "parentId" ? { parentId: "a" } : { dependencyIds: ["a"] } }, { a: { ...closed, title: "Other canceled version" } }), request = keep(w), inspected = inspect(w), alternate = inspected.result.versionRefs.find(version => !version.canonical)!;
  request.args.linkChoices = [{ record: { taskId: "child" }, field, fromId: "a", targetVersionRef: alternate.versionRef }];fail(send(w, request), field === "parentId" ? "INVALID_PARENT" : "INVALID_DEPENDENCY");assert.deepEqual(counts(w), [0, 0, 0]);
});

test("planning receipt precedes live bytes, enforces actor/flags/array identity, and does not update task tokens/activity", linux, t => {
  const w = materialize(t), current = ok(send(w, { command: "task.get", args: { id: "a" } })).result, request = keep(w), response = ok(send(w, request));
  assert.deepEqual(ok(send(w, { command: "task.get", args: { id: "a" } })).result, current);assert.deepEqual(counts(w), [1, 1, 0]);
  writeFileSync(path.join(w.root, "tasks/a.json"), "{");assert.deepEqual(ok(send(w, { ...request, requestId: "replay" })).result, response.result);
  for (const patch of [{ actor: { kind: "agent", label: "other" } }, { readOnly: true }, { dryRun: true }]) fail(send(w, { ...request, ...patch }), "IDEMPOTENCY_KEY_REUSED");
});
for (const [patch, code] of [[{ writeContext: undefined }, "WRITE_CONTEXT_REQUIRED"], [{ writeContext: "wrong" }, "STALE_WRITE_CONTEXT"], [{ idempotencyKey: undefined }, "IDEMPOTENCY_REQUIRED"]] as const) test(`planning requires ${code}`, linux, t => {
  const w = materialize(t), request = keep(w), before = raw(w);fail(send(w, { ...request, ...patch }), code);assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
test("retained schema-4 upgrade/rebuild preserves authority, earlier receipts/history and fixed plans", linux, t => {
  const w = materialize(t), context = inspect(w).writeContext, version = (ok(send(w, { command: "task.get", args: { id: "a" } })).result.task as { version: number }).version;
  const statusRequest = { command: "task.complete", writeContext: context, idempotencyKey: "complete", args: { id: "a", expectedVersion: version } }, status = ok(send(w, statusRequest));
  const db = new DatabaseSync(w.cache);db.exec("DROP TABLE v2_doctor_plans; PRAGMA user_version = 4;");db.close();
  const request = keep(w), result = ok(send(w, request));assert.equal(result.writeContext, context);assert.deepEqual(ok(send(w, statusRequest)).result, status.result);const plan = retained(w, result.result.planId);
  ok(send(w, { command: "workspace.rebuild", writeContext: context, idempotencyKey: "rebuild" }));assert.deepEqual(retained(w, plan.planId), plan);assert.deepEqual(ok(send(w, request)).result, result.result);assert.deepEqual(counts(w), [1, 3, 1]);
  const verify = new DatabaseSync(w.cache);assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 5);verify.close();
});
for (const mode of ["lost", "copied"]) test(`planning ${mode} cache invalidates old authority/receipts and cannot adopt old plans`, linux, t => {
  const w = materialize(t), request = keep(w);ok(send(w, request));let selected = w;
  if (mode === "lost") rmSync(w.cache);else { const cache = path.join(w.directory, "copied.db");cpSync(w.cache, cache);selected = { ...w, cache }; }
  assert.notEqual(inspect(selected).writeContext, request.writeContext);fail(send(selected, request), "STALE_WRITE_CONTEXT");assert.deepEqual(counts(selected), [0, 0, 0]);assert.equal(raw(w).length, 2);
});
