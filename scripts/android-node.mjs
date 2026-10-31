import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";
import runtime from "./android-runtime.json" with { type: "json" };

function verify(contents, expected, name) {
  if (createHash("sha256").update(contents).digest("hex") !== expected)
    throw new Error(`Android Node ${name} checksum mismatch.`);
}

export async function androidNode() {
  if (process.version !== runtime.version)
    throw new Error(
      `Android runtime is pinned to ${runtime.version}, but this Node is ${process.version}. Publish and pin the matching runtime before upgrading Node.`,
    );
  const source = path.join(homedir(), ".cache", "tasks-android", `node-${runtime.version}-arm64`);
  const binary = path.join(source, "out", "Release", "node");
  if (existsSync(binary)) {
    verify(readFileSync(binary), runtime.sha256, "cached executable");
    console.log(`Using verified Android Node runtime: ${binary}`);
    return binary;
  }

  console.log(`Downloading prebuilt Android Node ${runtime.version}; no source compilation.`);
  const response = await fetch(runtime.url);
  if (!response.ok) throw new Error(`Android Node download failed: HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  verify(archive, runtime.archiveSha256, "archive");
  const contents = gunzipSync(archive);
  verify(contents, runtime.sha256, "executable");
  mkdirSync(path.dirname(binary), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(binary), ".download-"));
  try {
    const staged = path.join(staging, "node");
    writeFileSync(staged, contents, { mode: 0o755 });
    renameSync(staged, binary);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return binary;
}

if (import.meta.main) await androidNode();
