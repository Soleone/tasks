import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { candidateBytes, candidateTask, compareCandidateTasks, generateKeyBetween } from "./fixtures/taskdb-v2-candidate.mjs";

const binary = process.env.TASKDB_V2_SYNCTHING_BIN;
const folderId = "taskdb-v2-disposable-probe";
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function invoke(...args) {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

async function waitFor(label, predicate) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`Timed out: ${label}`);
}

async function createPeer(directory) {
  const home = path.join(directory, "home");
  const root = path.join(directory, "root");
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, ".stfolder"));
  writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":2}\n');
  invoke("generate", "--home", home, "--no-default-folder", "--skip-port-probing");
  const deviceId = invoke("serve", "--home", home, "--device-id");
  const syncPort = await availablePort();
  const guiPort = await availablePort();
  const generated = readFileSync(path.join(home, "config.xml"), "utf8");
  const apiKey = generated.match(/<apikey>([^<]+)<\/apikey>/)[1];
  return { home, root, deviceId, syncPort, guiPort, apiKey, child: null, log: "" };
}

function configurePeer(peer, remote) {
  const xml = `<configuration version="37">
    <folder id="${folderId}" path="${peer.root}" type="sendreceive" rescanIntervalS="1" fsWatcherEnabled="false">
      <device id="${peer.deviceId}"/><device id="${remote.deviceId}"/>
      <minDiskFree unit="%">0</minDiskFree><maxConflicts>-1</maxConflicts>
    </folder>
    <device id="${peer.deviceId}" name="local"><address>tcp://127.0.0.1:${peer.syncPort}</address></device>
    <device id="${remote.deviceId}" name="remote"><address>tcp://127.0.0.1:${remote.syncPort}</address></device>
    <gui enabled="true" tls="false"><address>127.0.0.1:${peer.guiPort}</address><apikey>${peer.apiKey}</apikey></gui>
    <options>
      <listenAddress>tcp://127.0.0.1:${peer.syncPort}</listenAddress>
      <globalAnnounceEnabled>false</globalAnnounceEnabled><localAnnounceEnabled>false</localAnnounceEnabled>
      <relaysEnabled>false</relaysEnabled><natEnabled>false</natEnabled><startBrowser>false</startBrowser>
      <urAccepted>-1</urAccepted><autoUpgradeIntervalH>0</autoUpgradeIntervalH>
      <crashReportingEnabled>false</crashReportingEnabled><reconnectionIntervalS>1</reconnectionIntervalS>
    </options>
  </configuration>\n`;
  writeFileSync(path.join(peer.home, "config.xml"), xml);
}

async function startPeer(peer) {
  peer.child = spawn(binary, ["serve", "--home", peer.home, "--no-browser", "--no-restart", "--no-upgrade"], {
    stdio: ["ignore", "pipe", "pipe"],
    // Run the worker directly so stopPeer waits for its database lock to release.
    env: { ...process.env, STMONITORED: "yes" },
  });
  peer.child.stdout.on("data", (chunk) => { peer.log += chunk; });
  peer.child.stderr.on("data", (chunk) => { peer.log += chunk; });
  peer.child.on("error", (error) => { peer.log += error.message; });
  await waitFor("isolated Syncthing API", async () => {
    if (peer.child.exitCode !== null) throw new Error(peer.log);
    try {
      const response = await fetch(`http://127.0.0.1:${peer.guiPort}/rest/system/status`, {
        headers: { "X-API-Key": peer.apiKey }, signal: AbortSignal.timeout(1_000),
      });
      return response.ok;
    } catch (error) {
      if (error instanceof TypeError || error.name === "TimeoutError") return false;
      throw error;
    }
  });
}

async function stopPeer(peer) {
  if (!peer.child || peer.child.exitCode !== null || peer.child.signalCode !== null) return;
  const exited = once(peer.child, "exit");
  const timer = setTimeout(() => peer.child.kill("SIGKILL"), 5_000);
  peer.child.kill("SIGTERM");
  await exited;
  clearTimeout(timer);
}

function taskPath(peer, id) {
  return path.join(peer.root, "tasks", `${id}.json`);
}

function records(peer) {
  return readdirSync(path.join(peer.root, "tasks")).filter((name) => name.endsWith(".json")).sort()
    .map((name) => ({ name, bytes: readFileSync(path.join(peer.root, "tasks", name), "utf8") }));
}

