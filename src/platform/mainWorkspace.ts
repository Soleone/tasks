import { taskView } from "@/components/taskView";
import type { TaskReorderPlacement, TaskReorderTask, TaskTransitionItem } from "@/backend/protocol";
import { WorkspaceReader } from "./workspaceReader";
import {
  AnsweredRefusal,
  EditorClient,
  EditorError,
  type EditorMode,
  type EditResult,
  type InlineDraft,
  type LevelChange,
  type OrderResult,
  type PreparedEdit,
  type RelationshipAction,
  type StatusAction,
  type UndoResult,
} from "./editorClient";
import type { HomeDocuments } from "./homeDocuments";
import { browserUndoStorage, UndoHistory, type UndoStorage } from "./undoHistory";

// Gateway envelope checks precede writer dispatch. Writer admission codes are not pre-effect.
const PRE_EFFECT_REFUSALS = new Set(["INVALID_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_COMMAND"]);

function classificationEntries(value: unknown): { slug: string; taskCount: number }[] {
  if (!Array.isArray(value))
    throw new Error("The workspace returned invalid classification entries.");
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.slug !== "string" ||
      !/^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/.test(entry.slug) ||
      !Number.isSafeInteger(entry.taskCount) ||
      entry.taskCount < 0
    )
      throw new Error("The workspace returned invalid classification entries.");
    return { slug: entry.slug, taskCount: entry.taskCount };
  });
}

export type UnresolvedTaskRequest = {
  prepared: PreparedEdit<EditResult | OrderResult | UndoResult>;
  error: string;
  retry: () => Promise<void>;
  preserveForReconciliation: () => void;
};

/** One explicitly selected workspace for the established UI. */
export class MainWorkspace {
  private writing = false;
  private reconciliationRequired = false;
  private unresolved: UnresolvedTaskRequest | null = null;
  private listeners = new Set<() => void>();
  private history: Promise<UndoHistory> | null = null;

