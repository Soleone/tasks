import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, recover, run, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { OrderIntent } from "./orderJournal.js";
import type { CanonicalTask } from "./taskModel.js";

const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)), "utf8"));
const linuxOnly = { skip: process.platform !== "linux" };
function materialize(t: TestContext, caseId = "reorder-tied") {
  const w = setup(t);
  const entry = corpus.cases.find((entry: { id: string }) => entry.id === caseId);
  for (const file of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", file));
  for (const [id, patch] of Object.entries(entry.given.records ?? { a: {} })) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...corpus.taskTemplate, ...(patch as object), id }));
  return w;
}
function prepared(w: Workspace, caseId: string) {
  const entry = corpus.cases.find((entry: { id: string }) => entry.id === caseId);
  const read = success(send(w, { command: "task.list" }));
  const versions = new Map((read.result.tasks as { id: string; version: number }[]).map(task => [task.id, task.version]));
  return { version: 2, command: entry.action.command, writeContext: read.writeContext, idempotencyKey: "fixed-order", actor: { kind: "human", label: "order test" }, args: { ...entry.action.args, tasks: entry.action.args.tasks.map((task: { id: string }) => ({ id: task.id, expectedVersion: versions.get(task.id) })) } };
}
function raw(w: Workspace) { return readdirSync(path.join(w.root, "tasks")).sort().map(file => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]); }
function crash(w: Workspace, cut: string, caseId = "reorder-tied") {
  const request = prepared(w, caseId);
  const pending = pendingIntentPath(readRootDescriptor(w.root));
  const loader = path.join(w.directory, "ordering-kill-loader.mjs");
  writeFileSync(loader, `import{registerHooks}from'node:module';import{existsSync}from'node:fs';import{DatabaseSync}from'node:sqlite';const cut=${JSON.stringify(cut)},pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();function replace(n,value){if(source.split(n).length!==2)throw Error('unique ordering cut required: '+n);source=source.replace(n,value);}
if(url.endsWith('/orderWriter.js')){if(cut==='intent'||cut==='prefix-0'){const n='persistPending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='verified'){const n='const snapshot = applyOrderJournal(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}}
if(url.endsWith('/orderJournal.js')){if(cut==='staged'){const n='writeDurableFile(temporary, next);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut.startsWith('prefix-')&&cut!=='prefix-0'){source='let written=0;'+source;const n='renameSync(temporary, target);';replace(n,n+'if(++written==='+Number(cut.slice(7))+')process.kill(process.pid,"SIGKILL");');}}
if(url.endsWith('/localDomain.js')&&cut==='retired'){const n='unlinkSync(pendingIntentPath(root));';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
return{...result,source};}});`);
  const child = run(w, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  return { request, pending, intent: existsSync(pending) ? JSON.parse(readFileSync(pending, "utf8")) as OrderIntent : undefined };
}

const prefixCase = corpus.cases.find((entry: { id: string }) => entry.id === "recover-prefix");
assert.equal(prefixCase.expect.sameFinalAs, prefixCase.given.fixtureCase);
const prefixCases: [string, number][] = [prefixCase.given.fixtureCase, "normalize"].map(caseId => {
  const entry = corpus.cases.find((entry: { id: string }) => entry.id === caseId);
  return [caseId, (entry.expect.rewrittenIds ?? Object.keys(entry.expect.keys)).length];
});
for (const [caseId, count] of prefixCases) for (const cut of ["intent", "staged", ...Array.from({ length: count + 1 }, (_, i) => `prefix-${i}`), "verified", "beforeCommit", "afterCommit", "retired"]) {
  test(`${caseId} actual CLI ${cut} recovers fixed keys/scope/result/group without rewriting applied files`, linuxOnly, (t) => {
    const w = materialize(t, caseId);
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === caseId);
    const before = raw(w);
    const { request, pending, intent } = crash(w, cut, caseId);
    const applied = intent?.files.filter(file => file.beforeBytes !== file.nextBytes && readFileSync(path.join(w.root, "tasks", `${file.taskId}.json`)).toString("base64") === file.nextBytes).map(file => [file.taskId, lstatSync(path.join(w.root, "tasks", `${file.taskId}.json`)).ino] as const) ?? [];
    const retry = send(w, request);
    if (["afterCommit", "retired"].includes(cut)) success(retry); else fail(retry, "RECOVERY_PENDING");
    if (intent) {
      const info = success(send(w, { command: "workspace.info" }));assert.equal(info.result.state, "recovery_pending");assert.equal(info.result.pendingOperationId, intent.operationId);
      fail(send(w, { command: "task.list" }), "RECOVERY_PENDING");
      const resumed = success(recover(w, intent.operationId));assert.equal(resumed.result.outcome, "complete");
      assert.deepEqual(success(send(w, request)).result, resumed.result.originalResult);
      for (const [id, inode] of applied) assert.equal(lstatSync(path.join(w.root, "tasks", `${id}.json`)).ino, inode);
      for (const file of intent.files) assert.equal(readFileSync(path.join(w.root, "tasks", `${file.taskId}.json`)).toString("base64"), file.nextBytes);
    }
    const child = run(w, request);assert.equal(child.status, 0, child.stderr);const replay = success(JSON.parse(child.stdout));
    const rows = success(send(w, { command: "activity.list" })).result.activity as { operationId: string; actor: object; createdAt: string; before: object; after: { scope: { id: string; orderKey: string }[] } }[];
    assert.equal(rows.length, 1);assert.deepEqual(rows[0].actor, request.actor);assert.equal(rows[0].operationId, replay.result.operationId);if(intent)assert.equal(rows[0].createdAt,intent.at);
    const list = success(send(w, { command: "task.list", args: { sort: "manual" } })).result.tasks as CanonicalTask[];
    assert.deepEqual((replay.result.tasks as {id:string}[]).map(task=>task.id),request.args.tasks.map((task:{id:string})=>task.id));
    assert.deepEqual(list.map(task=>task.id),entry.expect.order);
    for(const [id,key] of Object.entries(entry.expect.keys))assert.equal(list.find(task=>task.id===id)!.orderKey,key);
    for(const task of list){const old=JSON.parse(Buffer.from(before.find(([file])=>file===`${task.id}.json`)![1],"base64").toString());for(const field of Object.keys(old).filter(key=>key!=="orderKey"))assert.deepEqual(task[field as keyof CanonicalTask],old[field]);}
    assert.equal(existsSync(pending), false);
  });
}

