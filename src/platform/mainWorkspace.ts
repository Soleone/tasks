import { taskView } from "@/components/taskView";
import type { TaskPriority } from "@/backend/protocol";
import { V2WorkspaceReader } from "./v2BackendClient";
import { V2EditorClient, V2EditorError, type V2EditResult, type V2PreparedEdit, type V2StatusAction } from "./v2EditorClient";

function classificationEntries(value: unknown): { slug: string; taskCount: number }[] {
  if (!Array.isArray(value)) throw new Error("The workspace returned invalid classification entries.");
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || typeof entry.slug !== "string" || !/^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/.test(entry.slug)
      || !Number.isSafeInteger(entry.taskCount) || entry.taskCount < 0) throw new Error("The workspace returned invalid classification entries.");
    return { slug: entry.slug, taskCount: entry.taskCount };
  });
}

export type UnresolvedTaskRequest = {
  prepared: V2PreparedEdit;
  error: string;
  retry: () => Promise<void>;
  preserveForReconciliation: () => void;
};

/** One explicitly selected workspace for the established UI, with no legacy transport fallback. */
export class MainWorkspace {
  private writing = false;
  private reconciliationRequired = false;
  private unresolved: UnresolvedTaskRequest | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly reader: V2WorkspaceReader, readonly editor: V2EditorClient) {
    if (reader.selection.rootPath !== editor.selection.rootPath || reader.selection.databasePath !== editor.selection.databasePath) {
      throw new Error("The list and editor must share the same explicitly selected workspace.");
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getUnresolved = (): UnresolvedTaskRequest | null => this.unresolved;
  hasWriteInProgress = (): boolean => this.writing;

  async tasks(args: Record<string, unknown>) {
    await this.ready();
    const page = await this.reader.tasks(args);
    return { ...page, tasks: page.tasks.map(taskView), contextTasks: page.contextTasks.map(taskView) };
  }

  async categories() {
    const result = await this.reader.query("category.list");
    return classificationEntries(result.categories);
  }

  async tags() {
    const result = await this.reader.query("tag.list");
    return classificationEntries(result.tags);
  }

  async info() {
    const workspace = await this.ready();
    const all = await this.reader.tasks({ limit: 1 });
    const canceled = await this.reader.tasks({ status: "canceled", limit: 1 });
    return { databasePath: this.reader.selection.databasePath, taskCount: all.total,
      canceledTaskCount: canceled.total, workspaceRevision: workspace.workspaceRevision };
  }

  async save(text: string, description: string, priority: TaskPriority | undefined, key: string, id?: string, version?: number) {
    return this.write(async () => {
      const baseline = await this.baseline(id, version);
      return this.editor.prepareInline(baseline, text, description, priority ?? baseline.task?.priority ?? 2, key);
    });
  }

  async priority(id: string, version: number, priority: TaskPriority, key: string) {
    return this.write(async () => this.editor.preparePriority(await this.baseline(id, version), priority, key));
  }

  async status(command: V2StatusAction, id: string, version: number, key: string) {
    return this.write(async () => this.editor.prepareStatus(await this.baseline(id, version, "status"), command, key));
  }

  private async ready() {
    const workspace = await this.reader.workspaceInfo();
    if (workspace.state !== "ready") throw new V2EditorError(workspace.state === "recovery_pending" ? "RECOVERY_PENDING" : "WORKSPACE_UNAVAILABLE", "Task browsing is paused. Preserve the selected paths and use explicit recovery; nothing was repaired automatically.");
    return workspace;
  }

  private async baseline(id?: string, version?: number, mode: "content" | "status" = "content") {
    const baseline = await this.editor.begin(id, mode);
    if (id !== undefined && baseline.task?.version !== version) throw new V2EditorError("STALE_TASK_VERSION", "This task changed elsewhere. Your draft was not sent; reopen it before saving.");
    return baseline;
  }

  private publishUnresolved(request: UnresolvedTaskRequest | null): void {
    this.unresolved = request;
    for (const listener of this.listeners) listener();
  }

  private async write(prepare: () => Promise<V2PreparedEdit>) {
    if (this.reconciliationRequired) throw new V2EditorError("MANUAL_RECONCILIATION", "Writes are paused until you reconcile the preserved request and reopen this workspace.");
    if (this.writing) throw new V2EditorError("WRITE_IN_PROGRESS", "Finish the current task change before starting another.");
    this.writing = true;
    try {
      const prepared = await prepare();
      const result = await new Promise<V2EditResult>((resolve, reject) => {
        let inFlight = false;
        const retry = async (): Promise<void> => {
          if (inFlight) return;
          inFlight = true;
          try {
            const result = await prepared.execute();
            this.publishUnresolved(null);
            resolve(result);
          } catch (error) {
            this.publishUnresolved({ prepared, error: error instanceof Error ? error.message : String(error), retry,
              preserveForReconciliation: () => {
                this.reconciliationRequired = true;
                this.publishUnresolved(null);
                reject(new V2EditorError("MANUAL_RECONCILIATION", "The original request still needs external reconciliation. Do not submit a replacement."));
              } });
          } finally { inFlight = false; }
        };
        void retry();
      });
      return { ...result, task: taskView(result.task) };
    } finally { this.writing = false; }
  }
}
