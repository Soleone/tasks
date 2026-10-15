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

export function exportAndroidTaskDocument(content: string, suggestedName: string): Promise<{ destinationPath: string; displayName: string }> {
  return invoke("export_task_document", { content, suggestedName });
}

export type AndroidCanonicalFile = {
  relativePath: string;
  content: string;
  modifiedAt: number | null;
};

export type AndroidCanonicalFileResult = {
  selected: boolean;
  folderUri: string | null;
  files: AndroidCanonicalFile[];
};

export function readAndroidCanonicalFiles(relativePaths?: string[]): Promise<AndroidCanonicalFileResult> {
  return invoke<AndroidCanonicalFileResult>("read_sync_files", relativePaths ? { relativePaths } : {});
}

export function writeAndroidCanonicalFiles(
  files: Array<{ relativePath: string; content: string | null; previousContent: string | null; modifiedAt: number | null }>,
  expectedFolderUri?: string,
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("write_sync_files", { files, expectedFolderUri: expectedFolderUri ?? null });
}
