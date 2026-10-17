import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCopyTestWorkspace as setup } from "../backend/copyTestWorkspace.js";
import { fail, recover, run, send, success } from "../backend/copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "../backend/copyTestWorkspace.js";
import type { CopyIntent } from "../backend/copyJournal.js";
import { readCanonicalRoot, readRootDescriptor } from "../backend/canonicalReader.js";
import { pendingIntentPath, localDomain } from "../backend/localDomain.js";
import { migrationRecoveryLocation } from "./journal.js";
import {
  readSchema1MigrationRootDescriptor,
  readSchema1MigrationSnapshot,
} from "./schema1Source.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/", import.meta.url));
const sourceFixture = path.join(fixtures, "schema1/sync");
const golden = path.join(fixtures, "workspace/root");
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const linuxOnly = { skip: process.platform !== "linux" };
function crash(workspace: Workspace, cut: string) {
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = {
    version: 2,
    command: "workspace.migrate",
    writeContext: info.writeContext,
    idempotencyKey: "original-migration",
    args: { destinationDirectory: workspace.destination },
  };
  const pending = pendingIntentPath(readSchema1MigrationRootDescriptor(workspace.root));
  const loader = path.join(workspace.directory, "migration-kill-loader.mjs");
  // Actual CLI process cuts only: no production fault flags or clock/ID overrides.
  writeFileSync(
    loader,
    `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();
function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique: '+needle);source=source.replace(needle,value);}
if(cut==='intent'&&url.endsWith('/migration/writer.js')){const n='persistPending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
if(cut==='backup-preparing'&&url.endsWith('/migration/journal.js')){const n='renameSync(\`\${file}.preparing\`, file);';replace(n,'process.kill(process.pid,"SIGKILL");'+n);}
if(url.endsWith('/copyJournal.js')){
 if(cut==='backup'){const n='persistMigrationRecovery(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='prefix-0'){const n='persistCopyProgress(intent, progress);';const at=source.indexOf(n);if(at<0)throw Error('missing prefix');source=source.slice(0,at)+n+'process.kill(process.pid,"SIGKILL");'+source.slice(at+n.length);}
 if(cut.startsWith('prefix-')&&cut!=='prefix-0'){source='let copied=0;\\n'+source;const n='writeDurableFile(path.join(intent.stageDirectory, file.relativePath), Buffer.from(file.bytes, "base64"));';replace(n,n+'if(++copied==='+Number(cut.slice(7))+')process.kill(process.pid,"SIGKILL");');}
 for(const [at,needle] of [['verified','recordVerifiedCopy(intent, progress);'],['reserved','reserveCopyTarget(intent, progress);'],['published','renameSync(intent.stageDirectory, intent.destination.directory);'],['unbound','mkdirSync(intent.stageDirectory, { mode: 0o700 });'],['retiring-target','withRootWriterLock(target.root, () => retirePending(target.root));'],['retiring-evidence','unlinkSync(file);']]) if(cut===at)replace(needle,needle+'process.kill(process.pid,"SIGKILL");');
}
return {...result,source};}});`,
  );
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(existsSync(pending), true);
  const intent = JSON.parse(readFileSync(pending, "utf8")) as CopyIntent;
  return { request, pending, intent };
}

const cuts = [
  "intent",
  "backup",
  ...Array.from({ length: 6 }, (_, prefix) => `prefix-${prefix}`),
  "verified",
  "reserved",
  "published",
  "beforeCommit",
  "afterCommit",
  "retiring-target",
  "retiring-evidence",
];
for (const cut of cuts) {
  test(
    `public migrate-interrupted: CLI SIGKILL at ${cut} resumes fixed bytes/report without v1 writes or selection`,
    linuxOnly,
    (t) => {
      const workspace = setup(t, sourceFixture);
      const before = readSchema1MigrationSnapshot(workspace.root).files;
      const { request, pending, intent } = crash(workspace, cut);
      const info = success(send(workspace, { command: "workspace.info" }));
      assert.equal(info.result.state, "recovery_pending");
      assert.equal(info.result.schemaVersion, 1);
      assert.equal(info.result.pendingOperationId, intent.operationId);
      const retry = send(workspace, request);
      if (["afterCommit", "retiring-target", "retiring-evidence"].includes(cut)) success(retry);
      else fail(retry, "RECOVERY_PENDING");
      if (
        existsSync(workspace.destination) &&
        !["retiring-target", "retiring-evidence"].includes(cut)
      ) {
        const target = {
          ...workspace,
          root: workspace.destination,
          cache: path.join(workspace.directory, "target.db"),
        };
        assert.equal(
          success(send(target, { command: "workspace.info" })).result.state,
          "recovery_pending",
        );
        fail(send(target, { command: "task.list" }), "RECOVERY_PENDING");
        fail(recover(target, intent.operationId), "RECOVERY_CONFLICT");
      }
      const resumed = success(recover(workspace, intent.operationId));
      assert.equal(resumed.result.outcome, "complete");
      assert.equal(existsSync(pending), false);
      assert.deepEqual(readSchema1MigrationSnapshot(workspace.root).files, before);
      assert.deepEqual(
        readCanonicalRoot(workspace.destination).files,
        readCanonicalRoot(golden).files,
      );
      const replay = success(send(workspace, request));
      assert.deepEqual(resumed.result.originalResult, replay.result);
      assert.equal(replay.result.operationId, intent.operationId);
      assert.equal(replay.result.selectionChanged, false);
      assert.equal(existsSync(replay.result.recoveryLocation as string), true);
      assert.equal(
        success(send(workspace, { command: "workspace.info" })).result.state,
        "unsupported",
      );
    },
  );
}

