import { taskView } from "@/components/taskView";
import type { TaskReorderPlacement, TaskReorderTask, TaskTransitionItem } from "@/backend/protocol";
import type { TaskPriority } from "@/backend/taskModel";
import { parseTaskProjection } from "@/backend/taskResults";
import { compareTasks } from "@/backend/taskModel";
import { WorkspaceReader } from "./workspaceReader";
import {
  AnsweredRefusal,
  EditorClient,
  EditorError,
  type EditorMode,
  type EditResult,
  type InlineDraft,
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
  /** Capabilities come from the selected shared backend, not the shell platform. */
  get supportsOperationUndo(): boolean {
    return this.editor.selection.writeCommands.includes("operation.undo");
  }
  get supportsOperationRedo(): boolean {
    return this.editor.selection.writeCommands.includes("operation.redo");
  }
  /** Only the Linux route advertises status batches. */
  get supportsStatusBatch(): boolean {
    return this.editor.selection.writeCommands.includes("task.transitionMany");
  }
  hasWriteInProgress = (): boolean => this.writing;

  assertHomeSwitchAllowed(): void {
    if (this.writing || this.unresolved || this.reconciliationRequired)
      throw new EditorError(
        "WRITE_IN_PROGRESS",
        "Finish or reconcile the current task change before opening another home.",
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

  async info() {
    const workspace = await this.ready();
    const all = await this.reader.tasks({ limit: 1 });
    const canceled = await this.reader.tasks({ status: "canceled", limit: 1 });
    return {
      databasePath: this.reader.selection.databasePath,
      taskCount: all.total,
      canceledTaskCount: canceled.total,
      workspaceRevision: workspace.workspaceRevision,
    };
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
      if (target !== null && command !== "task.dependency.remove")
        await this.assertRelationshipTarget(command, id, target);
      return this.editor.prepareRelationship(baseline, command, target, key);
    });
  }

  /** Selected siblings in current order; the gateway resolves placement against the complete scope. */
  async reorder(tasks: readonly TaskReorderTask[], placement: TaskReorderPlacement, key: string) {
    const result = await this.run(async () => {
      const baseline = await this.baseline(tasks[0]?.id, tasks[0]?.expectedVersion, "order");
      await this.assertReorderScope(tasks, placement);
      return this.editor.prepareReorder(baseline, tasks, placement, key);
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
    if (!this.supportsOperationUndo)
      return Promise.reject(
        new EditorError(
          "UNSUPPORTED_COMMAND",
          "Undo is limited to status changes in this selected workspace.",
        ),
      );
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

  async priority(id: string, version: number, priority: TaskPriority, key: string) {
    return this.write(async () =>
      this.editor.preparePriority(await this.baseline(id, version), priority, key),
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

  // Writer refusals keep the original request like an uncertain reply, so reachable graph mistakes are refused before sending.
  private async assertRelationshipTarget(
    command: RelationshipAction,
    id: string,
    targetId: string,
  ): Promise<void> {
    const move = command === "task.move";
    const seen = new Set<string>();
    const pending = [targetId];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === id)
        throw new EditorError(
          move ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE",
          move
            ? "A task cannot move under itself or one of its subtasks. Nothing was sent."
            : "This dependency would create a cycle. Nothing was sent.",
        );
      if (seen.has(current)) continue;
      seen.add(current);
      const task = parseTaskProjection((await this.reader.query("task.get", { id: current })).task);
      if (current === targetId && task.status === "canceled")
        throw new EditorError(
          move ? "INVALID_PARENT" : "INVALID_DEPENDENCY",
          "Reopen the canceled task before linking to it. Nothing was sent.",
        );
      pending.push(
        ...(move ? (task.parentId === null ? [] : [task.parentId]) : task.dependencyIds),
      );
    }
  }

  // Like relationship edits, reachable ordering refusals are checked before sending so they cannot lock the request.
  private async assertReorderScope(
    tasks: readonly TaskReorderTask[],
    placement: TaskReorderPlacement,
  ): Promise<void> {
    const changed = () =>
      new EditorError(
        "STALE_TASK_VERSION",
        "A selected task changed elsewhere. Nothing was sent; refresh and try again.",
      );
    const current = async (id: string) =>
      parseTaskProjection((await this.reader.query("task.get", { id })).task);
    const selected = await Promise.all(tasks.map((task) => current(task.id)));
    if (selected.some((task, index) => task.version !== tasks[index].expectedVersion))
      throw changed();
    const parentId = selected[0].parentId;
    if (
      new Set(tasks.map((task) => task.id)).size !== tasks.length ||
      selected.some((task) => task.parentId !== parentId) ||
      selected.some((task, index) => index > 0 && compareTasks(selected[index - 1], task) >= 0)
    )
      throw changed();
    const anchorId =
      "beforeId" in placement
        ? placement.beforeId
        : "afterId" in placement
          ? placement.afterId
          : null;
    if (
      anchorId !== null &&
      (tasks.some((task) => task.id === anchorId) ||
        (await current(anchorId)).parentId !== parentId)
    ) {
      throw new EditorError(
        "STALE_TASK_VERSION",
        "The move target changed elsewhere. Nothing was sent; refresh and try again.",
      );
    }
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
