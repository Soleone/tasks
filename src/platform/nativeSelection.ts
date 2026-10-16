import { QUERY_COMMANDS } from "../backend/protocol";
import { STATUS_COMMANDS } from "../backend/taskStatus";

export const NATIVE_COMMANDS = [
  "activity.list",
  ...QUERY_COMMANDS,
  "task.create",
  "task.update",
  ...STATUS_COMMANDS,
  "task.status.undo",
  "workspace.archive",
  "workspace.restore",
  "workspace.recovery.resume",
].sort();

export type NativeSelection = { rootPath: string; databasePath: string; profilePath: string };

export function validateNativeSelection(selection: NativeSelection): void {
  for (const filename of [selection.rootPath, selection.databasePath, selection.profilePath]) {
    if (
      typeof filename !== "string" ||
      filename.includes("/") ||
      !/^[A-Za-z]:\\[^<>:"|?*]+$/.test(filename) ||
      Array.from(filename).some((character) => character.charCodeAt(0) < 32) ||
      filename
        .split("\\")
        .slice(1)
        .some(
          (component) =>
            !component ||
            component === "." ||
            component === ".." ||
            /[. ]$/.test(component) ||
            /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(
              component,
            ),
        )
    ) {
      throw new Error(
        "Native selection requires explicit canonical local drive-letter paths, not UNC, relative or control-containing paths.",
      );
    }
  }
  // SQLite, unlike Node's regular-file APIs, refused the long lock journal in the Windows creation proof.
  const lockJournal = `${selection.profilePath}\\com.soleone.tasks\\taskdb-v2\\roots\\${"0".repeat(64)}\\lock.db-journal`;
  if (
    [`${selection.databasePath}-journal`, lockJournal].some((filename) => filename.length > 259)
  ) {
    throw new Error(
      "The complete SQLite cache/lock journal path exceeds the proven Windows path boundary. Select shorter disposable paths before launch; never shorten uncertain work.",
    );
  }
}

export function nativeSidecarArgs(selection: NativeSelection): string[] {
  validateNativeSelection(selection);
  return [
    "--stdio",
    "--root",
    selection.rootPath,
    "--database",
    selection.databasePath,
    "--windows-task-proof",
    "--local-profile",
    selection.profilePath,
  ];
}

export function parseNativeSelection(value: unknown): NativeSelection {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "databasePath,profilePath,rootPath"
  )
    throw new Error("The explicit native selection is unavailable; no backend was launched.");
  const selection = value as NativeSelection;
  validateNativeSelection(selection);
  return Object.freeze({ ...selection });
}
