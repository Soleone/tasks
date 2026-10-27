import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import release from "release-it";

// `pnpm release` asks for the bump, writes CHANGELOG.md from feat/fix commits, tags and creates
// the GitHub release (.release-it.json). `pnpm release:windows` and `pnpm release:android` then
// build that tag on their own host and attach the result. Everything goes through a logged-in `gh`.
const root = path.resolve(import.meta.dirname, "..");

const platforms = {
  windows: {
    build: "build:tauri",
    output: (version) => `src-tauri/target/release/bundle/nsis/Tasks_${version}_x64-setup.exe`,
    asset: (version) => `Tasks_${version}_x64-setup.exe`,
  },
  android: {
    build: "build:android",
    output: () =>
      "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
    asset: (version) => `Tasks_${version}_arm64.apk`,
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
    throw new Error(`HEAD is not ${tag}. Run \`git pull --tags\` and check out ${tag} first.`);
  gh("release", "view", tag, "--json", "tagName");

  execSync(`pnpm run ${platform.build}`, { cwd: root, stdio: "inherit" });

  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "tasks-release-")),
    platform.asset(version),
  );
  copyFileSync(path.join(root, platform.output(version)), file);
  gh("release", "upload", tag, file, "--clobber");
  console.log(`Attached ${path.basename(file)} to ${tag}.`);
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
