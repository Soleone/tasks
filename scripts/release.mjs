import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import release from "release-it";

// All three steps run in WSL. `pnpm release` asks for the bump, writes CHANGELOG.md from feat/fix
// commits, tags and creates the GitHub release (.release-it.json). `pnpm release:windows` and
// `pnpm release:android` then build that tag and attach the result with WSL's logged-in `gh`.
const root = path.resolve(import.meta.dirname, "..");
// Where the owner's `win-sync` copies this checkout; Windows builds there, without git.
const windowsCopy = "/mnt/d/src/wsl/tasks";
// The key that signs Windows updates and its password, kept outside the repo. Installed apps
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
      // The manifest the installed apps poll through releases/latest; uploaded last, so it
      // never names an installer that isn't there yet.
      const url = gh("repo", "view", "--json", "url", "--jq", ".url").trim();
      const manifest = {
        version,
        pub_date: new Date().toISOString(),
        platforms: {
          "windows-x86_64": {
            signature: readFileSync(`${output}.sig`, "utf8"),
            url: `${url}/releases/download/v${version}/${installer}`,
          },
        },
      };
      writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      return [installer, "latest.json"];
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
  if (!platform) throw new Error(`Unknown platform ${target}; use windows or android.`);
  attach(platform);
} else {
  process.env.GITHUB_TOKEN ??= gh("auth", "token").trim();
  // release-it has already printed the reason when it rejects.
  await release({ "dry-run": args.includes("--dry-run") }).catch(() => {
    process.exitCode = 1;
  });
}
