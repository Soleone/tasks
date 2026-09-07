import os from "node:os";
import path from "node:path";

export const APP_NAME = "com.soleone.tasks";

type Environment = Record<string, string | undefined>;

type Platform = "darwin" | "linux" | "win32";

export function getDataDirectory(
  environment: Environment = process.env,
  platform: Platform = process.platform as Platform,
  homeDirectory = os.homedir(),
): string {
  if (platform === "win32") {
    return path.join(environment.APPDATA ?? path.join(homeDirectory, "AppData", "Roaming"), APP_NAME);
  }

  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", APP_NAME);
  }

  return path.join(environment.XDG_DATA_HOME ?? path.join(homeDirectory, ".local", "share"), APP_NAME);
}

export function getDatabasePath(
  environment: Environment = process.env,
  platform: Platform = process.platform as Platform,
  homeDirectory = os.homedir(),
): string {
  return path.join(getDataDirectory(environment, platform, homeDirectory), "tasks.db");
}
