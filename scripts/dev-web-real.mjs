import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * Keeps one copy of the owner's real task folder for `pnpm dev:web:real`. The
 * copy and its cache live under $DATA/apps/tasks, outside any Syncthing folder,
 * so dev edits never reach the real tasks. `--refresh` replaces the copy.
 */
export async function realSnapshot(refresh) {
  if (!process.env.DATA) throw new Error("dev:web:real keeps its copy under $DATA; set DATA");
  const home = path.join(process.env.DATA, "apps", "tasks");
  const configFile = path.join(home, "dev-web-real.json");
  const snapshot = path.join(home, "dev-web-real");
  const source = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8")).source
    : await askSource(configFile);
  if (!isFolder(source)) throw new Error(`${source} is not a folder; fix or delete ${configFile}`);
  const root = path.join(snapshot, "root");
  if (refresh || !existsSync(root)) {
    rmSync(snapshot, { recursive: true, force: true });
    cpSync(source, root, { recursive: true });
    process.stdout.write(`[dev:web] copied ${source} to ${root}\n`);
  }
  return {
    root,
    database: path.join(snapshot, "cache.db"),
    profile: path.join(snapshot, "profile"),
  };
}

async function askSource(configFile) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Path to your real task folder (copied, never changed): ");
  prompt.close();
  const source = path.resolve(answer.trim().replace(/^~(?=$|\/)/, homedir()));
  if (!answer.trim() || !isFolder(source))
    throw new Error("dev:web:real needs the path to your real task folder");
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify({ source }, null, 2)}\n`);
  return source;
}

function isFolder(file) {
  return statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
}
