import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nativePilotConfig, nativePilotSelection, resolveNativePilotSelection } from "./native-pilot-options.mjs";

const root = path.resolve(import.meta.dirname, "..");
const selection = resolveNativePilotSelection(nativePilotSelection(process.argv.slice(2)));
// Build-time path resolution precedes any app query; the window must still confirm all three paths before spawning.
execFileSync("pnpm", ["ensure:sidecar"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
mkdirSync(path.join(root, ".tmp"), { recursive: true });
const directory = mkdtempSync(path.join(root, ".tmp/native-pilot-")), overlay = path.join(directory, "config.json");
writeFileSync(overlay, JSON.stringify(nativePilotConfig(selection, path.join(directory, "webview")), null, 2) + "\n");
process.stdout.write(`Disposable Windows native pilot selection: ${JSON.stringify(selection)}\nCapability overlay: ${overlay}\n`);
const child = spawn(process.execPath, [path.join(root, "node_modules/@tauri-apps/cli/tauri.js"), "dev", "--config", overlay], {
  cwd: root, stdio: "inherit", env: { ...process.env, VITE_TASKDB_V2: "1", VITE_TASKDB_V2_EDIT: "1", VITE_TASKDB_V2_NATIVE_SELECTION: JSON.stringify(selection) },
});
child.on("error", reason => { process.stderr.write(`${reason.message}\n`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
