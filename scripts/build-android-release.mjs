import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const androidProjectDirectory = path.join(root, "src-tauri", "gen", "android");
const keystorePropertiesFile = path.join(androidProjectDirectory, "keystore.properties");
const apkOutputDirectory = path.join(androidProjectDirectory, "app", "build", "outputs", "apk");
const releaseSigningPropertyNames = ["storeFile", "storePassword", "keyAlias", "keyPassword"];
const isWindows = process.platform === "win32";

function validateSigningPropertyFile() {
  if (!existsSync(keystorePropertiesFile)) {
    throw new Error(
      "Android release signing is required. Create src-tauri/gen/android/keystore.properties using the Signed Android release APK instructions in docs/development.md. Never commit the properties file or keystore.",
    );
  }

  let contents;
  try {
    contents = readFileSync(keystorePropertiesFile, "utf8");
  } catch {
    throw new Error(
      "Unable to read src-tauri/gen/android/keystore.properties. Check its local file permissions.",
    );
  }

  const presentProperties = new Set();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(storeFile|storePassword|keyAlias|keyPassword)(?:\s*[:=]\s*|\s+)(.*)$/.exec(
      line,
    );
    if (match && match[2].trim()) presentProperties.add(match[1]);
  }

  const missingProperties = releaseSigningPropertyNames.filter(
    (name) => !presentProperties.has(name),
  );
  if (missingProperties.length > 0) {
    throw new Error(
      `Android release signing properties are missing or empty: ${missingProperties.join(", ")}. ` +
        "Complete src-tauri/gen/android/keystore.properties using the instructions in docs/development.md. Never commit the properties file or keystore.",
    );
  }
}

function releaseApks(directory = apkOutputDirectory, parentParts = []) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      return releaseApks(entryPath, [...parentParts, entry.name.toLowerCase()]);

    const isApk = entry.isFile() && entry.name.toLowerCase().endsWith(".apk");
    const isRelease =
      parentParts.includes("release") || entry.name.toLowerCase().includes("release");
    return isApk && isRelease ? [entryPath] : [];
  });
}

function findApksigner() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) {
    throw new Error(
      "Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK containing apksigner.",
    );
  }

  const buildToolsDirectory = path.join(sdkRoot, "build-tools");
  if (!existsSync(buildToolsDirectory)) {
    throw new Error(`Android SDK build-tools were not found under ${buildToolsDirectory}.`);
  }

  const executableNames = isWindows ? ["apksigner.bat", "apksigner.cmd"] : ["apksigner"];
  const versions = readdirSync(buildToolsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
    );

  for (const version of versions) {
    for (const executableName of executableNames) {
      const candidate = path.join(buildToolsDirectory, version, executableName);
      try {
        accessSync(candidate, isWindows ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Try the next installed build-tools version.
      }
    }
  }

  throw new Error(
    `No executable apksigner was found under ${buildToolsDirectory}. Install Android SDK Build-Tools.`,
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
  });

  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  validateSigningPropertyFile();
  const apksigner = findApksigner();

  const previousApks = new Map(
    releaseApks().map((apk) => {
      const stats = statSync(apk);
      return [apk, `${stats.size}:${stats.mtimeMs}`];
    }),
  );

  console.log("Building signed arm64 Android release APK...");
  run("pnpm", ["exec", "tauri", "android", "build", "--apk", "-t", "aarch64"]);

  const builtApks = releaseApks().sort();
  if (builtApks.length === 0) {
    throw new Error(`The Android release build produced no APK under ${apkOutputDirectory}.`);
  }
  const changedApks = builtApks.filter((apk) => {
    const stats = statSync(apk);
    return previousApks.get(apk) !== `${stats.size}:${stats.mtimeMs}`;
  });
  const apksToVerify = changedApks.length > 0 ? changedApks : builtApks;

  for (const apk of apksToVerify) {
    console.log(`Verifying ${path.relative(root, apk)} with apksigner...`);
    run(apksigner, ["verify", "--verbose", apk]);
  }
} catch (error) {
  console.error(`Android release build failed: ${error.message}`);
  process.exitCode = 1;
}
