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
const { BackendSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fakeCommand(shouldReply, onKill, onClose) {
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
          queueMicrotask(() => receive(`${JSON.stringify({ version: 1, requestId, ok: true, result: {} })}\n`));
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