  constructor(
    readonly reader: WorkspaceReader,
    readonly editor: EditorClient,
    private readonly undoStorage: UndoStorage | null = browserUndoStorage(),
    /** The home's own documents, when the workspace was opened through a Tasks home. */
    readonly documents: HomeDocuments | null = null,
  ) {
    if (
      reader.selection.rootPath !== editor.selection.rootPath ||
      reader.selection.databasePath !== editor.selection.databasePath
    ) {
      throw new Error("The list and editor must share the same explicitly selected workspace.");
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getUnresolved = (): UnresolvedTaskRequest | null => this.unresolved;
  /** Only the Linux route advertises parent/dependency writers; the native route withholds them. */
  get supportsRelationships(): boolean {
    return this.editor.selection.writeCommands.includes("task.move");
  }
  /** Only the Linux route advertises manual reorder. */
  get supportsOrdering(): boolean {
    return this.editor.selection.writeCommands.includes("task.reorder");
  }
  get supportsOperationRedo(): boolean {
    return this.editor.selection.writeCommands.includes("operation.redo");
  }
  hasWriteInProgress = (): boolean => this.writing;

  assertCanClose(): void {
    if (this.writing || this.unresolved || this.reconciliationRequired)
      throw new EditorError(
        "WRITE_IN_PROGRESS",
        "Finish or reconcile the current task change first.",
      );
  }

  async tasks(args: Record<string, unknown>) {
    // The UI's "desc" means most pressing first (P0, soonest due); the engine sorts the value.
    const direction =
      (args.sort === "priority" || args.sort === "due") && args.direction !== undefined
        ? args.direction === "desc"
          ? "asc"
          : "desc"
        : args.direction;
    // A list refuses a root that isn't ready, so readiness costs a round trip only to explain a failure.
    const page = await this.reader
      .tasks({ ...args, ...(direction !== undefined ? { direction } : {}) })
      .catch(async (error: unknown) => {
        await this.ready();
        throw error;
      });
    return {
      ...page,
      tasks: page.tasks.map(taskView),
      contextTasks: page.contextTasks.map(taskView),
    };
  }

  async categories() {
    const result = await this.reader.query("category.list");
    return classificationEntries(result.categories);
  }

  async tags() {
    const result = await this.reader.query("tag.list");
    return classificationEntries(result.tags);
  }

  async revision() {
    return (await this.ready()).workspaceRevision;
  }

  async save(draft: InlineDraft, key: string, id?: string, version?: number) {
    return this.write(async () =>
      this.editor.prepareInline(await this.baseline(id, version), draft, key),
    );
  }

  async createChild(parentId: string, draft: InlineDraft, key: string) {
    return this.write(async () =>
      this.editor.prepareInline(await this.baseline(), draft, key, parentId),
    );
  }

  async relationship(
    command: RelationshipAction,
    id: string,
    version: number,
    target: string | null,
    key: string,
  ) {
    return this.write(async () => {
      const baseline = await this.baseline(id, version, "relationship");
      const prepared = this.editor.prepareRelationship(baseline, command, target, key);
      await prepared.preview();
      return prepared;
    });
  }

  /** Selected siblings in current order; the gateway resolves placement against the complete scope. */
  async reorder(tasks: readonly TaskReorderTask[], placement: TaskReorderPlacement, key: string) {
    const result = await this.run(async () => {
      const baseline = await this.baseline(tasks[0]?.id, tasks[0]?.expectedVersion, "order");
      const prepared = this.editor.prepareReorder(baseline, tasks, placement, key);
      await prepared.preview();
      return prepared;
    });
    return { ...result, tasks: result.tasks.map(taskView) };
  }

  /** All-or-refuse status batch; like undo, the gateway's non-consuming preview refuses an invalid batch before the locked request is sent. */
  async transitionMany(tasks: readonly TaskTransitionItem[], key: string) {
    const result = await this.run(async () => {
      const prepared = this.editor.prepareTransitionMany(
        await this.editor.begin(undefined, "batch"),
        tasks,
        key,
      );
      await prepared.preview();
      return prepared;
    });
    return { ...result, tasks: result.tasks.map(taskView) };
  }

  /** This client's history for the confirmed root/cache/profile and current write context. */
  undoHistory(): Promise<UndoHistory> {
    if (!this.history) {
      const { rootPath, databasePath, profilePath } = this.editor.selection;
      this.history = this.editor
        .begin(undefined, "operation")
        .then(
          (baseline) =>
            new UndoHistory(
              JSON.stringify([rootPath, databasePath, profilePath, baseline.writeContext]),
              this.undoStorage,
            ),
        );
      this.history.catch(() => {
        this.history = null;
      });
    }
    return this.history;
  }

  /** The gateway's own non-consuming preview refuses ineligible history before the locked request is sent. */
  async undo(operationId: string, key: string) {
    const result = await this.run(async () => {
      const prepared = this.editor.prepareOperationUndo(
        await this.editor.begin(undefined, "operation"),
        operationId,
        key,
      );
      await prepared.preview();
      return prepared;
    });
    return { ...result, tasks: result.tasks.map(taskView) };
  }

  async redo(operationId: string, key: string) {
    const result = await this.run(async () => {
      const prepared = this.editor.prepareOperationRedo(
        await this.editor.begin(undefined, "operation"),
        operationId,
        key,
      );
      await prepared.preview();
      return prepared;
    });
    return { ...result, tasks: result.tasks.map(taskView) };
  }

  async level(id: string, version: number, change: LevelChange, key: string) {
    return this.write(async () =>
      this.editor.prepareLevel(await this.baseline(id, version), change, key),
    );
  }

  async status(command: StatusAction, id: string, version: number, key: string) {
    return this.write(async () =>
      this.editor.prepareStatus(await this.baseline(id, version, "status"), command, key),
    );
  }

  private async ready() {
    const workspace = await this.reader.workspaceInfo();
    if (workspace.state !== "ready")
      throw new EditorError(
        workspace.state === "recovery_pending" ? "RECOVERY_PENDING" : "WORKSPACE_UNAVAILABLE",
        "Task browsing is paused. Preserve the selected paths and use explicit recovery; nothing was repaired automatically.",
      );
    return workspace;
  }

  private async baseline(id?: string, version?: number, mode: EditorMode = "content") {
    const baseline = await this.editor.begin(id, mode);
    if (id !== undefined && baseline.task?.version !== version)
      throw new EditorError(
        "STALE_TASK_VERSION",
        "This task changed elsewhere. Your draft was not sent; reopen it before saving.",
      );
    return baseline;
  }

  private publishUnresolved(request: UnresolvedTaskRequest | null): void {
    this.unresolved = request;
    for (const listener of this.listeners) listener();
  }

  private async write(prepare: () => Promise<PreparedEdit>) {
    const result = await this.run(prepare);
    return { ...result, task: taskView(result.task) };
  }

  private async run<R extends EditResult | OrderResult | UndoResult>(
    prepare: () => Promise<PreparedEdit<R>>,
  ): Promise<R> {
    if (this.reconciliationRequired)
      throw new EditorError(
        "MANUAL_RECONCILIATION",
        "Writes are paused until you reconcile the preserved request and reopen this workspace.",
      );
    if (this.writing)
      throw new EditorError(
        "WRITE_IN_PROGRESS",
        "Finish the current task change before starting another.",
      );
    this.writing = true;
    try {
      const prepared = await prepare();
      return await new Promise<R>((resolve, reject) => {
        let inFlight = false;
        let uncertainAttempt = false;
        const retry = async (): Promise<void> => {
          if (inFlight) return;
          inFlight = true;
          try {
            const result = await prepared.execute();
            this.publishUnresolved(null);
            resolve(result);
          } catch (error) {
            if (
              !uncertainAttempt &&
              error instanceof AnsweredRefusal &&
              PRE_EFFECT_REFUSALS.has(error.code)
            ) {
              this.publishUnresolved(null);
              reject(error);
              return;
            }
            // A later refusal cannot prove that an earlier attempt had no effect.
            uncertainAttempt = true;
            this.publishUnresolved({
              prepared,
              error: error instanceof Error ? error.message : String(error),
              retry,
              preserveForReconciliation: () => {
                this.reconciliationRequired = true;
                this.publishUnresolved(null);
                reject(
                  new EditorError(
                    "MANUAL_RECONCILIATION",
                    "The original request still needs external reconciliation. Do not submit a replacement.",
                  ),
                );
              },
            });
          } finally {
            inFlight = false;
          }
        };
        void retry();
      });
    } finally {
      this.writing = false;
    }
  }
}
