import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const [binary, output] = process.argv.slice(2);
if (!binary || !output) throw new Error("Use package-android-runtime.mjs BINARY OUTPUT_DIRECTORY.");
const contents = readFileSync(binary);
const sha256 = createHash("sha256").update(contents).digest("hex");
const archive = gzipSync(contents);
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
const tag = `android-node-${process.version}-arm64-${sha256.slice(0, 12)}`;
const name = `node-${process.version}-android-arm64.gz`;
const repository = process.env.GITHUB_REPOSITORY ?? "Soleone/tasks";
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, name), archive);
writeFileSync(
  path.join(output, "android-runtime.json"),
  `${JSON.stringify(
    {
      version: process.version,
      url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
      sha256,
      archiveSha256,
    },
    null,
    2,
  )}\n`,
);
console.log(tag);