for (const orderArrives of [false, true]) {
  test(
    `migrate.source-valid: migration without an order directory ${orderArrives ? "refuses a later directory arrival" : "recovers fixed generated ordering"}`,
    linuxOnly,
    (t) => {
      const workspace = setup(t, sourceFixture);
      const orderDirectory = path.join(workspace.root, "order");
      rmSync(orderDirectory, { recursive: true });
      const before = readSchema1MigrationSnapshot(workspace.root).files;
      const { intent, pending } = crash(workspace, "prefix-2");
      if (orderArrives) {
        mkdirSync(orderDirectory);
        fail(recover(workspace, intent.operationId), "MIGRATION_CONFLICT");
        assert.equal(existsSync(pending), true);
      } else {
        assert.equal(success(recover(workspace, intent.operationId)).result.outcome, "complete");
        assert.equal(existsSync(pending), false);
        assert.equal(existsSync(orderDirectory), false);
        assert.deepEqual(
          readCanonicalRoot(workspace.destination)
            .tasks.map((task) => task.id)
            .sort(),
          readSchema1MigrationSnapshot(workspace.root)
            .tasks.map((task) => task.id)
            .sort(),
        );
      }
      assert.deepEqual(readSchema1MigrationSnapshot(workspace.root).files, before);
    },
  );
}

for (const fault of [
  "source-bytes",
  "source-missing",
  "source-arrival",
  "source-conflict",
  "source-directory",
  "stage-bytes",
  "stage-missing",
  "stage-partial",
  "stage-arrival",
  "destination-arrival",
  "backup-missing",
  "backup-partial",
  "backup-edit",
  "progress-missing",
  "progress-partial",
  "stage-binding",
  "published-edit",
  "published-binding",
  "report-missing",
  "reservation-missing",
]) {
  test(`migration recovery preserves and refuses ${fault}`, linuxOnly, (t) => {
    const workspace = setup(t, sourceFixture);
    const cut =
      fault.startsWith("published-") || ["report-missing", "reservation-missing"].includes(fault)
        ? "published"
        : "prefix-2";
    const { intent, pending } = crash(workspace, cut);
    const sourceFile = path.join(workspace.root, "tasks", `${id}.json`);
    const stageFile = path.join(
      intent.stageDirectory,
      intent.files.filter((file) => file.relativePath !== "workspace.json")[0].relativePath,
    );
    const backup = migrationRecoveryLocation(intent);
    if (fault === "source-bytes") writeFileSync(sourceFile, `${readFileSync(sourceFile, "utf8")} `);
    if (fault === "source-missing") rmSync(sourceFile);
    if (fault === "source-arrival")
      writeFileSync(path.join(workspace.root, "tasks/late.json"), "preserve late bytes");
    if (fault === "source-conflict")
      writeFileSync(
        path.join(workspace.root, "order/root.sync-conflict-external.json"),
        "preserve conflict",
      );
    if (fault === "source-directory") {
      renameSync(path.join(workspace.root, "order"), path.join(workspace.directory, "kept-order"));
      cpSync(path.join(workspace.directory, "kept-order"), path.join(workspace.root, "order"), {
        recursive: true,
      });
    }
    if (fault === "stage-bytes" || fault === "stage-partial")
      writeFileSync(stageFile, fault === "stage-partial" ? "{" : "other bytes");
    if (fault === "stage-missing") rmSync(stageFile);
    if (fault === "stage-arrival")
      writeFileSync(path.join(intent.stageDirectory, "unknown"), "outside data");
    if (fault === "destination-arrival") {
      mkdirSync(workspace.destination);
      writeFileSync(path.join(workspace.destination, "keep"), "destination occupation");
    }
    if (fault === "backup-missing") rmSync(backup);
    if (fault === "backup-partial" || fault === "backup-edit")
      writeFileSync(backup, fault === "backup-partial" ? "{" : "changed recovery copy");
    const domain = localDomain(intent.root);
    if (fault === "progress-missing")
      rmSync(path.join(domain, `copy-${intent.operationId}.progress.json`));
    if (fault === "progress-partial")
      writeFileSync(path.join(domain, `copy-${intent.operationId}.progress.json`), "{");
    if (fault === "report-missing")
      rmSync(path.join(domain, `copy-${intent.operationId}.verified.json`));
    if (fault === "reservation-missing")
      rmSync(pendingIntentPath(readRootDescriptor(workspace.destination)));
    if (fault === "published-edit")
      writeFileSync(path.join(workspace.destination, "tasks", `${id}.json`), "changed output");
    if (fault === "stage-binding" || fault === "published-binding") {
      const changed = fault === "stage-binding" ? intent.stageDirectory : workspace.destination;
      renameSync(changed, `${changed}.kept`);
      cpSync(`${changed}.kept`, changed, { recursive: true });
    }
    const beforeSource = existsSync(sourceFile) ? readFileSync(sourceFile) : undefined;
    fail(
      recover(workspace, intent.operationId),
      fault.startsWith("source-") ? "MIGRATION_CONFLICT" : "RECOVERY_CONFLICT",
    );
    assert.equal(existsSync(pending), true);
    if (beforeSource) assert.deepEqual(readFileSync(sourceFile), beforeSource);
    else assert.equal(existsSync(sourceFile), false);
    if (fault === "backup-missing") assert.equal(existsSync(backup), false);
    if (fault === "stage-missing") assert.equal(existsSync(stageFile), false);
    if (fault === "stage-partial") assert.equal(readFileSync(stageFile, "utf8"), "{");
    if (fault === "destination-arrival")
      assert.equal(
        readFileSync(path.join(workspace.destination, "keep"), "utf8"),
        "destination occupation",
      );
  });
}

