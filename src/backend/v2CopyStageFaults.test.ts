import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./v2CopyTestWorkspace.js";
import { inspectV2CanonicalRoot, readV2CanonicalRoot } from "./v2CanonicalReader.js";
import { v2LocalDomain } from "./v2LocalDomain.js";

const stagingModule = new URL("./v2CopyStage.js", import.meta.url).href;
const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
function faultProcess(workspace: Workspace, fault: string, prefix = -1) {
  const loader = path.join(workspace.directory, "copy-fault-loader.mjs");
  const worker = path.join(workspace.directory, "copy-worker.mjs");
  writeFileSync(worker, `import {stageV2CanonicalCopy} from ${JSON.stringify(stagingModule)};
try { console.log(JSON.stringify(stageV2CanonicalCopy(process.argv[2],process.argv[3]))); }
catch(error) { console.log(JSON.stringify({code:error.code}));process.exitCode=1; }`);
  // Test-only loader transforms do not add production hooks or caller-controlled fault flags.
  writeFileSync(loader, `import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2CopyStage.js'))return result;
let source=result.source.toString();const fault=${JSON.stringify(fault)}, prefix=${prefix};
function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique');source=source.replace(needle,value);}
source='import {writeFileSync as faultWrite,readFileSync as faultRead,mkdirSync as faultMkdir} from "node:fs";let copied=0;\\n'+source;
if(fault==='prefix'){
 replace('const stageIdentity = directoryIdentity(stageDirectory);','if('+prefix+'===0)process.kill(process.pid,"SIGKILL");const stageIdentity = directoryIdentity(stageDirectory);');
 const needle='writeV2DurableFile(path.join(stageDirectory, file.relativePath), bytes);';
 replace(needle,needle+'if(++copied==='+prefix+')process.kill(process.pid,"SIGKILL");');
}
if(fault==='source-edit'||fault==='source-arrival'){
 const needle='syncV2Directory(path.dirname(intentPath));';
 const file='path.join(source.rootPath,"tasks",${JSON.stringify(`${parentId}.json`)})';
 const mutate=fault==='source-edit'?'faultWrite('+file+',JSON.stringify({...JSON.parse(faultRead('+file+',"utf8")),title:"External edit"}));':'faultWrite(path.join(source.rootPath,"tasks","arrived.json"),JSON.stringify({...JSON.parse(faultRead('+file+',"utf8")),id:"arrived"}));';
 replace(needle,needle+mutate);
}
if(fault==='destination-arrival'){
 const needle='verifyCopyStage(source, stageDirectory);';
 replace(needle,needle+'faultMkdir(destination.directory);faultWrite(path.join(destination.directory,"keep"),"External destination");');
}
if(fault==='stage-extra'||fault==='stage-partial'){
 const needle='verifyCopyStage(source, stageDirectory);';
 const mutate=fault==='stage-extra'?'faultWrite(path.join(stageDirectory,"cache.db"),"foreign state");':'faultWrite(path.join(stageDirectory,"tasks",${JSON.stringify(`${parentId}.json`)}),"{");';
 replace(needle,mutate+needle);
}
return {...result,source};}});`);
  return spawnSync(process.execPath, ["--import", loader, worker, workspace.root, workspace.destination], { env: process.env, timeout: 10_000, encoding: "utf8" });
}
function intentFor(root: string) {
  const domain = v2LocalDomain(readV2CanonicalRoot(root));
  const names = readdirSync(domain).filter(name => name.endsWith(".intent.json"));
  assert.equal(names.length, 1);
  const intentPath = path.join(domain, names[0]);
  return { domain, intentPath, intent: JSON.parse(readFileSync(intentPath, "utf8")) as { stageDirectory: string; operationId: string } };
}

for (let prefix = 0; prefix <= 5; prefix += 1) {
  test(`v2 real copy subprocess kill after ${prefix}/5 files preserves source and never publishes`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const source = readV2CanonicalRoot(workspace.root);
    const child = faultProcess(workspace, "prefix", prefix);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.deepEqual(readV2CanonicalRoot(workspace.root).files, source.files);
    assert.equal(existsSync(workspace.destination), false);
    const { domain, intent } = intentFor(workspace.root);
    assert.equal(readdirSync(domain).some(name => name.endsWith(".verified.json")), false);
    assert.equal(existsSync(intent.stageDirectory), true);
    const inspection = inspectV2CanonicalRoot(intent.stageDirectory);
    assert.equal(inspection.state, prefix === 5 ? "ready" : "incomplete");
    // A complete graph alone is still not a verified completion or published destination.
    assert.equal(existsSync(path.join(domain, `copy-stage-${intent.operationId}.verified.json`)), false);
  });
}

for (const [fault, code] of [["source-edit", "STALE_FILE"], ["source-arrival", "STALE_SCOPE"]] as const) {
  test(`v2 ${fault} before the first staged file preserves external bytes and refuses completion`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const child = faultProcess(workspace, fault);
    assert.equal(child.status, 1, child.stderr);
    assert.equal(JSON.parse(child.stdout).code, code);
    const { domain, intent } = intentFor(workspace.root);
    assert.equal(existsSync(intent.stageDirectory), false);
    assert.equal(existsSync(workspace.destination), false);
    assert.equal(readdirSync(domain).some(name => name.endsWith(".verified.json")), false);
    if (fault === "source-edit") assert.equal(JSON.parse(readFileSync(path.join(workspace.root, "tasks", `${parentId}.json`), "utf8")).title, "External edit");
    else assert.equal(existsSync(path.join(workspace.root, "tasks", "arrived.json")), true);
  });
}

for (const [fault, code] of [["destination-arrival", "DESTINATION_NOT_EMPTY"], ["stage-extra", "RECOVERY_CONFLICT"], ["stage-partial", "INVALID_CANONICAL"]] as const) {
  test(`v2 ${fault} cannot produce a verified copy report`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const source = readV2CanonicalRoot(workspace.root);
    const child = faultProcess(workspace, fault);
    assert.equal(child.status, 1, child.stderr);
    assert.equal(JSON.parse(child.stdout).code, code);
    assert.deepEqual(readV2CanonicalRoot(workspace.root).files, source.files);
    const { domain, intent } = intentFor(workspace.root);
    assert.equal(existsSync(intent.stageDirectory), true);
    assert.equal(readdirSync(domain).some(name => name.endsWith(".verified.json")), false);
    if (fault === "destination-arrival") assert.equal(readFileSync(path.join(workspace.destination, "keep"), "utf8"), "External destination");
    else assert.equal(existsSync(workspace.destination), false);
  });
}
