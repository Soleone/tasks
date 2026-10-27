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
 * before the installer replaces the backend, and Windows restarts Tasks once it is done.
 */
export async function installUpdate(update: Update): Promise<void> {
  await update.download();
  await closeHome("Updating Tasks; it restarts in a moment.");
  // The backend is already closed, so a failed handoff reopens the home.
  await update.install().catch((error: unknown) => {
    window.location.reload();
    throw error;
  });
}
