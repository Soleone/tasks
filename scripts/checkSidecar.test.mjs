import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidecarRunner = readFileSync(new URL("./check-sidecar.mjs", import.meta.url), "utf8");

test("both bundled binaries run on a scratch Tasks home, never a default one", () => {
  assert.match(sidecarRunner, /const homePath = path\.join\(probeDirectory, "home"\);/);
  assert.match(sidecarRunner, /const selection = \["--home", homePath\];/);
  assert.doesNotMatch(sidecarRunner, /--root|--database/);
  assert.equal((sidecarRunner.match(/env: environment/g) ?? []).length, 1);
});
