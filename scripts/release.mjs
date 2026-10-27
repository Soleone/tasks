import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import release from "release-it";

// `pnpm release` asks for the bump, writes CHANGELOG.md from feat/fix commits, tags and creates
// the GitHub release (.release-it.json). `pnpm release:windows` and `pnpm release:android` then
// build that tag in WSL, and `pnpm release:linux` on the Omarchy machine, each attaching its
// result with that host's logged-in `gh`.
const root = path.resolve(import.meta.dirname, "..");
// Where the owner's `win-sync` copies this checkout; Windows builds there, without git.
const windowsCopy = "/mnt/d/src/wsl/tasks";
// The key that signs desktop updates and its password, kept outside the repo. Installed apps
// trust only its public half in tauri.conf.json, so losing it means one manual install everywhere.
const releaseSecrets = path.join(
  process.env.DATA ?? path.join(os.homedir(), "data"),
  "apps/tasks/release",
);

/** Signing variables for Tauri's build, passed through to Windows by WSLENV. */
function signingEnv() {
  const signing = {
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(
      path.join(releaseSecrets, "updater.key"),
      "utf8",
    ).trim(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(
      path.join(releaseSecrets, "updater.password"),
      "utf8",
    ).trim(),
  };
  const wslenv = [process.env.WSLENV, ...Object.keys(signing)].filter(Boolean).join(":");
  return { ...process.env, ...signing, WSLENV: wslenv };
}

// Each build puts its files into `dir` under their asset names and returns them in upload order.
const platforms = {
  windows: {
    build(version, dir) {
      const env = signingEnv();
      execFileSync("win-sync", [root], { stdio: "inherit" });
      execFileSync(
        "cmd.exe",
        [
          "/c",
          "pnpm install --frozen-lockfile && pnpm build:tauri --config src-tauri/tauri.release.conf.json",
        ],
        { cwd: windowsCopy, stdio: "inherit", env },
      );
      const installer = `Tasks_${version}_x64-setup.exe`;
      const output = path.join(windowsCopy, "src-tauri/target/release/bundle/nsis", installer);
      copyFileSync(output, path.join(dir, installer));
      writeManifest(version, dir, "windows-x86_64", installer, `${output}.sig`);
      return [installer, "latest.json"];
    },
  },
  linux: {
    build(version, dir) {
      if (process.platform !== "linux" || os.release().toLowerCase().includes("microsoft"))
        throw new Error("Build the Linux release on the Omarchy machine, not in WSL or elsewhere.");
      execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
      execFileSync(
        "pnpm",
        ["build:tauri", "--config", "src-tauri/tauri.release.conf.json", "--bundles", "appimage"],
        // linuxdeploy's own strip is too old for Arch's libraries and fails the bundle.
        { cwd: root, stdio: "inherit", env: { ...signingEnv(), NO_STRIP: "true" } },
      );
      const appimage = `Tasks_${version}_amd64.AppImage`;
      const output = path.join(root, "src-tauri/target/release/bundle/appimage", appimage);
      copyFileSync(output, path.join(dir, appimage));
      writeManifest(version, dir, "linux-x86_64", appimage, `${output}.sig`);
      return [appimage, "latest.json"];
    },
  },
  android: {
    build(version, dir) {
      execFileSync("pnpm", ["run", "build:android"], { cwd: root, stdio: "inherit" });
      const apk = `Tasks_${version}_arm64.apk`;
      copyFileSync(
        path.join(
          root,
          "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
        ),
        path.join(dir, apk),
      );
      return [apk];
    },
  },
};

/**
 * Writes `latest.json`, the manifest installed apps poll through releases/latest, adding this
 * platform's entry to the one the release already has. It is uploaded after the build it names,
 * so it never points at a file that isn't there yet. Run the desktop steps one after the other:
 * two at once would each upload a manifest without the other's entry.
 */
function writeManifest(version, dir, platform, asset, signature) {
  const tag = `v${version}`;
  const file = path.join(dir, "latest.json");
  const uploaded = gh("release", "view", tag, "--json", "assets", "--jq", ".assets[].name");
  let platforms = {};
  if (uploaded.split("\n").includes("latest.json")) {
    gh("release", "download", tag, "--pattern", "latest.json", "--dir", dir);
    platforms = JSON.parse(readFileSync(file, "utf8")).platforms;
  }
  const url = gh("repo", "view", "--json", "url", "--jq", ".url").trim();
  platforms[platform] = {
    signature: readFileSync(signature, "utf8"),
    url: `${url}/releases/download/${tag}/${asset}`,
  };
  const manifest = { version, pub_date: new Date().toISOString(), platforms };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gh(...args) {
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** Builds the checked-out release tag and uploads it, replacing an earlier upload of the same file. */
function attach(platform) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const tag = `v${version}`;
  if (git("status", "--porcelain"))
    throw new Error("Commit or stash local changes first: the build must match the tag.");
  if (!git("tag", "--points-at", "HEAD").split("\n").includes(tag))
    throw new Error(`HEAD is not ${tag}. Check out ${tag} first.`);
  gh("release", "view", tag, "--json", "tagName");

  const dir = mkdtempSync(path.join(tmpdir(), "tasks-release-"));
  for (const asset of platform.build(version, dir)) {
    gh("release", "upload", tag, path.join(dir, asset), "--clobber");
    console.log(`Attached ${asset} to ${tag}.`);
  }
}

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
if (target) {
  const platform = platforms[target];
  if (!platform) throw new Error(`Unknown platform ${target}; use windows, linux or android.`);
  attach(platform);
} else {
  process.env.GITHUB_TOKEN ??= gh("auth", "token").trim();
  // release-it has already printed the reason when it rejects.
  await release({ "dry-run": args.includes("--dry-run") }).catch(() => {
    process.exitCode = 1;
  });
}
