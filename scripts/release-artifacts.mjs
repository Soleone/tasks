import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const windows = `Tasks_${version}_x64-setup.exe`;
const linux = `Tasks_${version}_amd64.AppImage`;
const dmg = `Tasks_${version}_aarch64.dmg`;
const macUpdater = `Tasks_${version}_aarch64.app.tar.gz`;
const apk = `Tasks_${version}_arm64.apk`;
const files = {
  windows: [{ source: `nsis/${windows}`, name: windows, target: "windows-x86_64" }],
  linux: [{ source: `appimage/${linux}`, name: linux, target: "linux-x86_64" }],
  macos: [
    { source: `dmg/${dmg}`, name: dmg },
    { source: "macos/Tasks.app.tar.gz", name: macUpdater, target: "darwin-aarch64" },
  ],
  android: [{ source: "app-universal-release.apk", name: apk }],
};

function verifyTag(tag) {
  if (tag !== `v${version}`)
    throw new Error(`Release tag ${tag} does not match package.json version ${version}.`);
}

function requireFile(file) {
  if (statSync(file).size === 0) throw new Error(`Empty release asset: ${file}`);
}

function stage(platform, source, output) {
  mkdirSync(output, { recursive: true });
  for (const file of files[platform]) {
    for (const suffix of file.target ? ["", ".sig"] : [""]) {
      const input = path.join(source, `${file.source}${suffix}`);
      requireFile(input);
      copyFileSync(input, path.join(output, `${file.name}${suffix}`));
    }
  }
}

function manifest(directory, tag) {
  verifyTag(tag);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Set GITHUB_REPOSITORY to the release's owner/repository.");
  const platforms = {};
  for (const file of Object.values(files).flat()) {
    requireFile(path.join(directory, file.name));
    if (!file.target) continue;
    const signature = readFileSync(path.join(directory, `${file.name}.sig`), "utf8").trim();
    if (!signature) throw new Error(`Empty updater signature for ${file.name}.`);
    platforms[file.target] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${file.name}`,
    };
  }
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const section = changelog
    .split(/(?=^#{1,2} \[?\d+\.\d+\.\d+)/m)
    .find((part) => /^#{1,2} \[?(\d+\.\d+\.\d+)/.exec(part)?.[1] === version);
  if (!section) throw new Error(`No changelog entry for ${version}.`);
  const notes = section.slice(section.indexOf("\n") + 1).trim();
  writeFileSync(
    path.join(directory, "latest.json"),
    `${JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`,
  );
  writeFileSync(path.join(directory, "notes.md"), `${notes}\n`);
}

const [command, input, output] = process.argv.slice(2);
if (command === "verify-tag") verifyTag(input);
else if (command === "manifest") manifest(input, output);
else if (Object.hasOwn(files, command)) stage(command, input, output);
else throw new Error("Use verify-tag, windows, linux, macos, android or manifest.");
