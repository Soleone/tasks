import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(root, "dist", "sidecar");
const bundledEntry = path.join(outputDirectory, "cli.cjs");
const blobPath = path.join(outputDirectory, "sea-prep.blob");
const extension = process.platform === "win32" ? ".exe" : "";
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const executablePath = path.join(outputDirectory, `tasks-backend${extension}`);
const targetPath = path.join(root, "src-tauri", "binaries", `tasks-backend-${target}${extension}`);
const seaConfigPath = path.join(outputDirectory, "sea-config.json");

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(path.dirname(targetPath), { recursive: true });

writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundledEntry,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    },
    null,
    2,
  ),
);

execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { stdio: "inherit" });
copyFileSync(process.execPath, executablePath);

if (process.platform === "win32" || process.platform === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", executablePath], { stdio: "ignore" });
  } catch {
    // Unsigned binaries are usable for local development. Signing belongs to release packaging.
  }
}

const postjectCli = path.join(root, "node_modules", "postject", "dist", "cli.js");
execFileSync(
  process.execPath,
  [postjectCli, executablePath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"],
  { cwd: root, stdio: "inherit" },
);

if (process.platform !== "win32") {
  execFileSync("chmod", ["+x", executablePath]);
}

copyFileSync(executablePath, targetPath);
rmSync(blobPath, { force: true });
rmSync(seaConfigPath, { force: true });
console.log(`Built ${path.relative(root, targetPath)} for ${target}`);
