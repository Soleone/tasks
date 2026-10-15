import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/platform/backendSession.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["@tauri-apps/plugin-shell"],
});
const { BackendSession, JsonLineSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fakeCommand(shouldReply, onKill, onClose, reply = (requestId) => ({ version: 1, requestId, ok: true, result: {} })) {
  let receive;
  return {
    stdout: { on(_event, callback) { receive = callback; } },
    on(event, callback) {
      if (event === "close") onClose(callback);
    },
    async spawn() {
      return {
        async write(line) {
          if (!shouldReply) return;
          const { requestId } = JSON.parse(line);
          queueMicrotask(() => receive(`${JSON.stringify(reply(requestId))}\n`));
        },
        async kill() { onKill(); },
      };
    },
  };
}

test("a hung sidecar rejects pending calls and the next request starts a fresh process", async () => {
  let launches = 0;
  let kills = 0;
  const closeHandlers = [];
  const session = new BackendSession(
    async () => fakeCommand(++launches > 1, () => { kills++; }, (callback) => closeHandlers.push(callback)),
    15,
  );
  try {
    const request = { version: 1, requestId: "hung", command: "task.list" };
    await assert.rejects(session.request(request), /timed out.*same idempotency key/);
    assert.equal(kills, 1);

    const response = await session.request({ ...request, requestId: "after-timeout" });
    assert.equal(response.requestId, "after-timeout");
    assert.equal(launches, 2);
    await delay(30);
    assert.equal(kills, 1, "the successful request must clear its deadline");

    closeHandlers[0]({ code: 0, signal: null });
    const next = await session.request({ ...request, requestId: "after-old-close" });
    assert.equal(next.requestId, "after-old-close");
    assert.equal(launches, 2, "a late close from the timed-out child must not kill its replacement");
  } finally {
    await session.close();
  }
});

const { parseResponse } = await import("../dist/backend/protocol.js");

test("protocol-2 framing rejects a v1 reply and restarts only the same selected command", async () => {
  let launches = 0;
  let kills = 0;
  const session = new JsonLineSession(
    async () => fakeCommand(true, () => { kills++; }, () => {}, requestId => ++launches === 1
      ? { version: 1, requestId, ok: true, result: {} }
      : { version: 2, requestId, ok: true, writeContext: "original-selection", result: {} }),
    parseResponse,
  );
  try {
    await assert.rejects(session.request({ version: 2, requestId: "first", command: "workspace.info" }), /protocol-2/);
    assert.equal(kills, 1);
    const response = await session.request({ version: 2, requestId: "next", command: "workspace.info" });
    assert.equal(response.version, 2);
    assert.equal(response.writeContext, "original-selection");
    assert.equal(launches, 2);
  } finally { await session.close(); }
});

test("protocol-2 framing preserves error replies rather than retrying or changing authority", async () => {
  let launches = 0;
  const session = new JsonLineSession(async () => {
    launches++;
    return fakeCommand(true, () => {}, () => {}, requestId => ({ version: 2, requestId, ok: false, error: { code: "RECOVERY_PENDING", message: "preserve evidence" } }));
  }, parseResponse);
  try {
    const response = await session.request({ version: 2, requestId: "pending", command: "task.list" });
    assert.equal(response.error.code, "RECOVERY_PENDING");
    assert.equal(launches, 1);
  } finally { await session.close(); }
});

for (const requestId of ["foreign", null]) {
  test(`protocol-2 framing rejects uncorrelated reply ${String(requestId)}`, async () => {
    const session = new JsonLineSession(async () => fakeCommand(true, () => {}, () => {}, () => ({ version: 2, requestId, ok: true, writeContext: "ctx", result: {} })), parseResponse);
    try { await assert.rejects(session.request({ requestId: "wanted" }), /unknown request ID/); }
    finally { await session.close(); }
  });
}