const divergence = corpus.cases.find((entry: { id: string }) => entry.id === "recover-divergence");
test("public recover-divergence retains journal and external patch after the exact declared prefix", linuxOnly, (t) => {
  const w = materialize(t, divergence.given.fixtureCase);
  const { pending, intent } = crash(w, `prefix-${divergence.action.steps[0].interruptAfterFiles}`, divergence.given.fixtureCase);
  for(const[id,patch]of Object.entries(divergence.action.steps[1].externalPatch)){const file=path.join(w.root,"tasks",`${id}.json`);writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,"utf8")),...(patch as object)}));}
  const before=raw(w);fail(recover(w,intent!.operationId),divergence.expect.error);assert.deepEqual(raw(w),before);assert.equal(existsSync(pending),true);
});

for(const fault of ["arrival","selected-missing","rewrite-missing","outside-key","formatting","applied-edit","scope-parent","manifest-format","unknown-entry","stage-partial","stage-divergent","applied-stage-divergent","intent-partial","intent-next","intent-before","intent-members","intent-selected","different-cache","copied-cache"]){
  test(`ordering recovery preserves/refuses ${fault} without rollback/new allocation/resurrection`,linuxOnly,(t)=>{
    const w=materialize(t);const{pending,intent:captured}=crash(w,fault.startsWith("stage-")?"staged":"prefix-1");const intent=captured!;
    const patch=(id:string,value:object)=>{const file=path.join(w.root,"tasks",`${id}.json`);writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,"utf8")),...value}));};
    if(fault==="arrival")writeFileSync(path.join(w.root,"tasks/new.json"),JSON.stringify({...corpus.taskTemplate,id:"new"}));
    if(fault==="selected-missing")rmSync(path.join(w.root,"tasks/move.json"));
    if(fault==="rewrite-missing")rmSync(path.join(w.root,"tasks/b.json"));
    if(fault==="outside-key")patch("upper",{orderKey:"a2V"});
    if(fault==="formatting")writeFileSync(path.join(w.root,"tasks/tail.json"),readFileSync(path.join(w.root,"tasks/tail.json"),"utf8")+" ");
    if(fault==="applied-edit")patch("a",{title:"Preserve external title"});
    if(fault==="scope-parent")patch("b",{parentId:"move"});
    if(fault==="manifest-format")writeFileSync(path.join(w.root,"workspace.json"),'{ "schemaVersion": 2 }\n');
    if(fault==="unknown-entry")writeFileSync(path.join(w.root,"tasks/foreign.dat"),"preserve foreign file");
    if(fault.startsWith("stage-")||fault==="applied-stage-divergent")writeFileSync(path.join(w.root,"tasks",`.syncthing.taskdb-order-${intent.operationId}-0.tmp`),fault==="stage-partial"?"{":"preserve divergent staging");
    if(fault==="intent-partial")writeFileSync(pending,"{");
    if(["intent-next","intent-before","intent-members","intent-selected"].includes(fault)){
      const value=JSON.parse(readFileSync(pending,"utf8"));
      if(fault==="intent-members")value.files=value.files.filter((file:{taskId:string})=>file.taskId!=="tail");
      else if(fault==="intent-selected")value.request.args.tasks[0].id="b";
      else {const file=value.files.find((file:{taskId:string})=>file.taskId==="a");const field=fault==="intent-next"?"nextBytes":"beforeBytes";file[field]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(file[field],"base64").toString()),orderKey:"a9"})).toString("base64");}
      writeFileSync(pending,JSON.stringify(value));
    }
    let selected=w;if(fault==="different-cache"||fault==="copied-cache"){const cache=path.join(w.directory,"other.db");if(fault==="copied-cache")cpSync(w.cache,cache);selected={...w,cache};}
    const before=raw(w);fail(recover(selected,intent.operationId),"RECOVERY_CONFLICT");assert.deepEqual(raw(w),before);assert.equal(existsSync(pending),true);
  });
}

