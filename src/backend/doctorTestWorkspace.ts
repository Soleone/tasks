import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace } from "./copyTestWorkspace.js";
import { executeLine } from "./gateway.js";
import type { Response } from "./protocol.js";
import type { DoctorPlan } from "./doctorPlan.js";
import type { DoctorIssue, DoctorVersion } from "./doctorSource.js";
import type { CanonicalTask } from "./taskModel.js";
export const doctorCorpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)), "utf8"));
export const doctorLinux = { skip: process.platform !== "linux" };
export function sendDoctor(w: CopyTestWorkspace, request: object): Response { return executeLine(Buffer.from(JSON.stringify({ version: 2, ...request })), w.root, w.cache); }
export function doctorOk(r: Response): Extract<Response, { ok: true }> { assert.equal(r.ok, true, JSON.stringify(r));if (!r.ok) throw Error("failed doctor");return r; }
export function doctorFail(r: Response, code: string): void { assert.equal(r.ok, false, JSON.stringify(r));if (!r.ok) assert.equal(r.error.code, code); }
export function doctorRaw(w: CopyTestWorkspace) { return readdirSync(path.join(w.root, "tasks")).filter(name => !name.startsWith(".syncthing.")).sort().map(name => [name, readFileSync(path.join(w.root, "tasks", name)).toString("base64")]); }
export function createDoctorWorkspace(t: TestContext, records: Record<string, Partial<CanonicalTask>> = { a: {} }, alternates: Record<string, Partial<CanonicalTask>> = { a: { title: "Other" } }) {
  const w = createCopyTestWorkspace(t);
  for (const name of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", name));
  for (const [id, fields] of Object.entries(records)) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...doctorCorpus.taskTemplate, ...fields, id }) + "\n");
  for (const [id, fields] of Object.entries(alternates)) writeFileSync(path.join(w.root, "tasks", `${id}.sync-conflict-test.json`), JSON.stringify({ ...doctorCorpus.taskTemplate, ...fields, id }) + "\n");
  return w;
}
export function planDoctor(w: CopyTestWorkspace, alternate = false, chooseLinks = false) {
  const inspected = doctorOk(sendDoctor(w, { command: "workspace.doctor.inspect" })), versions = inspected.result.versionRefs as DoctorVersion[], issues = (inspected.result.issues as DoctorIssue[]).filter(issue => issue.code === "CONFLICT_COPY");
  const args = { kind: "keep-both", issueIds: issues.map(issue => issue.issueId), canonicalVersions: issues.map(issue => ({ issueId: issue.issueId, versionRef: versions.find(version => version.taskId === issue.taskId && version.canonical !== alternate)!.versionRef })), linkChoices: chooseLinks ? (inspected.result.incomingLinks as { record: { taskId: string }; fromId: string; field: string }[]).filter(link => issues.some(issue => issue.taskId === link.fromId)).map(link => ({ ...link, targetVersionRef: versions.find(version => version.taskId === link.fromId && version.canonical === alternate)!.versionRef })) : [] };
  const result = doctorOk(sendDoctor(w, { command: "workspace.doctor.plan", writeContext: inspected.writeContext, idempotencyKey: "plan", args }));
  const db = new DatabaseSync(w.cache);let plan: DoctorPlan;
  try { plan = JSON.parse(db.prepare("SELECT payload FROM v2_doctor_plans WHERE id = ?").get(result.result.planId as string)!.payload as string); } finally { db.close(); }
  return { plan, request: { version: 2, command: "workspace.doctor.apply", writeContext: result.writeContext, idempotencyKey: "apply", args: { planId: plan.planId } } };
}
