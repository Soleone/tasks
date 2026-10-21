import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const uiRunner = readFileSync(new URL("./check-ui.mjs", import.meta.url), "utf8");
const sidecarRunner = readFileSync(new URL("./check-sidecar.mjs", import.meta.url), "utf8");
test("UI test server and external CLI share one scratch Tasks home", () => {
  assert.match(uiRunner, /const home = path\.join\(scratch, "home"\);/);
  assert.match(uiRunner, /"dist\/backend\/tasks-cli\.js"\), "--home", home,/);
  assert.match(uiRunner, /"scripts\/dev-web\.mjs",\s*"--home",\s*home,/);
  assert.doesNotMatch(uiRunner, /--root|--database/);
});

test("both bundled binaries run on a scratch Tasks home, never a default one", () => {
  assert.match(sidecarRunner, /const homePath = path\.join\(probeDirectory, "home"\);/);
  assert.match(sidecarRunner, /const selection = \["--home", homePath\];/);
  assert.doesNotMatch(sidecarRunner, /--root|--database/);
  assert.equal((sidecarRunner.match(/env: environment/g) ?? []).length, 1);
});

async function readinessCalls(backendOk = true, webOk = true) {
  const expression = /ready =\s*(\(await fetch[\s\S]+?\.ok);/.exec(uiRunner)?.[1];
  assert.ok(expression, "readiness must remain an explicit health/web check");
  const requests = [];
  const fetchProbe = async (url, options) => {
    requests.push({ url, options });
    return { ok: url.endsWith("/health") ? backendOk : webOk };
  };
  const evaluate = new Function(
    "fetch",
    "backendUrl",
    "url",
    `return (async () => (${expression}))();`,
  );
  const ready = await evaluate(fetchProbe, "http://backend.test", "http://web.test");
  return { ready, requests };
}

test("startup readiness closes both sockets and still requires healthy backend and web", async () => {
  const result = await readinessCalls();
  assert.equal(result.ready, true);
  assert.deepEqual(
    result.requests.map((request) => request.url),
    ["http://backend.test/health", "http://web.test"],
  );
  assert.deepEqual(
    result.requests.map((request) => request.options),
    [{ headers: { connection: "close" } }, { headers: { connection: "close" } }],
  );
  assert.equal((await readinessCalls(false)).ready, false);
  assert.equal((await readinessCalls(true, false)).ready, false);
});

test("closed startup socket survives remote expiry while synchronous browser commands block Node", async (t) => {
  const healthOptions = (await readinessCalls()).requests[0].options;
  const server = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {createServer} from 'node:http';
    const server=createServer((request,response)=>{
      response.writeHead(200,{'content-type':'application/json'});
      response.end('{}');
      if(request.url==='/health')setTimeout(()=>request.socket.destroy(),100);
    });
    server.keepAliveTimeout=60000;
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    if (server.exitCode !== null) return;
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  });
  const port = await new Promise((resolve, reject) => {
    server.stdout.once("data", (bytes) => resolve(Number(bytes.toString().trim())));
    server.once("error", reject);
    server.once("exit", () => reject(new Error("socket probe exited before readiness")));
  });
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${url}/health`, healthOptions)).ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  execFileSync(process.execPath, [
    "-e",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)",
  ]);
  const response = await fetch(`${url}/command`, {
    method: "POST",
    headers: { connection: "close" },
    body: "{}",
  });
  assert.equal(response.ok, true);
  await response.text();
});
