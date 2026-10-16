import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.platform !== "win32")
  throw new Error(
    "Run this argv proof on actual Windows, not WSL Node against mounted Windows paths.",
  );
const root = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(os.tmpdir(), "Tasks-argv-"));
const launcher = path.join(root, "scripts/dev-native.mjs");
const options = path.join(root, "scripts/native-pilot-options.mjs");
const selectionSource = path.join(root, "src/platform/nativeSelection.ts");
const packagePath = path.join(root, "package.json");
const workspacePath = path.join(root, "pnpm-workspace.yaml");
const launcherUrl = pathToFileURL(launcher).href;
const preflight =
  'execFileSync("pnpm", ["ensure:sidecar"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });';
const launcherSource = readFileSync(launcher, "utf8");
assert.equal(
  launcherSource.split(preflight).length,
  2,
  "the stop-before-launch boundary must remain unique",
);
mkdirSync(path.join(scratch, "scripts"));
const nativeScript = JSON.parse(readFileSync(packagePath, "utf8")).scripts["dev:native"];
assert.equal(nativeScript, "node scripts/dev-native.mjs");
writeFileSync(
  path.join(scratch, "package.json"),
  JSON.stringify({
    name: "tasks-native-argv-proof",
    private: true,
    type: "module",
    scripts: {
      "dev:native": nativeScript.replace("node ", "node --import ./stop-before-launch.mjs "),
    },
  }),
);
writeFileSync(path.join(scratch, "pnpm-workspace.yaml"), readFileSync(workspacePath, "utf8"));
writeFileSync(
  path.join(scratch, "scripts/dev-native.mjs"),
  `import ${JSON.stringify(launcherUrl)};\n`,
);
// The real launcher parses/resolves first. This test-only loader stops before build, overlay or app launch.
writeFileSync(
  path.join(scratch, "stop-before-launch.mjs"),
  `
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  const loaded=next(url,context);
  if(url!==${JSON.stringify(launcherUrl)})return loaded;
  const source=loaded.source.toString();
  const marker=${JSON.stringify(preflight)};
  if(source.split(marker).length!==2)throw Error('unique preflight required');
  const stop='console.log("ARGV_PROBE "+JSON.stringify({argv:process.argv.slice(2),selection,overlay:nativePilotConfig(selection,selection.profilePath+"\\\\webview")}));process.exit(0);';
  return {...loaded,source:source.replace(marker,stop)};
}});
`,
);
const environment = {
  ...process.env,
  TASKS_SYNC_ROOT: path.join(scratch, "unused-sync"),
  TASKS_DATABASE_PATH: path.join(scratch, "unused.db"),
  TASKS_SOURCE_REGISTRY_PATH: "",
  APPDATA: path.join(scratch, "unused-profile"),
  XDG_DATA_HOME: path.join(scratch, "unused-profile"),
};
delete environment.NODE_OPTIONS;
const rows = [];

function invoke(name, command, args) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Continue'; $values=ConvertFrom-Json $env:TASKS_ARGV_PROOF_INPUT; $arguments=@($values.args); & $values.command @arguments; exit $LASTEXITCODE",
    ],
    {
      cwd: scratch,
      env: { ...environment, TASKS_ARGV_PROOF_INPUT: JSON.stringify({ command, args }) },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.error, undefined, `${name}: ${result.error?.message}`);
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("ARGV_PROBE "));
  const observation = line ? JSON.parse(line.slice("ARGV_PROBE ".length)) : null;
  const errorOutput = result.stderr
    .split(/\r?\n/)
    .filter((value) => !value.includes("data:text/javascript;base64,"))
    .join("\n")
    .slice(0, 4000);
  const row = {
    name,
    exitCode: result.status,
    observation,
    ...(observation ? {} : { errorOutput }),
  };
  rows.push(row);
  return row;
}

function verifyPrepared(row, expected) {
  assert.equal(row.exitCode, 0, JSON.stringify(row));
  assert.ok(row.observation, "an exit code alone is not launch preparation proof");
  assert.deepEqual(row.observation.argv, expected);
  const selected = { rootPath: expected[1], databasePath: expected[3], profilePath: expected[5] };
  assert.deepEqual(row.observation.selection, selected);
  const capability = row.observation.overlay.app.security.capabilities;
  assert.equal(capability.length, 1);
  assert.deepEqual(capability[0].platforms, ["windows"]);
  assert.deepEqual(capability[0].windows, ["main"]);
  assert.equal(capability[0].local, true);
  const scope = capability[0].permissions[3].allow[0];
  assert.equal(scope.name, "binaries/tasks-backend");
  const sidecarArgs = [
    "--stdio",
    "--root",
    selected.rootPath,
    "--database",
    selected.databasePath,
    "--windows-task-proof",
    "--local-profile",
    selected.profilePath,
  ];
  const scopedArgs = sidecarArgs.map((value, index) =>
    [2, 4, 7].includes(index)
      ? { validator: `\\A${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\z` }
      : value,
  );
  assert.deepEqual(scope.args, scopedArgs);
  assert.equal(existsSync(selected.databasePath), false);
  assert.deepEqual(readdirSync(selected.profilePath), []);
}

try {
  for (const [name, rootName, cacheName, profileName] of [
    ["plain", "r", "c.db", "p"],
    ["spaces", "root space", "cache space.db", "profile space"],
    ["unicode-symbols", "root Ω & (test)", "cache Ω ^ !.db", "profile Ω (test)"],
  ]) {
    const selectedRoot = path.join(scratch, rootName),
      profile = path.join(scratch, profileName);
    mkdirSync(selectedRoot);
    mkdirSync(profile);
    const argv = [
      "--root",
      selectedRoot,
      "--database",
      path.join(scratch, cacheName),
      "--local-profile",
      profile,
    ];
    verifyPrepared(invoke(`${name}-package`, "pnpm", ["dev:native", ...argv]), argv);
    const separator = invoke(`${name}-package-separator`, "pnpm", ["dev:native", "--", ...argv]);
    assert.notEqual(separator.exitCode, 0);
    assert.equal(separator.observation, null);
    assert.match(separator.errorOutput, /Supply exactly --root ROOT/);
    assert.deepEqual(readdirSync(selectedRoot), []);
    assert.deepEqual(readdirSync(profile), []);
    assert.equal(existsSync(argv[3]), false);
  }
  const versions = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "pnpm --version"],
    { cwd: scratch, env: environment, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(versions.status, 0, versions.stderr);
  const report = {
    platform: process.platform,
    release: os.release(),
    nodeVersion: process.version,
    pnpmVersion: versions.stdout.trim(),
    scratch,
    scope:
      "actual Windows launch preparation stopped before ensure-sidecar/build/overlay/application/query; no native UI acceptance",
    sources: [launcher, options, selectionSource, packagePath, workspacePath].map((file) => ({
      path: path.relative(root, file),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    })),
    observations: rows,
  };
  const reportPath = path.join(scratch, "argv-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `PASS: ${rows.length} actual Windows argv preparation/refusal scenes. Evidence retained: ${reportPath}`,
  );
} catch (error) {
  writeFileSync(
    path.join(scratch, "failed-report.json"),
    JSON.stringify({ scratch, observations: rows }, null, 2),
  );
  console.error(`Failed argv proof retained at ${scratch}`);
  throw error;
}
