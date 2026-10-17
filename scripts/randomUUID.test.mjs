import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/randomUUID.ts"],
  bundle: true,
  format: "iife",
  globalName: "uuid",
  write: false,
});
function helper(crypto) {
  return runInNewContext(`${compiled.outputFiles[0].text}\nuuid.randomUUID`, { crypto });
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("native UUID generation retains its Crypto receiver", () => {
  const crypto = {
    randomUUID() {
      assert.equal(this, crypto);
      return "native-uuid";
    },
    getRandomValues() {
      assert.fail("native generation should not use the fallback");
    },
  };
  assert.equal(helper(crypto)(), "native-uuid");
});

test("missing native randomUUID uses 16 secure bytes and sets only UUID version/variant bits", () => {
  const crypto = {
    getRandomValues(bytes) {
      assert.equal(this, crypto);
      assert.equal(bytes.length, 16);
      bytes.set([0, 1, 2, 3, 4, 5, 255, 7, 255, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    },
  };
  assert.equal(helper(crypto)(), "00010203-0405-4f07-bf09-0a0b0c0d0e0f");
});

test("fallback produces distinct UUID v4 IDs using real getRandomValues", () => {
  const randomUUID = helper({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, () => randomUUID());
  ids.forEach((id) => assert.match(id, uuidV4));
  assert.equal(new Set(ids).size, ids.length);
});

test("no secure random source fails closed", () => {
  for (const crypto of [undefined, {}]) {
    assert.throws(() => helper(crypto)(), /Secure random UUID generation is unavailable/);
  }
  assert.throws(
    () =>
      helper({
        getRandomValues() {
          throw new Error("entropy unavailable");
        },
      })(),
    /entropy unavailable/,
  );
});
