/** One of this client's own recorded operations; whether it can still be undone is the gateway's answer. */
export type V2UndoEntry = {
  operationId: string;
  key: string;
  affectedTaskIds: string[];
  createdTaskIds: string[];
  title: string;
  statusLike: boolean;
  wasActiveTaskId: string | null;
};
export type V2UndoStorage = Pick<Storage, "getItem" | "setItem">;
type StoredHistory = { version: 1; workspaces: { scope: string; entries: V2UndoEntry[] }[] };

export const V2_UNDO_HISTORY_LIMIT = 50;
const STORAGE_KEY = "tasks.v2UndoHistory";
const RETAINED_WORKSPACES = 10;

export function browserUndoStorage(): V2UndoStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function isEntry(value: unknown): value is V2UndoEntry {
  const ids = (list: unknown) => Array.isArray(list) && list.every(id => typeof id === "string" && id !== "");
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.operationId === "string" && entry.operationId !== "" && typeof entry.key === "string" && entry.key !== ""
    && ids(entry.affectedTaskIds) && ids(entry.createdTaskIds) && typeof entry.title === "string" && typeof entry.statusLike === "boolean"
    && (entry.wasActiveTaskId === null || typeof entry.wasActiveTaskId === "string");
}

/**
 * Client-local, bounded history of this client's own operation IDs for one confirmed
 * root/cache/profile and write context. It never decides eligibility: every undo still goes
 * through the gateway's preview and the locked executing request.
 */
export class V2UndoHistory {
  private memory: V2UndoEntry[] = [];

  constructor(private readonly scope: string, private readonly storage: V2UndoStorage | null) {}

  latest(): V2UndoEntry | null {
    return this.read().at(-1) ?? null;
  }

  push(entry: V2UndoEntry): void {
    this.write([...this.read().filter(existing => existing.operationId !== entry.operationId), entry].slice(-V2_UNDO_HISTORY_LIMIT));
  }

  remove(operationId: string): void {
    this.write(this.read().filter(entry => entry.operationId !== operationId));
  }

  // Storage is reread on every use so another tab of the same client cannot be overwritten with a stale copy.
  private read(): V2UndoEntry[] {
    const stored = this.stored();
    if (!stored) return this.memory;
    const entries = stored.workspaces.find(workspace => workspace.scope === this.scope)?.entries ?? [];
    this.memory = entries.filter(isEntry).slice(-V2_UNDO_HISTORY_LIMIT);
    return this.memory;
  }

  private write(entries: V2UndoEntry[]): void {
    this.memory = entries;
    if (!this.storage) return;
    const others = (this.stored()?.workspaces ?? []).filter(workspace => workspace.scope !== this.scope);
    const history: StoredHistory = { version: 1, workspaces: [{ scope: this.scope, entries }, ...others].slice(0, RETAINED_WORKSPACES) };
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(history)); }
    catch { /* Full or unavailable storage keeps this session's history in memory only. */ }
  }

  private stored(): StoredHistory | null {
    let value: unknown;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return this.storage ? { version: 1, workspaces: [] } : null;
      value = JSON.parse(raw);
    } catch { return null; }
    const history = value as StoredHistory;
    if (!value || typeof value !== "object" || history.version !== 1 || !Array.isArray(history.workspaces)) return { version: 1, workspaces: [] };
    return { version: 1, workspaces: history.workspaces.filter(workspace => workspace && typeof workspace.scope === "string" && Array.isArray(workspace.entries)) };
  }
}
