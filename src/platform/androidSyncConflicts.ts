import type { AndroidCanonicalFile } from "./androidWorkspace";

export type AndroidSyncConflict = {
  id: number;
  canonicalPath: string;
  sourcePath: string;
  kind: "workspace" | "task" | "order";
  status: "unresolved";
  resolutionSupported: false;
};

const CONFLICT_FILE = /^(.*)\.sync-conflict-\d{8}-\d{6}-[^/]+\.json$/;
const TASK_PATH = /^tasks\/[A-Za-z0-9_-]+\.json$/;
const ORDER_PATH = /^order\/(?:root|[A-Za-z0-9_-]+)\.json$/;

function conflictKind(canonicalPath: string): AndroidSyncConflict["kind"] | null {
  if (canonicalPath === "workspace.json") return "workspace";
  if (TASK_PATH.test(canonicalPath)) return "task";
  if (ORDER_PATH.test(canonicalPath)) return "order";
  return null;
}

export function listAndroidSyncConflicts(files: AndroidCanonicalFile[]): AndroidSyncConflict[] {
  const candidates = files.flatMap((file) => {
    const match = CONFLICT_FILE.exec(file.relativePath);
    if (!match) return [];
    const canonicalPath = `${match[1]}.json`;
    const kind = conflictKind(canonicalPath);
    if (!kind) return [];
    return [{ canonicalPath, sourcePath: file.relativePath, kind }];
  });

  return candidates
    .sort((left, right) => left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0)
    .map((conflict, index) => ({
      id: index + 1,
      ...conflict,
      status: "unresolved",
      resolutionSupported: false,
    }));
}
