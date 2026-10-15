import { V2_QUERY_COMMANDS } from "../backend/protocol";
import { V2_STATUS_COMMANDS } from "../backend/taskStatus";

export const V2_NATIVE_COMMANDS = ["activity.list", ...V2_QUERY_COMMANDS, "task.create", "task.update", ...V2_STATUS_COMMANDS,
  "task.status.undo", "workspace.archive", "workspace.restore", "workspace.recovery.resume"].sort();

export type V2NativeSelection = { rootPath: string; databasePath: string; profilePath: string };

export function validateV2NativeSelection(selection: V2NativeSelection): void {
  for (const filename of [selection.rootPath, selection.databasePath, selection.profilePath]) {
    if (typeof filename !== "string" || filename.includes("/") || !/^[A-Za-z]:\\[^<>:"|?*]+$/.test(filename)
      || Array.from(filename).some(character => character.charCodeAt(0) < 32)
      || filename.split("\\").slice(1).some(component => !component || component === "." || component === ".." || /[. ]$/.test(component)
        || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(component))) {
      throw new Error("Native selection requires explicit canonical local drive-letter paths, not UNC, relative or control-containing paths.");
    }
  }
  // SQLite, unlike Node's regular-file APIs, refused the long lock journal in the Windows creation proof.
  const lockJournal = `${selection.profilePath}\\com.soleone.tasks\\taskdb-v2\\roots\\${"0".repeat(64)}\\lock.db-journal`;
  if ([`${selection.databasePath}-journal`, lockJournal].some(filename => filename.length > 259)) {
    throw new Error("The complete SQLite cache/lock journal path exceeds the proven Windows path boundary. Select shorter disposable paths before launch; never shorten uncertain work.");
  }
}

export function v2NativeSidecarArgs(selection: V2NativeSelection): string[] {
  validateV2NativeSelection(selection);
  return ["--stdio", "--v2-root", selection.rootPath, "--database", selection.databasePath, "--windows-task-proof", "--local-profile", selection.profilePath];
}

export function parseV2NativeSelection(value: unknown): V2NativeSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "databasePath,profilePath,rootPath") throw new Error("The explicit native selection is unavailable; no backend was launched.");
  const selection = value as V2NativeSelection;
  validateV2NativeSelection(selection);
  return Object.freeze({ ...selection });
}
