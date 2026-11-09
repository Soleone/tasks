import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandError } from "./errors.js";

// The identifier in src-tauri/tauri.conf.json names the app's config folder.
const APP_IDENTIFIER = "com.soleone.tasks";

// Tauri's app config folder on each desktop platform.
function appConfigFolder(): string | undefined {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return base && path.join(base, APP_IDENTIFIER);
}

/**
 * The home the desktop app opens on this device, from the pointer it keeps in its config folder,
 * or undefined before the app has chosen one. The CLI works there when no home is given.
 */
export function appHome(): string | undefined {
  const folder = appConfigFolder();
  if (folder === undefined) return undefined;
  const pointer = path.join(folder, "home.json");
  let text: string;
  try {
    text = readFileSync(pointer, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let home: unknown;
  try {
    home = (JSON.parse(text) as { home?: unknown }).home;
  } catch {}
  if (typeof home !== "string" || !home.trim())
    throw new CommandError(
      "INVALID_STORAGE",
      `${pointer} is damaged; open the Tasks app to choose the home again, or pass --home PATH`,
    );
  return home;
}
