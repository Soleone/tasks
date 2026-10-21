import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { syncDirectory } from "./localDomain.js";

/**
 * A Tasks home holds everything one device keeps: `sync/` is the canonical task folder and the
 * only part a sync tool may see, `local/` holds caches, the writer lock and recovery evidence,
 * and `settings.json` holds this device's preferences.
 */
export type Home = {
  homePath: string;
  rootPath: string;
  localPath: string;
  settingsPath: string;
  undoPath: string;
};

export type HomeClient = "app" | "cli";

const SYNC = "sync";
const LOCAL = "local";
const SETTINGS = "settings.json";
// What an interrupted creation can leave behind; anything else makes the folder someone else's.
const CREATION_ENTRIES = new Set([SYNC, LOCAL, SETTINGS]);

function homeAt(homePath: string): Home {
  return {
    homePath,
    rootPath: path.join(homePath, SYNC),
    localPath: path.join(homePath, LOCAL),
    settingsPath: path.join(homePath, SETTINGS),
    undoPath: path.join(homePath, LOCAL, "undo.json"),
  };
}

export function homeCache(home: Home, client: HomeClient): string {
  return path.join(home.localPath, `${client}.db`);
}

function isDirectory(directory: string): boolean {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  return stat !== undefined && stat.isDirectory() && !stat.isSymbolicLink();
}

/** The home whose `sync/` this root is, or undefined for old folders and other bare roots. */
export function homeOfRoot(rootPath: string): string | undefined {
  const homePath = path.dirname(rootPath);
  return path.basename(rootPath) === SYNC && isDirectory(path.join(homePath, LOCAL))
    ? homePath
    : undefined;
}

function refuse(code: string, message: string): never {
  throw new CommandError(code, message);
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(
    process.platform === "win32" ? parent.toLowerCase() : parent,
    process.platform === "win32" ? child.toLowerCase() : child,
  );
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Refuses places where live databases and locks would be copied by a sync tool or lost. */
function refuseUnsafeLocation(homePath: string): void {
  for (let directory = homePath; ; directory = path.dirname(directory)) {
    if (lstatSync(path.join(directory, ".stfolder"), { throwIfNoEntry: false }))
      refuse(
        "HOME_IN_SYNC_FOLDER",
        `${directory} is a Syncthing folder. Put the Tasks home outside it and add only its sync folder to Syncthing.`,
      );
    if (directory !== homePath && homeOfRoot(path.join(directory, SYNC)))
      refuse("HOME_NESTED", `${homePath} is inside the Tasks home ${directory}.`);
    if (path.dirname(directory) === directory) break;
  }
  if (process.platform === "win32") {
    if (homePath.startsWith("\\\\"))
      refuse(
        "HOME_UNSUPPORTED_DRIVE",
        "A Tasks home must be on a local drive, not a network share.",
      );
    for (const variable of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
      const cloud = process.env[variable];
      if (cloud && isWithin(homePath, cloud))
        refuse(
          "HOME_IN_SYNC_FOLDER",
          `${homePath} is inside OneDrive, which would sync its live database. Choose a folder outside OneDrive.`,
        );
    }
  }
  if (process.platform === "android" && !isWithin(homePath, "/storage/emulated/0"))
    refuse("HOME_UNSUPPORTED_DRIVE", "A Tasks home must be in the phone's shared storage.");
}

function refuseTaskFolders(homePath: string): void {
  if (lstatSync(path.join(homePath, "workspace.json"), { throwIfNoEntry: false }))
    refuse(
      "OLD_TASK_FOLDER",
      `${homePath} is a task folder from before Tasks homes. Choose or create a separate home for it.`,
    );
  const name = path.basename(homePath);
  if ((name === SYNC || name === LOCAL) && homeOfRoot(path.join(path.dirname(homePath), SYNC)))
    refuse("HOME_NESTED", `${homePath} is part of a Tasks home. Choose ${path.dirname(homePath)}.`);
}

/** Resolves an existing home to its one canonical spelling, so every caller shares its lock. */
export function openHome(selected: string): Home {
  let homePath: string;
  try {
    homePath = realpathSync.native(path.resolve(selected));
  } catch {
    refuse(
      "HOME_MISSING",
      `No Tasks home at ${selected}. Reconnect the drive or choose another home.`,
    );
  }
  refuseTaskFolders(homePath);
  const home = homeAt(homePath);
  if (!isDirectory(home.rootPath) || !isDirectory(home.localPath))
    refuse("NOT_A_HOME", `${homePath} is not a Tasks home: it needs a sync and a local folder.`);
  refuseUnsafeLocation(homePath);
  return home;
}

/**
 * Creates a home's folders, or finishes an interrupted creation. The parent must exist, and a
 * folder with anything but a home's own entries in it is never taken over.
 */
export function createHome(selected: string): Home {
  const requested = path.resolve(selected);
  let parent: string;
  try {
    parent = realpathSync.native(path.dirname(requested));
  } catch {
    refuse("HOME_MISSING", `${path.dirname(requested)} doesn't exist.`);
  }
  const homePath = path.join(parent, path.basename(requested));
  const existing = lstatSync(homePath, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    refuse("HOME_CONFLICT", `${homePath} exists and is not a folder.`);
  const canonical = existing ? realpathSync.native(homePath) : homePath;
  refuseTaskFolders(canonical);
  refuseUnsafeLocation(canonical);
  if (existing) {
    if (readdirSync(canonical).some((name) => !CREATION_ENTRIES.has(name)))
      refuse("HOME_CONFLICT", `${canonical} isn't empty. Choose an empty or new folder.`);
  } else {
    mkdirSync(canonical, { mode: 0o700 });
    syncDirectory(parent);
  }
  const home = homeAt(canonical);
  for (const directory of [home.localPath, home.rootPath]) {
    if (!isDirectory(directory)) mkdirSync(directory, { mode: 0o700 });
  }
  syncDirectory(home.homePath);
  return home;
}
