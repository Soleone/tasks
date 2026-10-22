import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { bakeSea } from "./sea.mjs";

// Builds a signed release APK for arm64 phones: `pnpm build:android`. Needs JAVA_HOME, the Android
// SDK with build-tools and an NDK (ANDROID_HOME, default ~/Android/Sdk) and the signing key in
// src-tauri/gen/android/keystore.properties. The first run compiles Node for Android, which
// takes about half an hour; later runs reuse it from ~/.cache/tasks-android.
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
const keystore = path.join(root, "src-tauri/gen/android/keystore.properties");
const apk = path.join(
  root,
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
);
// Node needs Android 7 (API 24) or later; 28 is below the app's minimum, so it runs everywhere the app does.
const NODE_ANDROID_API = "28";

if (!process.env.JAVA_HOME) throw new Error("Set JAVA_HOME to a JDK 17 or later.");
if (!existsSync(toolchain)) throw new Error(`No Android NDK toolchain at ${toolchain}.`);
if (!existsSync(keystore))
  throw new Error(`No signing key: create ${keystore} as docs/development.md describes.`);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Node publishes no Android builds, so the same version as this Node is compiled from source. */
function androidNode() {
  const cache = path.join(homedir(), ".cache", "tasks-android");
  const source = path.join(cache, `node-${process.version}-arm64`);
  const binary = path.join(source, "out", "Release", "node");
  if (existsSync(binary)) return binary;

  const archive = `node-${process.version}.tar.xz`;
  run("mkdir", ["-p", cache]);
  run("curl", [
    "-fsSL",
    "-o",
    path.join(cache, archive),
    `https://nodejs.org/dist/${process.version}/${archive}`,
  ]);
  rmSync(source, { recursive: true, force: true });
  run("tar", ["-xJf", archive], { cwd: cache });
  renameSync(path.join(cache, `node-${process.version}`), source);

  // zlib's Android path needs the NDK's cpu-features library; the Linux path works on Android too.
  const zlib = path.join(source, "deps", "zlib", "zlib.gyp");
  writeFileSync(
    zlib,
    readFileSync(zlib, "utf8").replaceAll("'ARMV8_OS_ANDROID'", "'ARMV8_OS_LINUX'"),
  );
  // V8's build tools run here on an arm64 simulator, which needs the trap handler sources
  // that v8.gyp only adds when the OS isn't Android.
  const v8 = path.join(source, "tools", "v8_gypfiles", "v8.gyp");
  writeFileSync(
    v8,
    readFileSync(v8, "utf8").replaceAll(
      /(_toolset=="host" and host_arch=="x64" or _toolset=="target" and target_arch=="x64"\) and \(OS in "linux mac (?:win )?openharmony)"/g,
      '$1 android"',
    ),
  );
  // Tools that run during the build must be compiled for this machine, not for Android. The C++
  // runtime is linked in because Android doesn't ship it and the app's library folder isn't on the
  // executable's search path.
  const env = { ...process.env, CC_host: "gcc", CXX_host: "g++", LDFLAGS: "-static-libstdc++" };
  run("./android-configure", [ndk, NODE_ANDROID_API, "arm64"], { cwd: source, env });
  run("make", [`-j${availableParallelism()}`], { cwd: source, env });
  return binary;
}

bakeSea({
  node: androidNode(),
  bundle: path.join(root, "dist", "sidecar", "cli.cjs"),
  output: path.join(
    root,
    "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libtasks_backend.so",
  ),
  prepare: (executable) => run(path.join(toolchain, "llvm-strip"), [executable]),
});

run("pnpm", ["tauri", "android", "build", "--apk", "-t", "aarch64"], {
  cwd: root,
  env: { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk },
});
run(path.join(buildTools, "apksigner"), ["verify", apk], {
  env: {
    ...process.env,
    PATH: `${path.join(process.env.JAVA_HOME, "bin")}${path.delimiter}${process.env.PATH}`,
  },
});
console.log(`Signed APK: ${apk}`);
