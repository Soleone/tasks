import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { closeHome } from "./backendClient";
import { isDesktopApp } from "./runtime";

/**
 * The newer release that GitHub offers this desktop app, or null when it is current, offline,
 * a development build or not on desktop. A failed check stays silent.
 */
export async function availableUpdate(): Promise<Update | null> {
  if (import.meta.env.DEV || !isDesktopApp()) return null;
  return check().catch(() => null);
}

/**
 * Downloads first, so a failed download leaves the home open. Then it saves and closes the home
 * before the update replaces the backend, and Tasks restarts once it is done.
 */
export async function installUpdate(update: Update): Promise<void> {
  await update.download();
  await closeHome("Updating Tasks; it restarts in a moment.");
  // The backend is already closed, so a failed handoff reopens the home.
  await update.install().catch((error: unknown) => {
    window.location.reload();
    throw error;
  });
  // Windows never gets here: its installer quits Tasks and starts it again. A Linux AppImage is
  // swapped in place, so the app restarts itself.
  await relaunch();
}
