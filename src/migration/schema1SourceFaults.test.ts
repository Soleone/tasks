import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../../scripts/fixtures/schema1/sync/", import.meta.url));
const conversionModule = new URL("./conversion.js", import.meta.url).href;
const parentPath = "tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json";
function setup(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-source-fault-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  cpSync(fixture, root, { recursive: true });
  return { directory, root };
}
function canonicalBytes(root: string) {
  return [
    "workspace.json",
    ...["tasks", "order"].flatMap((directory) =>
      readdirSync(path.join(root, directory))
        .sort()
        .map((name) => `${directory}/${name}`),
    ),
  ].map((relativePath) => [
    relativePath,
    readFileSync(path.join(root, relativePath)).toString("base64"),
  ]);
}
function faultProcess(workspace: { directory: string; root: string }, fault: string, prefix = -1) {
  const worker = path.join(workspace.directory, "worker.mjs");
  const loader = path.join(workspace.directory, "loader.mjs");
  writeFileSync(
    worker,
    `import {planSchema1Conversion} from ${JSON.stringify(conversionModule)};
try { const plan=planSchema1Conversion(process.argv[2]); console.log(JSON.stringify({taskCount:plan.tasks.length})); }
catch(error) { console.log(JSON.stringify({code:error.code,details:error.details})); process.exitCode=1; }`,
  );
  // Test-only loader cuts. The production converter has no fault flags, callbacks or writes.
  writeFileSync(
    loader,
    `import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/migration/schema1Source.js'))return result;
let source=result.source.toString();const fault=${JSON.stringify(fault)}, prefix=${prefix};
source='import {writeFileSync as faultWrite,readFileSync as faultRead,renameSync as faultRename,cpSync as faultCopy,unlinkSync as faultUnlink} from "node:fs";let observed=0;\\n'+source;
function replace(needle,replacement){if(source.split(needle).length!==2)throw Error('unique cut required');source=source.replace(needle,replacement);}
if(fault==='kill') {
 const start='const files = [];';
 replace(start,start+'if('+prefix+'===0)process.kill(process.pid,"SIGKILL");');
 const read='files.push({ relativePath, sha256: createHash("sha256").update(bytes).digest("hex") });';
 replace(read,read+'if(++observed==='+prefix+')process.kill(process.pid,"SIGKILL");');
}
const selected='path.join(rootPath,${JSON.stringify(parentPath)})';
const actions={
 'bytes': 'faultWrite('+selected+',faultRead('+selected+',"utf8")+" ");',
 'remove': 'faultUnlink('+selected+');',
 'arrival': 'faultWrite(path.join(rootPath,"order","unexpected.json"),"External bytes");',
 'conflict': 'faultWrite(path.join(rootPath,"workspace.sync-conflict-external.json"),"External conflict bytes");',
 'root-replaced': 'faultRename(rootPath,rootPath+".kept");faultCopy(rootPath+".kept",rootPath,{recursive:true});',
 'tasks-replaced': 'faultRename(path.join(rootPath,"tasks"),path.join(path.dirname(rootPath),"tasks.kept"));faultCopy(path.join(path.dirname(rootPath),"tasks.kept"),path.join(rootPath,"tasks"),{recursive:true});'
};
if(actions[fault]) { const cut='verifySchema1Scopes(tasks, orders);'; replace(cut,actions[fault]+cut); }
return {...result,source};}});`,
  );
  return spawnSync(process.execPath, ["--import", loader, worker, workspace.root], {
    encoding: "utf8",
    timeout: 10_000,
  });
}
const linuxOnly = { skip: process.platform !== "linux" };
for (let prefix = 0; prefix <= 7; prefix += 1) {
  test(
    `v1 converter subprocess SIGKILL after ${prefix}/7 source files has zero publication or source writes`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const bytes = canonicalBytes(workspace.root);
      const child = faultProcess(workspace, "kill", prefix);
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.equal(child.stdout, "");
      assert.deepEqual(canonicalBytes(workspace.root), bytes);
      assert.deepEqual(readdirSync(workspace.directory).sort(), [
        "loader.mjs",
        "source",
        "worker.mjs",
      ]);
      assert.equal(existsSync(path.join(workspace.directory, "destination")), false);
    },
  );
}
for (const [fault, affectedPath] of [
  ["bytes", parentPath],
  ["remove", "tasks"],
  ["arrival", "order"],
  ["conflict", "."],
  ["root-replaced", "."],
  ["tasks-replaced", "tasks"],
]) {
  test(
    `v1 converter refuses ${fault} after initial source reads without repairing external changes`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const bytes = canonicalBytes(workspace.root);
      const previousTask = readFileSync(path.join(workspace.root, parentPath), "utf8");
      const child = faultProcess(workspace, fault);
      assert.equal(child.status, 1, child.stderr);
      const result = JSON.parse(child.stdout) as { code: string; details: { path: string } };
      assert.equal(result.code, "MIGRATION_CONFLICT");
      assert.equal(result.details.path, affectedPath);
      assert.equal(existsSync(path.join(workspace.directory, "destination")), false);
      if (fault === "bytes")
        assert.equal(
          readFileSync(path.join(workspace.root, parentPath), "utf8"),
          `${previousTask} `,
        );
      if (fault === "remove")
        assert.equal(existsSync(path.join(workspace.root, parentPath)), false);
      if (fault === "arrival")
        assert.equal(
          readFileSync(path.join(workspace.root, "order/unexpected.json"), "utf8"),
          "External bytes",
        );
      if (fault === "conflict")
        assert.equal(
          readFileSync(path.join(workspace.root, "workspace.sync-conflict-external.json"), "utf8"),
          "External conflict bytes",
        );
      if (fault === "root-replaced") {
        assert.deepEqual(canonicalBytes(workspace.root), bytes);
        assert.deepEqual(canonicalBytes(`${workspace.root}.kept`), bytes);
      }
      if (fault === "tasks-replaced") assert.deepEqual(canonicalBytes(workspace.root), bytes);
    },
  );
}
