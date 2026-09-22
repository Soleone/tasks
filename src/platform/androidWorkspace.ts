import { invoke } from "@tauri-apps/api/core";

export type AndroidDirectorySelection = {
  uri: string;
  displayName: string | null;
  path: string | null;
};

export function pickAndroidSyncFolder(): Promise<AndroidDirectorySelection> {
  return invoke<AndroidDirectorySelection>("pick_sync_folder");
}

export function getAndroidSyncFolder(): Promise<AndroidDirectorySelection | null> {
  return invoke<AndroidDirectorySelection | null>("get_sync_folder");
}

export function clearAndroidSyncFolder(): Promise<void> {
  return invoke<void>("clear_sync_folder");
}

export type AndroidCanonicalFile = {
  relativePath: string;
  content: string;
  modifiedAt: number | null;
};

export type AndroidCanonicalFileResult = {
  selected: boolean;
  files: AndroidCanonicalFile[];
};

export function readAndroidCanonicalFiles(): Promise<AndroidCanonicalFileResult> {
  return invoke<AndroidCanonicalFileResult>("read_sync_files");
}

export function writeAndroidCanonicalFiles(files: Array<AndroidCanonicalFile & { previousContent: string | null }>): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("write_sync_files", { files });
}
