import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sidecarSourceTime } from "./sidecar-source-time.mjs";

test("sidecar source freshness works without Git and includes nested sources, deletion and build inputs", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "tasks-sidecar-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "src/backend/nested"), { recursive: true });
  mkdirSync(path.join(root, "scripts"));
  const files = [
    "src/backend/cli.ts",
    "src/backend/nested/model.ts",
    "scripts/build-sidecar.mjs",
    "scripts/sea.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.backend.json",
    "tsconfig.json",
  ];
  for (const filename of files) writeFileSync(path.join(root, filename), "source");
  const low = new Date("2020-01-01"),
    high = new Date("2021-01-01");
  for (const filename of [...files, "src/backend", "src/backend/nested"])
    utimesSync(path.join(root, filename), low, low);
  assert.equal(sidecarSourceTime(root), low.getTime());
  for (const filename of [
    "src/backend/nested/model.ts",
    "pnpm-lock.yaml",
    "scripts/build-sidecar.mjs",
    "tsconfig.backend.json",
  ]) {
    utimesSync(path.join(root, filename), high, high);
    assert.equal(sidecarSourceTime(root), high.getTime());
    utimesSync(path.join(root, filename), low, low);
  }
  rmSync(path.join(root, "src/backend/nested/model.ts"));
  utimesSync(path.join(root, "src/backend/nested"), high, high);
  assert.equal(sidecarSourceTime(root), high.getTime());
});
