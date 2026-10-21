/** One of this client's own recorded operations; reversal eligibility is the gateway's answer. */
export type UndoEntry = {
  operationId: string;
  key: string;
  affectedTaskIds: string[];
  createdTaskIds: string[];
  title: string;
  statusLike: boolean;
  wasActiveTaskId: string | null;
};
export type UndoStorage = Pick<Storage, "getItem" | "setItem">;
type HistoryStacks = { entries: UndoEntry[]; redoEntries: UndoEntry[] };
type StoredHistory = {
  version: 1;
  workspaces: { scope: string; entries: UndoEntry[]; redoEntries?: UndoEntry[] }[];
};

/** @public Tested from scripts/ through an esbuild bundle, which knip can't trace. */
export const UNDO_HISTORY_LIMIT = 50;
const STORAGE_KEY = "tasks.v2UndoHistory";
const RETAINED_WORKSPACES = 10;

export function browserUndoStorage(): UndoStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is UndoEntry {
  const ids = (list: unknown) =>
    Array.isArray(list) && list.every((id) => typeof id === "string" && id !== "");
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.operationId === "string" &&
    entry.operationId !== "" &&
    typeof entry.key === "string" &&
    entry.key !== "" &&
    ids(entry.affectedTaskIds) &&
    ids(entry.createdTaskIds) &&
    typeof entry.title === "string" &&
    typeof entry.statusLike === "boolean" &&
    (entry.wasActiveTaskId === null || typeof entry.wasActiveTaskId === "string")
  );
}

/**
 * Client-local, bounded history of this client's own operation IDs for one confirmed
 * root/cache/profile and write context. It never decides eligibility: every reversal goes
 * through the gateway's preview and the locked executing request.
 */
export class UndoHistory {
  private memory: HistoryStacks = { entries: [], redoEntries: [] };
  private storageFailed = false;

  constructor(
    private readonly scope: string,
    private readonly storage: UndoStorage | null,
  ) {}

  latest(): UndoEntry | null {
    return this.read().entries.at(-1) ?? null;
  }

  latestRedo(): UndoEntry | null {
    return this.read().redoEntries.at(-1) ?? null;
  }

  push(entry: UndoEntry): void {
    const { entries } = this.read();
    if (entries.some((existing) => existing.operationId === entry.operationId)) return;
    this.write({ entries: [...entries, entry].slice(-UNDO_HISTORY_LIMIT), redoEntries: [] });
  }

  completeUndo(operationId: string, entry: UndoEntry): void {
    const history = this.read();
    if (!history.entries.some((existing) => existing.operationId === operationId)) return;
    this.write({
      entries: history.entries.filter((existing) => existing.operationId !== operationId),
      redoEntries: [...history.redoEntries, entry],
    });
  }

  completeRedo(operationId: string, entry: UndoEntry): void {
    const history = this.read();
    if (!history.redoEntries.some((existing) => existing.operationId === operationId)) return;
    this.write({
      entries: [...history.entries, entry],
      redoEntries: history.redoEntries.filter((existing) => existing.operationId !== operationId),
    });
  }

  remove(operationId: string): void {
    const history = this.read();
    this.write({
      ...history,
      entries: history.entries.filter((entry) => entry.operationId !== operationId),
    });
  }

  removeRedo(operationId: string): void {
    const history = this.read();
    this.write({
      ...history,
      redoEntries: history.redoEntries.filter((entry) => entry.operationId !== operationId),
    });
  }

  // Storage is reread on every use so another tab of the same client cannot be overwritten with a stale copy.
  private read(): HistoryStacks {
    const stored = this.stored();
    if (!stored) return this.memory;
    const history = stored.workspaces.find((workspace) => workspace.scope === this.scope);
    const entries = (history?.entries ?? []).filter(isEntry).slice(-UNDO_HISTORY_LIMIT);
    const remaining = UNDO_HISTORY_LIMIT - entries.length;
    this.memory = {
      entries,
      redoEntries:
        remaining > 0 ? (history?.redoEntries ?? []).filter(isEntry).slice(-remaining) : [],
    };
    return this.memory;
  }

  private write(stacks: HistoryStacks): void {
    this.memory = stacks;
    if (!this.storage || this.storageFailed) return;
    const others = (this.stored()?.workspaces ?? []).filter(
      (workspace) => workspace.scope !== this.scope,
    );
    const history: StoredHistory = {
      version: 1,
      workspaces: [{ scope: this.scope, ...stacks }, ...others].slice(0, RETAINED_WORKSPACES),
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Do not reread an older persisted copy over this session's confirmed history.
      this.storageFailed = true;
    }
  }

  private stored(): StoredHistory | null {
    if (this.storageFailed) return null;
    let value: unknown;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined)
        return this.storage ? { version: 1, workspaces: [] } : null;
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    const history = value as StoredHistory;
    if (
      !value ||
      typeof value !== "object" ||
      history.version !== 1 ||
      !Array.isArray(history.workspaces)
    )
      return { version: 1, workspaces: [] };
    return {
      version: 1,
      workspaces: history.workspaces.filter(
        (workspace) =>
          workspace &&
          typeof workspace.scope === "string" &&
          Array.isArray(workspace.entries) &&
          (workspace.redoEntries === undefined || Array.isArray(workspace.redoEntries)),
      ),
    };
  }
}