for(const caseId of ["reorder-tied","normalize"]){
  test(`${caseId} original-location cache loss allows explicit fixed recovery but never old-context retry`,linuxOnly,(t)=>{
    const w=materialize(t,caseId);const{request,pending,intent}=crash(w,"prefix-1",caseId);rmSync(w.cache);
    const info=success(send(w,{command:"workspace.info"}));assert.notEqual(info.writeContext,request.writeContext);fail(send(w,request),"STALE_WRITE_CONTEXT");
    success(recover(w,intent!.operationId));for(const file of intent!.files)assert.equal(readFileSync(path.join(w.root,"tasks",`${file.taskId}.json`)).toString("base64"),file.nextBytes);
    fail(send(w,request),"STALE_WRITE_CONTEXT");assert.equal(existsSync(pending),false);
  });
  test(`${caseId} recovery's own lost reply keeps one actor group and same-key retirement`,linuxOnly,(t)=>{
    const w=materialize(t,caseId);const{pending,intent}=crash(w,"prefix-1",caseId);const context=success(send(w,{command:"workspace.info"})).writeContext;
    const req={version:2,command:"workspace.recovery.resume",args:{operationId:intent!.operationId},writeContext:context,idempotencyKey:"resume-lost"};
    const loader=path.join(w.directory,"ordering-resume-kill.mjs");writeFileSync(loader,`import{DatabaseSync}from'node:sqlite';import{existsSync}from'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
    assert.equal(run(w,req,loader).signal,"SIGKILL");const replay=success(send(w,req));assert.equal(replay.result.outcome,"complete");assert.deepEqual(success(send(w,req)).result,replay.result);assert.equal(existsSync(pending),false);assert.equal((success(send(w,{command:"activity.list"})).result.activity as object[]).length,1);
  });
}

test("pending ordering refuses exhausted receipt/token budgets before further canonical effects",linuxOnly,(t)=>{
  const w=materialize(t);const{pending,intent}=crash(w,"prefix-1");const before=raw(w);
  const db=new DatabaseSync(w.cache);db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER-3,Number.MAX_SAFE_INTEGER-1);db.close();
  fail(recover(w,intent!.operationId),"UNSUPPORTED_COMMAND");assert.deepEqual(raw(w),before);assert.equal(existsSync(pending),true);
});

test("ordering historical recovery retains corrupt private cleanup until corrected, without another group or file effects",linuxOnly,(t)=>{
  const w=materialize(t);const{request,pending,intent}=crash(w,"afterCommit");
  const original=success(send(w,request));const staged=path.join(w.root,"tasks",`.syncthing.taskdb-order-${intent!.operationId}-0.tmp`);
  writeFileSync(staged,"preserve divergent private bytes");
  const context=success(send(w,{command:"workspace.info"})).writeContext;
  const req={command:"workspace.recovery.resume",args:{operationId:intent!.operationId},writeContext:context,idempotencyKey:"cleanup"};
  fail(send(w,req),"RECOVERY_CONFLICT");const kept=raw(w);const historical=success(send(w,req));
  assert.deepEqual(historical.result.originalResult,original.result);assert.deepEqual(raw(w),kept);assert.equal(existsSync(pending),true);
  writeFileSync(staged,Buffer.from(intent!.files.find(file=>file.taskId==="a")!.nextBytes,"base64"));
  assert.deepEqual(success(send(w,req)).result,historical.result);assert.equal(existsSync(pending),false);
  assert.equal((success(send(w,{command:"activity.list"})).result.activity as object[]).length,1);
});

for(const id of ["scope-arrival","scope-delete","scope-formatting"]){
  test(`actual public ${id} guard-fault refuses before first canonical replacement`,linuxOnly,(t)=>{
    const entry=corpus.cases.find((entry:{id:string})=>entry.id===id);const w=materialize(t,id);const read=success(send(w,{command:"task.list"}));const tasks=read.result.tasks as {id:string;version:number}[];
    const update=id==="scope-formatting";const req={version:2,command:update?"task.update":"task.reorder",writeContext:read.writeContext,idempotencyKey:"guard-fault",args:update?{id:"a",expectedVersion:tasks.find(task=>task.id==="a")!.version,title:"Fixed content"}:{tasks:[{id:"a",expectedVersion:tasks.find(task=>task.id==="a")!.version}],placement:{last:true}}};
    const fault=entry.action.beforeFirstWrite;let mutation="";
    if(fault.arrival)for(const[newId,patch]of Object.entries(fault.arrival))mutation+=`faultWrite(${JSON.stringify(path.join(w.root,"tasks",`${newId}.json`))},JSON.stringify({...${JSON.stringify(corpus.taskTemplate)},...${JSON.stringify(patch)},id:${JSON.stringify(newId)}}));`;
    if(fault.delete)mutation=`faultRemove(${JSON.stringify(path.join(w.root,"tasks",`${fault.delete}.json`))});`;
    if(fault.formattingOnly)mutation=`faultAppend(${JSON.stringify(path.join(w.root,"tasks/a.json"))},' ');`;
    const loader=path.join(w.directory,"ordering-guard-loader.mjs");writeFileSync(loader,`import{registerHooks}from'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith(${JSON.stringify(update?"/updateWriter.js":"/orderWriter.js")}))return result;let source=result.source.toString();const n=${JSON.stringify(update?"guardUpdate(intent, false);":"guardOrder(intent, false);")};if(source.split(n).length!==2)throw Error('unique guard cut required');source='import{writeFileSync as faultWrite,rmSync as faultRemove,appendFileSync as faultAppend}from"node:fs";'+source.replace(n,${JSON.stringify(mutation)}+n);return{...result,source};}});`);
    const child=run(w,req,loader);assert.equal(child.status,0,child.stderr);fail(JSON.parse(child.stdout),entry.expect.error);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))),false);assert.equal(JSON.parse(readFileSync(path.join(w.root,"tasks/a.json"),"utf8")).orderKey,corpus.taskTemplate.orderKey);assert.equal(JSON.parse(readFileSync(path.join(w.root,"tasks/a.json"),"utf8")).title,corpus.taskTemplate.title);assert.equal(JSON.parse(readFileSync(path.join(w.root,"tasks/a.json"),"utf8")).updatedAt,corpus.taskTemplate.updatedAt);if(fault.delete)assert.equal(existsSync(path.join(w.root,"tasks",`${fault.delete}.json`)),false);if(fault.arrival)assert.equal(existsSync(path.join(w.root,"tasks/new.json")),true);
  });
}
