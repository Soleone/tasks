import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const testData = path.join(import.meta.dirname, "fixtures/workspace/root");

/**
 * Keeps one copy of the owner's real task folder for `pnpm dev:web:real`. The
 * copy and its cache live under $DATA/apps/tasks, outside any Syncthing folder,
 * so dev edits never reach the real tasks. `--refresh` asks again and replaces the copy.
 */
export async function realSnapshot(refresh) {
  if (!process.env.DATA) throw new Error("dev:web:real keeps its copy under $DATA; set DATA");
  const home = path.join(process.env.DATA, "apps", "tasks");
  const configFile = path.join(home, "dev-web-real.json");
  const snapshot = path.join(home, "dev-web-real");
  // A saved null means the test data, so the choice survives the worktree it was made in.
  let choice = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8")).source
    : undefined;
  if (choice === undefined || refresh) {
    choice = await askSource(choice);
    mkdirSync(home, { recursive: true });
    writeFileSync(configFile, `${JSON.stringify({ source: choice }, null, 2)}\n`);
  }
  const source = choice ?? testData;
  if (!isFolder(source)) throw new Error(`${source} is not a folder; fix or delete ${configFile}`);
  const root = path.join(snapshot, "root");
  if (refresh || !existsSync(root)) {
    rmSync(snapshot, { recursive: true, force: true });
    cpSync(source, root, { recursive: true });
    process.stdout.write(`[dev:web] copied ${describe(source)} to ${root}\n`);
  }
  return {
    root,
    database: path.join(snapshot, "cache.db"),
    profile: path.join(snapshot, "profile"),
  };
}

/** Enter takes the default. Without a terminal (agents, CI) it never asks and never picks a found folder. */
async function askSource(saved) {
  if (!process.stdin.isTTY) return saved ?? null;
  const fallback = saved === undefined ? (foundTaskFolder() ?? null) : saved;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = await prompt.question(
        `Real task folder to copy (Enter for ${describe(fallback)}): `,
      );
      if (!answer.trim()) return fallback;
      const source = path.resolve(answer.trim().replace(/^~(?=$|\/)/, homedir()));
      if (isFolder(source)) return source;
      process.stdout.write(`${source} is not a folder.\n`);
    }
  } finally {
    prompt.close();
  }
}

/** The desktop app suggests Documents/Tasks; under WSL that is usually on the Windows side. */
function foundTaskFolder() {
  const windowsUsers = isFolder("/mnt/c/Users") ? readdirSync("/mnt/c/Users") : [];
  return [
    path.join(homedir(), "Documents", "Tasks"),
    ...windowsUsers.map((user) => path.join("/mnt/c/Users", user, "Documents", "Tasks")),
  ].find(isFolder);
}

function describe(source) {
  return source === null || source === testData ? "test data" : source;
}

function isFolder(file) {
  return statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
}