test(
  "migration executes migrate-source-change with fixed interrupted intent and refuses changed source",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const { intent, pending } = crash(workspace, "intent");
    const file = path.join(workspace.root, "tasks", `${id}.json`);
    const changed = `${readFileSync(file, "utf8")}\n`;
    writeFileSync(file, changed);
    fail(recover(workspace, intent.operationId), "MIGRATION_CONFLICT");
    assert.equal(readFileSync(file, "utf8"), changed);
    assert.equal(existsSync(pending), true);
    assert.equal(existsSync(intent.stageDirectory), false);
    assert.equal(existsSync(workspace.destination), false);
  },
);

test(
  "unbound migration stage requires preserved inspection rather than ownership guesses",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const { intent, pending } = crash(workspace, "unbound");
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(intent.stageDirectory), true);
    assert.equal(existsSync(pending), true);
    assert.equal(existsSync(workspace.destination), false);
  },
);

test(
  "unpublished v1 recovery artifact is preserved without automatic repair or stage effects",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const before = readSchema1MigrationSnapshot(workspace.root).files;
    const { intent, pending } = crash(workspace, "backup-preparing");
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(`${migrationRecoveryLocation(intent)}.preparing`), true);
    assert.equal(existsSync(intent.stageDirectory), false);
    assert.equal(existsSync(workspace.destination), false);
    assert.equal(existsSync(pending), true);
    assert.deepEqual(readSchema1MigrationSnapshot(workspace.root).files, before);
  },
);

test(
  "migration cache copy/different cache/loss and fresh-context recovery never revalidate old keys",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const { request, intent } = crash(workspace, "prefix-2");
    const other = { ...workspace, cache: path.join(workspace.directory, "other.db") };
    cpSync(workspace.cache, other.cache);
    fail(send(other, request), "STALE_WRITE_CONTEXT");
    fail(recover(other, intent.operationId), "RECOVERY_CONFLICT");
    rmSync(workspace.cache);
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    success(recover(workspace, intent.operationId));
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    assert.deepEqual(
      readCanonicalRoot(workspace.destination).files,
      readCanonicalRoot(golden).files,
    );
  },
);

test(
  "migration recovery receipt completes retirement after recovery's own lost reply",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const { intent, pending } = crash(workspace, "verified");
    const info = success(send(workspace, { command: "workspace.info" }));
    const request = {
      version: 2,
      command: "workspace.recovery.resume",
      args: { operationId: intent.operationId },
      writeContext: info.writeContext,
      idempotencyKey: "lost-recovery",
    };
    const loader = path.join(workspace.directory, "recovery-kill.mjs");
    writeFileSync(
      loader,
      `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`,
    );
    assert.equal(run(workspace, request, loader).signal, "SIGKILL");
    const replay = success(send(workspace, request));
    assert.equal(existsSync(pending), false);
    assert.deepEqual(success(send(workspace, request)), replay);
    assert.equal(existsSync(migrationRecoveryLocation(intent)), true);
  },
);

