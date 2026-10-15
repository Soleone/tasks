import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRequest } from "./protocol.js";
import { observeQueryAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";

test("v2 SQLite receipts preserve historical payloads across reopen and reject changed identity", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = { rootPath: path.join(directory, "root"), rootIdentity: "unit-root" };
  mkdirSync(root.rootPath);
  const cache = path.join(directory, "cache.db");
  const authority = observeQueryAuthority(cache, root);
  const request = parseRequest({ version: 2, command: "task.update", args: { id: "a", expectedVersion: 1, title: "Literal @name" }, writeContext: authority.writeContext, idempotencyKey: "stable" });
  const historical = { task: { id: "a", title: "Literal @name", version: 2 }, changed: true, operationId: "fixed" };
  withCacheTransaction(cache, root, database => { requireWriteContext(request, authority); storeReceipt(database, request, historical); });
  withCacheTransaction(cache, root, database => {
    const repeat = { ...request, requestId: "different", args: { title: "Literal @name", expectedVersion: 1, id: "a" } };
    assert.deepEqual(findReceipt(database, repeat), historical);
    for (const changed of [
      { ...request, args: { ...request.args, title: "Other" } },
      { ...request, actor: { kind: "system" as const, label: "other" } },
      { ...request, dryRun: true },
    ]) assert.throws(() => findReceipt(database, changed), { code: "IDEMPOTENCY_KEY_REUSED" });
  });
  assert.throws(() => requireWriteContext({ ...request, writeContext: undefined }, authority), { code: "WRITE_CONTEXT_REQUIRED" });
  assert.throws(() => requireWriteContext({ ...request, idempotencyKey: undefined }, authority), { code: "IDEMPOTENCY_REQUIRED" });
  rmSync(cache);
  const fresh = observeQueryAuthority(cache, root);
  assert.throws(() => requireWriteContext(request, fresh), { code: "STALE_WRITE_CONTEXT" });
});
