import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseV2Request } from "./v2Protocol.js";
import { observeV2QueryAuthority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";

test("v2 SQLite receipts preserve historical payloads across reopen and reject changed identity", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = { rootPath: path.join(directory, "root"), rootIdentity: "unit-root" };
  mkdirSync(root.rootPath);
  const cache = path.join(directory, "cache.db");
  const authority = observeV2QueryAuthority(cache, root);
  const request = parseV2Request({ version: 2, command: "task.update", args: { id: "a", expectedVersion: 1, title: "Literal @name" }, writeContext: authority.writeContext, idempotencyKey: "stable" });
  const historical = { task: { id: "a", title: "Literal @name", version: 2 }, changed: true, operationId: "fixed" };
  withV2CacheTransaction(cache, root, database => { requireV2WriteContext(request, authority); storeV2Receipt(database, request, historical); });
  withV2CacheTransaction(cache, root, database => {
    const repeat = { ...request, requestId: "different", args: { title: "Literal @name", expectedVersion: 1, id: "a" } };
    assert.deepEqual(findV2Receipt(database, repeat), historical);
    for (const changed of [
      { ...request, args: { ...request.args, title: "Other" } },
      { ...request, actor: { kind: "system" as const, label: "other" } },
      { ...request, dryRun: true },
    ]) assert.throws(() => findV2Receipt(database, changed), { code: "IDEMPOTENCY_KEY_REUSED" });
  });
  assert.throws(() => requireV2WriteContext({ ...request, writeContext: undefined }, authority), { code: "WRITE_CONTEXT_REQUIRED" });
  assert.throws(() => requireV2WriteContext({ ...request, idempotencyKey: undefined }, authority), { code: "IDEMPOTENCY_REQUIRED" });
  rmSync(cache);
  const fresh = observeV2QueryAuthority(cache, root);
  assert.throws(() => requireV2WriteContext(request, fresh), { code: "STALE_WRITE_CONTEXT" });
});
