import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

/**
 * Bakes an esbuild bundle into a copy of a Node executable, so the result runs without Node
 * installed. The blob is prepared by this Node, so `node` must be the same Node version.
 * `prepare` runs on the copy before the bundle goes in, for signature removal or stripping.
 */
export function bakeSea({ node, bundle, output, prepare = () => {} }) {
  const workDirectory = path.dirname(bundle);
  const name = path.basename(output);
  const blobPath = path.join(workDirectory, `${name}-sea-prep.blob`);
  const seaConfigPath = path.join(workDirectory, `${name}-sea-config.json`);
  const executablePath = path.join(workDirectory, name);
  mkdirSync(path.dirname(output), { recursive: true });

  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundle,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
      },
      null,
      2,
    ),
  );
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
  });
  copyFileSync(node, executablePath);
  prepare(executablePath);

  const postjectCli = path.join(root, "node_modules", "postject", "dist", "cli.js");
  execFileSync(
    process.execPath,
    [
      postjectCli,
      executablePath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (process.platform !== "win32") execFileSync("chmod", ["+x", executablePath]);

  copyFileSync(executablePath, output);
  rmSync(blobPath, { force: true });
  rmSync(seaConfigPath, { force: true });
  console.log(`Built ${path.relative(root, output)}`);
}