for (const fault of ["source-bytes", "source-arrival", "destination-arrival"]) {
  test(
    `migration preflight ${fault} leaves no intent, backup or stage and preserves external bytes`,
    linuxOnly,
    (t) => {
      const workspace = setup(t, sourceFixture);
      const info = success(send(workspace, { command: "workspace.info" }));
      const request = {
        version: 2,
        command: "workspace.migrate",
        writeContext: info.writeContext,
        idempotencyKey: "preflight",
        args: { destinationDirectory: workspace.destination },
      };
      const loader = path.join(workspace.directory, "preflight-loader.mjs");
      const selected = path.join(workspace.root, "tasks", `${id}.json`);
      const mutation =
        fault === "source-bytes"
          ? `faultWrite(${JSON.stringify(selected)},faultRead(${JSON.stringify(selected)},"utf8")+" ");`
          : fault === "source-arrival"
            ? `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/late.json"))},"outside late bytes");`
            : `faultMkdir(${JSON.stringify(workspace.destination)});faultWrite(${JSON.stringify(path.join(workspace.destination, "keep"))},"outside destination bytes");`;
      writeFileSync(
        loader,
        `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/migration/writer.js'))return result;let source=result.source.toString();const needle='guardMigrationSource(intent);';if(source.split(needle).length!==2)throw Error('unique preflight required');source='import {writeFileSync as faultWrite,readFileSync as faultRead,mkdirSync as faultMkdir} from "node:fs";\\n'+source.replace(needle,${JSON.stringify(mutation)}+needle);return {...result,source};}});`,
      );
      const child = run(workspace, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(
        JSON.parse(child.stdout),
        fault === "destination-arrival" ? "DESTINATION_NOT_EMPTY" : "MIGRATION_CONFLICT",
      );
      const root = readSchema1MigrationRootDescriptor(workspace.root);
      assert.equal(existsSync(pendingIntentPath(root)), false);
      assert.equal(
        readdirSync(localDomain(root)).some(
          (name) => name.startsWith("migration-") || name.startsWith("copy-"),
        ),
        false,
      );
      assert.equal(
        readdirSync(workspace.directory).some((name) => name.endsWith(".stage")),
        false,
      );
      assert.equal(existsSync(workspace.destination), fault === "destination-arrival");
      if (fault === "source-bytes") assert.ok(readFileSync(selected, "utf8").endsWith(" "));
      if (fault === "source-arrival")
        assert.equal(
          readFileSync(path.join(workspace.root, "tasks/late.json"), "utf8"),
          "outside late bytes",
        );
      if (fault === "destination-arrival")
        assert.equal(
          readFileSync(path.join(workspace.destination, "keep"), "utf8"),
          "outside destination bytes",
        );
    },
  );
}

for (const fault of ["fixed-target", "raw-source", "directory-evidence"]) {
  test(
    `migration refuses divergent saved ${fault} without regenerating a new inventory`,
    linuxOnly,
    (t) => {
      const workspace = setup(t, sourceFixture);
      const { intent, pending } = crash(workspace, "intent");
      if (fault === "fixed-target")
        intent.files.find((file) => file.relativePath.startsWith("tasks/"))!.bytes =
          Buffer.from("{}").toString("base64");
      if (fault === "raw-source")
        intent.migration!.files[0].bytes = Buffer.from("{}").toString("base64");
      if (fault === "directory-evidence") intent.migration!.directories = [];
      const bytes = JSON.stringify(intent);
      writeFileSync(pending, bytes);
      const info = success(send(workspace, { command: "workspace.info" }));
      assert.equal(info.result.pendingOperationId, null);
      assert.equal(info.result.state, "recovery_pending");
      fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
      assert.equal(readFileSync(pending, "utf8"), bytes);
      assert.equal(existsSync(intent.stageDirectory), false);
      assert.equal(existsSync(workspace.destination), false);
    },
  );
}

test(
  "ordinary migration subprocess restart replays original completion without recopies",
  linuxOnly,
  (t) => {
    const workspace = setup(t, sourceFixture);
    const info = success(send(workspace, { command: "workspace.info" }));
    const request = {
      version: 2,
      command: "workspace.migrate",
      writeContext: info.writeContext,
      idempotencyKey: "restart",
      args: { destinationDirectory: workspace.destination },
    };
    const first = run(workspace, request);
    assert.equal(first.status, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.ok, true, first.stdout);
    const second = run(workspace, request);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), result);
  },
);
