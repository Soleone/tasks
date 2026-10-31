import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import path from "node:path";
import process from "node:process";

// Node needs Android 7 (API 24) or later; 28 is below the app's minimum.
const NODE_ANDROID_API = "28";

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Node publishes no Android builds, so compile the same version as this Node. */
export function androidNode(ndk) {
  const cache = path.join(homedir(), ".cache", "tasks-android");
  const source = path.join(cache, `node-${process.version}-arm64`);
  const binary = path.join(source, "out", "Release", "node");
  if (existsSync(binary)) {
    console.log(`Using cached Android Node runtime: ${binary}`);
    return binary;
  }
  if (!ndk) throw new Error("Set NDK_HOME to compile the Android Node runtime.");
  console.log(`Compiling Node ${process.version} for Android; a cold build can take over an hour.`);

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
  // Build-time tools run on this host. Link the C++ runtime into the Android executable.
  const env = { ...process.env, CC_host: "gcc", CXX_host: "g++", LDFLAGS: "-static-libstdc++" };
  run("./android-configure", [ndk, NODE_ANDROID_API, "arm64"], { cwd: source, env });
  run("make", [`-j${availableParallelism()}`], { cwd: source, env });
  return binary;
}

if (import.meta.main) androidNode(process.env.NDK_HOME);
