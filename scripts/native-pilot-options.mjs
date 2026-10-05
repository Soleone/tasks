import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [fileURLToPath(new URL("../src/platform/v2NativeSelection.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { validateV2NativeSelection, v2NativeSidecarArgs } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

export function nativePilotSelection(argv) {
  const flags = ["--v2-root", "--database", "--local-profile"];
  if (argv.length !== 6 || flags.some((flag, index) => argv[index * 2] !== flag || typeof argv[index * 2 + 1] !== "string" || !argv[index * 2 + 1])) {
    throw new Error("Supply exactly --v2-root ROOT --database CACHE --local-profile PROFILE; no extra Tauri arguments or default selection.");
  }
  const selection = { rootPath: argv[1], databasePath: argv[3], profilePath: argv[5] };
  validateV2NativeSelection(selection);
  return selection;
}

function disjoint(left, right) {
  const relative = path.relative(left, right);
  return relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

export function resolveNativePilotSelection(selection) {
  if (process.platform !== "win32") throw new Error("The native task pilot requires actual Windows on the selected local NTFS host.");
  validateV2NativeSelection(selection);
  const rootPath = realpathSync(selection.rootPath), profilePath = realpathSync(selection.profilePath);
  if (!lstatSync(rootPath).isDirectory() || !lstatSync(profilePath).isDirectory()) throw new Error("Create the disposable root and dedicated profile directories explicitly before launch.");
  const databasePath = lstatSync(selection.databasePath, { throwIfNoEntry: false }) ? realpathSync(selection.databasePath)
    : path.join(realpathSync(path.dirname(selection.databasePath)), path.basename(selection.databasePath));
  const resolved = { rootPath, databasePath, profilePath };
  validateV2NativeSelection(resolved);
  if (lstatSync(databasePath, { throwIfNoEntry: false })?.isDirectory()) throw new Error("The explicit cache must name a file, not a directory.");
  for (const drive of new Set(Object.values(resolved).map(filename => filename[0].toUpperCase()))) {
    const volume = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=Get-Volume -DriveLetter ${drive}; @{filesystem=$v.FileSystem;driveType=$v.DriveType.ToString()} | ConvertTo-Json -Compress`], { encoding: "utf8" }));
    if (volume.filesystem !== "NTFS" || volume.driveType !== "Fixed") throw new Error("Native task proof requires fixed local NTFS paths; network/provider storage remains withheld.");
  }
  for (const [left, right] of [[rootPath, databasePath], [rootPath, profilePath], [profilePath, rootPath], [profilePath, databasePath]]) {
    if (!disjoint(left, right)) throw new Error("Native root, cache and dedicated profile must have physically separate scopes.");
  }
  return Object.freeze(resolved);
}

export function nativePilotConfig(selection, webviewDirectory) {
  if (typeof webviewDirectory !== "string" || !/^[A-Za-z]:\\/.test(webviewDirectory) || Array.from(webviewDirectory).some(character => character.charCodeAt(0) < 32)) throw new Error("Select an explicit disposable WebView data directory.");
  const configuration = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const mainWindow = configuration.app.windows.find(window => window.label === "main");
  if (!mainWindow) throw new Error("The native pilot requires the existing main window.");
  const args = v2NativeSidecarArgs(selection).map((value, index) => [2, 4, 7].includes(index)
    ? { validator: `\\A${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\z` } : value);
  return { build: { devUrl: "http://127.0.0.1:5178", beforeDevCommand: "pnpm exec vite --host 127.0.0.1 --port 5178 --strictPort" }, app: { windows: [{ ...mainWindow, title: "Tasks: disposable native pilot", dataDirectory: webviewDirectory }], security: { capabilities: [{ identifier: "windows-task-pilot", description: "Explicit disposable Windows task selection only", local: true,
    platforms: ["windows"], windows: ["main"], permissions: ["core:default", "shell:allow-stdin-write", "shell:allow-kill",
      { identifier: "shell:allow-spawn", allow: [{ name: "binaries/tasks-backend", sidecar: true, args }] }] }] } } };
}