async function converge(peers, count, conflictCount) {
  await waitFor("matching bytes, connected peers, and idle complete scans", async () => {
    const first = records(peers[0]);
    const second = records(peers[1]);
    if (first.length !== count || first.filter(({ name }) => name.includes(".sync-conflict-")).length !== conflictCount
      || JSON.stringify(first) !== JSON.stringify(second)) return false;
    // Matching disk bytes alone do not establish an indexed sync baseline.
    for (const peer of peers) {
      const headers = { "X-API-Key": peer.apiKey };
      const connection = await fetch(`http://127.0.0.1:${peer.guiPort}/rest/system/connections`, {
        headers, signal: AbortSignal.timeout(2_000),
      });
      const remote = peers.find((other) => other !== peer);
      if (!(await connection.json()).connections[remote.deviceId]?.connected) return false;
      const status = await fetch(`http://127.0.0.1:${peer.guiPort}/rest/db/status?folder=${folderId}`, {
        headers, signal: AbortSignal.timeout(2_000),
      });
      const folder = await status.json();
      if (folder.state !== "idle" || folder.needTotalItems !== 0 || folder.localFiles !== count + 1) return false;
    }
    return true;
  });
}

test("v2 proposal transport: offline captures, distinct reorders, same-task conflicts", {
  skip: !binary && "Set TASKDB_V2_SYNCTHING_BIN to an isolated Syncthing v1.29.5 binary",
  timeout: 180_000,
}, async (t) => {
  const version = invoke("--version");
  assert.match(version, /syncthing v1\.29\.5 /, "Probe configuration is pinned to Syncthing v1.29.5");
  t.diagnostic(version);
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-transport-"));
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map(stopPeer));
    rmSync(directory, { recursive: true, force: true });
  });
  for (const name of ["a", "b"]) peers.push(await createPeer(path.join(directory, name)));
  configurePeer(peers[0], peers[1]);
  configurePeer(peers[1], peers[0]);
  const common = candidateTask(ids[0], "a1");
  for (const peer of peers) writeFileSync(taskPath(peer, common.id), candidateBytes(common));
  await Promise.all(peers.map(startPeer));
  await converge(peers, 1, 0);
  {
    await Promise.all(peers.map(stopPeer));
    const key = generateKeyBetween(null, common.orderKey);
    writeFileSync(taskPath(peers[0], ids[1]), candidateBytes(candidateTask(ids[1], key)));
    writeFileSync(taskPath(peers[1], ids[2]), candidateBytes(candidateTask(ids[2], key)));
    await Promise.all(peers.map(startPeer));
    await converge(peers, 3, 0);
    const sorted = records(peers[0]).map(({ bytes }) => JSON.parse(bytes)).sort(compareCandidateTasks);
    assert.deepEqual(sorted.map((task) => task.id), [ids[1], ids[2], ids[0]]);
    assert.equal(sorted[0].orderKey, sorted[1].orderKey);
    t.diagnostic("Offline captures: union, equal keys, no conflict copies");
  }

  {
    await Promise.all(peers.map(stopPeer));
    const key = generateKeyBetween(common.orderKey, null);
    writeFileSync(taskPath(peers[0], ids[1]), candidateBytes(candidateTask(ids[1], key)));
    writeFileSync(taskPath(peers[1], ids[2]), candidateBytes(candidateTask(ids[2], key)));
    await Promise.all(peers.map(startPeer));
    await converge(peers, 3, 0);
    const sorted = records(peers[0]).map(({ bytes }) => JSON.parse(bytes)).sort(compareCandidateTasks);
    assert.deepEqual(sorted.map((task) => task.id), [ids[0], ids[1], ids[2]]);
    assert.equal(sorted[1].orderKey, sorted[2].orderKey);
    t.diagnostic("Distinct-task reorders: both changes retained, equal keys, no conflict copies");
  }

  {
    await Promise.all(peers.map(stopPeer));
    const versionA = candidateBytes({ ...common, orderKey: "Zz" });
    const versionB = candidateBytes({ ...common, title: "Offline content edit", orderKey: "a3" });
    writeFileSync(taskPath(peers[0], common.id), versionA);
    writeFileSync(taskPath(peers[1], common.id), versionB);
    await Promise.all(peers.map(startPeer));
    await converge(peers, 4, 1);
    const versions = records(peers[0]).filter(({ name }) => name.startsWith(common.id)).map(({ bytes }) => bytes);
    assert.deepEqual(versions.sort(), [versionA, versionB].sort());
    assert.equal(readFileSync(path.join(peers[0].root, "workspace.json"), "utf8"), '{"schemaVersion":2}\n');
    await Promise.all(peers.map(stopPeer));
    await Promise.all(peers.map(startPeer));
    await converge(peers, 4, 1);
    assert.deepEqual(records(peers[0]).filter(({ name }) => name.startsWith(common.id)).map(({ bytes }) => bytes).sort(), versions.sort());
    t.diagnostic("Same-task reorder/edit: both byte versions retained, one conflict copy, unchanged after restart");
  }
});
