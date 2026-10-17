import os from "node:os";
import path from "node:path";
import { APP_DATA_DIRECTORY } from "./branding.js";

type Environment = Record<string, string | undefined>;

type Platform = "darwin" | "linux" | "win32";

export function getDataDirectory(
  environment: Environment = process.env,
  platform: Platform = process.platform as Platform,
  homeDirectory = os.homedir(),
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;

  if (platform === "win32") {
    return pathApi.join(
      environment.APPDATA ?? pathApi.join(homeDirectory, "AppData", "Roaming"),
      APP_DATA_DIRECTORY,
    );
  }

  if (platform === "darwin") {
    return pathApi.join(homeDirectory, "Library", "Application Support", APP_DATA_DIRECTORY);
  }

  return pathApi.join(
    environment.XDG_DATA_HOME ?? pathApi.join(homeDirectory, ".local", "share"),
    APP_DATA_DIRECTORY,
  );
}
