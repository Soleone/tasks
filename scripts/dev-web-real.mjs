import {
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  realpathSync,
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
 * Keeps one copy of the owner's real task folder for `pnpm dev:web:real`, as the sync folder of
 * a Tasks home in local app data, outside any Syncthing folder, so dev edits never reach the
 * real tasks. `--refresh` asks again and replaces the copy.
 */
export async function realSnapshot(refresh) {
  const home = snapshotHome();
  const configFile = path.join(home, "dev-web-real.json");
  const snapshot = path.join(home, "dev-web-real");
  // A saved null means the test data, so the choice survives the worktree it was made in.
  let choice = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8")).source
    : undefined;
  if (choice !== undefined) validateSource(choice ?? testData, snapshot, configFile);
  if (choice === undefined || refresh) {
    choice = await askSource(choice);
    validateSource(choice ?? testData, snapshot, configFile);
    mkdirSync(home, { recursive: true });
    writeFileSync(configFile, `${JSON.stringify({ source: choice }, null, 2)}\n`);
  }
  const source = choice ?? testData;
  const root = path.join(snapshot, "sync");
  if (refresh || !existsSync(root)) {
    rmSync(snapshot, { recursive: true, force: true });
    cpSync(source, root, { recursive: true });
    mkdirSync(path.join(snapshot, "local"));
    process.stdout.write(`[dev:web] copied ${describe(source)} to ${root}\n`);
  }
  return { home: snapshot };
}

function validateSource(source, snapshot, configFile) {
  if (!isFolder(source)) throw new Error(`${source} is not a folder; fix or delete ${configFile}`);
  const sourcePath = realpathSync(source);
  const snapshotPath = physicalPath(snapshot);
  if (contains(sourcePath, snapshotPath) || contains(snapshotPath, sourcePath)) {
    throw new Error(`Source and development home overlap: ${source} and ${snapshot}`);
  }
}

// Resolve missing destinations through their existing ancestors, including symlinks.
function physicalPath(file) {
  if (lstatSync(file, { throwIfNoEntry: false })) return realpathSync(file);
  return path.join(physicalPath(path.dirname(file)), path.basename(file));
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
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
      const source = path.resolve(answer.trim().replace(/^~(?=$|[\\/])/, homedir()));
      if (isFolder(source)) return source;
      process.stdout.write(`${source} is not a folder.\n`);
    }
  } finally {
    prompt.close();
  }
}

/** $DATA/apps/tasks where the owner's shell sets DATA, else the OS's local (never roaming) app data. */
function snapshotHome() {
  if (process.env.DATA) return path.join(process.env.DATA, "apps", "tasks");
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
      "tasks-dev",
    );
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "tasks-dev");
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
    "tasks-dev",
  );
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

/** A folder this user may not read, such as another Windows account's, counts as missing. */
function isFolder(file) {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
