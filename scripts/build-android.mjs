import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { androidNode } from "./android-node.mjs";
import { releaseSecrets } from "./releaseSecrets.mjs";
import { bakeSea } from "./sea.mjs";

// Builds a signed release APK for arm64 phones: `pnpm build:android`. Needs JAVA_HOME, the Android
// SDK with build-tools and an NDK (ANDROID_HOME, default ~/Android/Sdk) and the signing key in
// the release secrets folder (android.jks and android.properties). The pinned Android Node runtime
// is downloaded once, checksum-verified and reused from ~/.cache/tasks-android.
const root = path.resolve(import.meta.dirname, "..");
const sdk = process.env.ANDROID_HOME ?? path.join(homedir(), "Android", "Sdk");
const ndk =
  process.env.NDK_HOME ??
  path.join(sdk, "ndk", readdirSync(path.join(sdk, "ndk")).sort().at(-1) ?? "missing");
const toolchain = path.join(ndk, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin");
const buildTools = path.join(
  sdk,
  "build-tools",
  readdirSync(path.join(sdk, "build-tools")).sort().at(-1) ?? "missing",
);
const signing = path.join(releaseSecrets, "android.properties");
const apk = path.join(
  root,
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
);
if (!process.env.JAVA_HOME) throw new Error("Set JAVA_HOME to a JDK 17 or later.");
if (!existsSync(toolchain)) throw new Error(`No Android NDK toolchain at ${toolchain}.`);
if (!existsSync(signing))
  throw new Error(`No signing key: create ${signing} as docs/development.md describes.`);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

bakeSea({
  node: await androidNode(),
  bundle: path.join(root, "dist", "sidecar", "tasks-cli.cjs"),
  output: path.join(
    root,
    "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libtasks_backend.so",
  ),
  prepare: (executable) => run(path.join(toolchain, "llvm-strip"), [executable]),
});

run("pnpm", ["tauri", "android", "build", "--apk", "-t", "aarch64"], {
  cwd: root,
  env: { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk, TASKS_ANDROID_SIGNING: signing },
});
run(path.join(buildTools, "apksigner"), ["verify", apk], {
  env: {
    ...process.env,
    PATH: `${path.join(process.env.JAVA_HOME, "bin")}${path.delimiter}${process.env.PATH}`,
  },
});
console.log(`Signed APK: ${apk}`);
