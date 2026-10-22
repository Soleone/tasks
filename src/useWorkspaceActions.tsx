import { useEffect, useRef, useState, type RefObject } from "react";
import { randomUUID } from "@/lib/randomUUID";
import type { TaskStatus } from "@/backend/taskModel";
import { classifyTaskText, stripClassificationTokens } from "@/backend/taskText";
import { parseShorthand } from "@/backend/shorthand";
import type { TaskListHandle } from "@/components/TaskList";
import { showTaskToast } from "@/components/TaskToaster";
import type { ComposerState, TaskCreateDraft } from "@/components/TaskComposer";
import type { TaskPickerMode } from "@/components/TaskPicker";
import type { TaskView } from "@/components/taskView";
import { priorityMeta, taskStatusMeta } from "@/components/taskFilters";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import { EditorError } from "@/platform/editorClient";
import type { UndoEntry, UndoHistory } from "@/platform/undoHistory";
import {
  addDependency,
  moveTask,
  removeDependency,
  redoOperation,
  transitionTask,
  undoOperation,
  undoStatusChange,
  waitForTaskWrites,
  type TaskMutationResult,
} from "@/platform/backendClient";
import { useRowExits } from "./useRowExits";
import type { useWorkspaceTasks } from "./useWorkspaceTasks";

type OperationUndoEntry = UndoEntry & { expectedVersion?: number };

/** How long a row a status change moves out of view keeps showing its new status before sliding out. */
const STATUS_EXIT_LINGER_MS = 250;

function statusExitLinger(): number {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : STATUS_EXIT_LINGER_MS;
}

type StatusChangeFeedback = {
  message: string;
  notifyWhenVisible: boolean;
};

const STATUS_CHANGE_FEEDBACK: Record<TaskStatus, StatusChangeFeedback> = {
  open: { message: "Task marked as open", notifyWhenVisible: false },
  in_progress: { message: "Task marked as in progress", notifyWhenVisible: false },
  paused: { message: "Task marked as paused", notifyWhenVisible: true },
  done: { message: "Task marked as done", notifyWhenVisible: true },
  canceled: { message: "Task marked as canceled", notifyWhenVisible: true },
};

type WorkspaceActionsProps = {
  workspace?: MainWorkspace;
  taskView: ReturnType<typeof useWorkspaceTasks>;
  taskListRef: RefObject<TaskListHandle | null>;
  composerRef: RefObject<ComposerState | null>;
  picker: { mode: TaskPickerMode; subject: TaskView } | null;
  requestActiveTask: (taskId?: string | null, preserveTaskOnRefresh?: boolean) => void;
  setAnnouncement: (message: string) => void;
  closePicker: () => void;
  closeComposer: () => void;
  closeHelp: () => void;
};

export function useWorkspaceActions({
  workspace,
  taskView,
  taskListRef,
  composerRef,
  picker,
  requestActiveTask,
  setAnnouncement,
  closePicker,
  closeComposer,
  closeHelp,
}: WorkspaceActionsProps) {
  const {
    tasks,
    setTasks,
    invalidateQueries,
    sortFieldRef,
    refreshTasks,
    finishIdentityPreservingRefresh,
    removeVisibleTasks,
    updateVisibleTask,
    updateVisibleTasks,
    isCurrentViewMatch,
    taskIsInCurrentView,
    visibleTasksAfterUpdate,
  } = taskView;
  const [optimisticCreate, setOptimisticCreate] = useState<TaskView | null>(null);
  const [statusUndo, setStatusUndo] = useState<OperationUndoEntry | null>(null);
  const [redoEntry, setRedoEntry] = useState<UndoEntry | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyBusyRef = useRef(false);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const { exitingTaskIds, exitRows, stopRowExits } = useRowExits(updateVisibleTasks);
  const statusUndoRef = useRef<OperationUndoEntry | null>(null);

  async function pickerRemoveBlocker(blockerId: string): Promise<void> {
    if (!picker) return;
    const { subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    const blocker = tasks.find((task) => task.id === blockerId);
    const subjectTitle = current.title;
    const blockerTitle = blocker ? blocker.title : "blocker";
    closePicker();
    try {
      const result = await removeDependency(current.id, blockerId, current.version, {
        idempotencyKey: randomUUID(),
      });
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      setAnnouncement(`${subjectTitle} is no longer blocked by ${blockerTitle}`);
    } catch (caught) {
      setAnnouncement(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${current.title} changed elsewhere. Refresh and try again.`
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      void refreshTasks();
    }
  }

  async function pickerRemoveParent(): Promise<void> {
    if (!picker) return;
    const { subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    const subjectTitle = current.title;
    closePicker();
    try {
      const result = await moveTask(current.id, null, current.version, {
        idempotencyKey: randomUUID(),
      });
      const refreshManualOrder = result.changed !== false && sortFieldRef.current === "manual";
      if (refreshManualOrder) taskListRef.current?.startIdentityPreservingRefresh();
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (refreshManualOrder) void refreshTasks(0).finally(finishIdentityPreservingRefresh);
      setAnnouncement(`${subjectTitle} is now a top-level task`);
    } catch (caught) {
      setAnnouncement(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${current.title} changed elsewhere. Refresh and try again.`
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      void refreshTasks();
    }
  }

  async function pickerSelected(target: TaskView): Promise<void> {
    if (!picker) return;
    const { mode, subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    closePicker();
    try {
      const result =
        mode === "blocker"
          ? await addDependency(current.id, target.id, current.version, {
              idempotencyKey: randomUUID(),
            })
          : await moveTask(current.id, target.id, current.version, {
              idempotencyKey: randomUUID(),
            });
      const refreshManualOrder =
        mode === "move" && result.changed !== false && sortFieldRef.current === "manual";
      if (refreshManualOrder) taskListRef.current?.startIdentityPreservingRefresh();
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (refreshManualOrder) void refreshTasks(0).finally(finishIdentityPreservingRefresh);
      const subjectTitle = current.title;
      const targetTitle = target.title;
      setAnnouncement(
        mode === "blocker"
          ? `${subjectTitle} is now blocked by ${targetTitle}`
          : `${subjectTitle} moved under ${targetTitle}`,
      );
    } catch (caught) {
      setAnnouncement(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${current.title} changed elsewhere. Refresh and try again.`
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      void refreshTasks();
    }
  }

  async function pauseTaskFromPalette(task: TaskView): Promise<void> {
    const current = tasks.find((candidate) => candidate.id === task.id) ?? task;
    const wasActive = taskListRef.current?.getActiveTask()?.id === current.id;
    closeHelp();
    if (current.status === "done" || current.status === "canceled") {
      setAnnouncement(
        `${current.title} is ${taskStatusMeta[current.status].label.toLowerCase()}. Reopen it before pausing.`,
      );
      return;
    }
    try {
      const result =
        current.status === "paused"
          ? await transitionTask("task.start", current.id, current.version, {
              idempotencyKey: randomUUID(),
            })
          : await transitionTask("task.pause", current.id, current.version, {
              idempotencyKey: randomUUID(),
            });
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (result.changed !== false) handleStatusChanged(current, result.task, wasActive);
      setAnnouncement(
        `${current.title}: ${result.task.status === "paused" ? "Paused" : "In progress"}`,
      );
    } catch (caught) {
      setAnnouncement(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${current.title} changed elsewhere. Refresh and try again.`
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      void refreshTasks();
    }
  }

  function recordOperationUndo(
    operationId: string | undefined,
    previous: TaskView[],
    current: TaskView[],
    options: { createdTaskIds?: string[]; wasActiveTaskId?: string | null } = {},
  ): void {
    if (!operationId) return;
    const previousById = new Map(previous.map((task) => [task.id, task]));
    const currentById = new Map(current.map((task) => [task.id, task]));
    const affectedTaskIds = [...new Set([...previous, ...current].map((task) => task.id))].filter(
      (taskId) => {
        const before = previousById.get(taskId);
        const after = currentById.get(taskId);
        return before === undefined || after === undefined || before.version !== after.version;
      },
    );
    if (affectedTaskIds.length === 0) return;
    const statusLike = affectedTaskIds.every((taskId) => {
      const before = previousById.get(taskId);
      const after = currentById.get(taskId);
      return before !== undefined && after !== undefined && before.status !== after.status;
    });
    // A backend without general operation undo can only retain its single-task status change.
    const singleStatus = statusLike && affectedTaskIds.length === 1;
    if (workspace && !workspace.supportsOperationUndo && !singleStatus) {
      retireStatusUndo();
      return;
    }
    const titleTask =
      current.find((task) => affectedTaskIds.includes(task.id)) ??
      previous.find((task) => affectedTaskIds.includes(task.id));
    const entry: OperationUndoEntry = {
      operationId,
      ...(workspace && !workspace.supportsOperationUndo && singleStatus
        ? { expectedVersion: current[0].version }
        : {}),
      key: randomUUID(),
      affectedTaskIds,
      createdTaskIds: options.createdTaskIds ?? [],
      title: titleTask?.title ?? "task",
      statusLike,
      priorityLike: affectedTaskIds.every((taskId) => {
        const before = previousById.get(taskId);
        const after = currentById.get(taskId);
        return before !== undefined && after !== undefined && before.priority !== after.priority;
      }),
      wasActiveTaskId:
        options.wasActiveTaskId ??
        (() => {
          const activeTaskId = taskListRef.current?.getActiveTask()?.id ?? null;
          return activeTaskId !== null && affectedTaskIds.includes(activeTaskId)
            ? activeTaskId
            : null;
        })(),
    };
    showUndo(entry);
    setRedoEntry(null);
    if (!workspace?.supportsOperationUndo) return;
    // Re-show after pushing, so a history load that resolves late cannot replace this newer entry.
    void workspace.undoHistory().then(
      (history) => {
        history.push(entry);
        showHistory(history);
      },
      () => undefined,
    );
  }

  function showUndo(entry: OperationUndoEntry | null): void {
    statusUndoRef.current = entry;
    setStatusUndo(entry);
  }

  function retireStatusUndo(): void {
    showUndo(null);
  }

  function showHistory(history: UndoHistory): void {
    showUndo(history.latest());
    setRedoEntry(workspace?.supportsOperationRedo ? history.latestRedo() : null);
  }

  async function handleHistory(direction: "undo" | "redo"): Promise<void> {
    if (historyBusyRef.current) return;
    historyBusyRef.current = true;
    setHistoryBusy(true);
    let history: UndoHistory | null = null;
    let entry: OperationUndoEntry | null = null;
    const action = direction === "redo" ? "Redo" : "Undo";
    try {
      await taskListRef.current?.waitForWrites();
      const selected = await waitForTaskWrites();
      if (workspace && selected !== workspace) return;
      if (direction === "redo" && !workspace?.supportsOperationRedo) return;
      history = workspace?.supportsOperationUndo ? await workspace.undoHistory() : null;
      entry =
        direction === "redo"
          ? (history?.latestRedo() ?? null)
          : history
            ? history.latest()
            : statusUndoRef.current;
      if (!entry) return;
      const result =
        direction === "redo"
          ? {
              ...(await redoOperation(entry.operationId, { idempotencyKey: entry.key })),
              deletedTaskIds: [],
            }
          : entry.expectedVersion !== undefined
            ? {
                tasks: [
                  (
                    await undoStatusChange(entry.affectedTaskIds[0], entry.expectedVersion, {
                      idempotencyKey: entry.key,
                    })
                  ).task,
                ],
                deletedTaskIds: [],
                operationId: undefined,
              }
            : await undoOperation(entry.operationId, { idempotencyKey: entry.key });
      const restored = result.tasks;
      stopRowExits();
      if (result.deletedTaskIds && result.deletedTaskIds.length > 0)
        removeVisibleTasks(result.deletedTaskIds);
      updateVisibleTasks(restored);
      const wasActiveTaskId = entry.wasActiveTaskId;
      if (wasActiveTaskId && restored.some((task) => task.id === wasActiveTaskId))
        requestActiveTask(wasActiveTaskId);
      if (history && result.operationId) {
        const next = { ...entry, operationId: result.operationId, key: randomUUID() };
        if (direction === "redo") history.completeRedo(entry.operationId, next);
        else history.completeUndo(entry.operationId, next);
        showHistory(history);
      } else retireStatusUndo();
      const label =
        restored.length === 1
          ? (taskStatusMeta[restored[0].status]?.label ?? restored[0].status)
          : null;
      const verb = direction === "redo" ? "Redid" : "Undid";
      const message =
        entry.createdTaskIds.length > 0
          ? `${direction === "redo" ? "Restored" : "Removed"}: ${entry.title}`
          : entry.statusLike && restored.length === 1
            ? `${restored[0].title}: ${label}`
            : restored.length === 1
              ? `${verb} change to ${restored[0].title}`
              : `${verb} changes for ${entry.affectedTaskIds.length} tasks`;
      setAnnouncement(message);
      const status =
        entry.statusLike &&
        restored.length > 0 &&
        restored.every((task) => task.status === restored[0].status)
          ? restored[0].status
          : undefined;
      const priority =
        entry.priorityLike &&
        restored.length > 0 &&
        restored.every((task) => task.priority === restored[0].priority)
          ? restored[0].priority
          : undefined;
      showTaskToast(
        entry.statusLike && label
          ? `${action} status change to ${label}`
          : priority !== undefined
            ? `${action} priority change to ${priorityMeta(priority).shortLabel}`
            : message,
        status !== undefined
          ? { icon: taskStatusMeta[status].Icon, completion: status === "done" }
          : { priority },
      );
      void refreshTasks(0, true);
    } catch (caught) {
      if (
        entry &&
        caught instanceof EditorError &&
        [
          "OPERATION_CONFLICT",
          "OPERATION_UNAVAILABLE",
          "OPERATION_NOT_FOUND",
          "UNDO_UNAVAILABLE",
          "STALE_TASK_VERSION",
          "TASK_NOT_FOUND",
          "PARENT_CYCLE",
          "DEPENDENCY_CYCLE",
        ].includes(caught.code)
      ) {
        if (history) {
          if (direction === "redo") history.removeRedo(entry.operationId);
          else history.remove(entry.operationId);
          showHistory(history);
        } else retireStatusUndo();
        stopRowExits();
        setAnnouncement(`${entry.title} changed elsewhere. ${action} is no longer available.`);
        void refreshTasks();
        return;
      }
      setAnnouncement(caught instanceof Error ? caught.message : String(caught));
    } finally {
      historyBusyRef.current = false;
      setHistoryBusy(false);
    }
  }

  // Restore only this client's history for the confirmed root/cache/profile.
  useEffect(() => {
    if (!workspace?.supportsOperationUndo) return;
    let cancelled = false;
    void workspace.undoHistory().then(
      (history) => {
        if (!cancelled) {
          showUndo(history.latest());
          setRedoEntry(workspace.supportsOperationRedo ? history.latestRedo() : null);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => {
    if (newTaskId === null) return;
    const timeout = window.setTimeout(() => setNewTaskId(null), 240);
    return () => window.clearTimeout(timeout);
  }, [newTaskId]);

  function showOptimisticCreate(draft: TaskCreateDraft): void {
    const literal = workspace ? parseShorthand(draft.title) : null;
    const classification = literal
      ? {
          category:
            literal.category === null ? null : { slug: literal.category, label: literal.category },
          tags: literal.tags.map((slug) => ({ slug, label: slug })),
        }
      : classifyTaskText(draft.title);
    const now = new Date().toISOString();
    const task: TaskView = {
      id: `pending-${randomUUID()}`,
      title: literal?.title ?? (stripClassificationTokens(draft.title) || draft.title),
      text: draft.title,
      description: draft.description,
      status: "open",
      priority: draft.priority,
      category: classification.category,
      tags: classification.tags,
      parentId: draft.parentId ?? null,
      dependencyIds: [],
      attachments: [],
      blockedByIds: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    setOptimisticCreate(isCurrentViewMatch(task) ? task : null);
  }

  function taskSaved(result: TaskMutationResult): void {
    const task = result.task;
    const composerBeforeSave = composerRef.current;
    const creating = composerBeforeSave?.mode === "create";
    const previous = composerBeforeSave?.mode === "edit" ? [composerBeforeSave.task] : [];
    const visible = isCurrentViewMatch(task);
    if (creating) {
      setOptimisticCreate(null);
      if (visible) {
        updateVisibleTasks([task]);
        setNewTaskId(task.id);
      }
    } else if (visible) {
      setTasks((previous) =>
        previous.map((existing) => (existing.id === task.id ? task : existing)),
      );
    } else {
      setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
    }
    if (!creating) requestActiveTask(task.id);
    if (result.operationId) {
      recordOperationUndo(result.operationId, previous, [task], {
        createdTaskIds: creating ? [task.id] : [],
      });
    }
    setAnnouncement(`${creating ? "Added" : "Saved"}: ${task.title}`);
    // Creating one task returns to the list instead of reopening capture.
    // The next task can still be started with C or the New task action.
    closeComposer();
    if (!creating) void refreshTasks();
  }

  function showStatusChangeToast(changedTasks: readonly TaskView[], movedOutOfView = false): void {
    if (changedTasks.length === 0) return;
    const statuses = [...new Set(changedTasks.map((task) => task.status))];
    if (!movedOutOfView && statuses.length !== 1) return;
    const feedback = statuses
      .map((status) => STATUS_CHANGE_FEEDBACK[status])
      .filter((entry) => movedOutOfView || entry.notifyWhenVisible);
    if (feedback.length === 0) return;
    const Icon = statuses.length === 1 ? taskStatusMeta[statuses[0]].Icon : undefined;
    showTaskToast(
      feedback.length === 1
        ? feedback[0].message
        : `Tasks: ${feedback.map((entry) => entry.message).join("; ")}`,
      {
        ...(Icon ? { icon: Icon } : {}),
        ...(statuses.length === 1 && statuses[0] === "done" ? { completion: true } : {}),
      },
    );
  }

  function handleStatusChanged(previous: TaskView, current: TaskView, _wasActive: boolean): void {
    const nextTasks = visibleTasksAfterUpdate([current]);
    const movedOutOfView =
      taskIsInCurrentView(previous) && !taskIsInCurrentView(current, nextTasks);
    showStatusChangeToast([current], movedOutOfView);
    if (previous.status === "canceled" && current.status !== "canceled") void refreshTasks(0, true);
  }

  function handleStatusBatchChanged(
    previous: TaskView[],
    current: TaskView[],
    _wasActiveTaskId: string | null,
  ): void {
    const nextTasks = visibleTasksAfterUpdate(current);
    const previousById = new Map(previous.map((task) => [task.id, task]));
    const movedOutOfView = current.filter((task) => {
      const before = previousById.get(task.id);
      return (
        before !== undefined && taskIsInCurrentView(before) && !taskIsInCurrentView(task, nextTasks)
      );
    });
    if (movedOutOfView.length > 0) {
      showStatusChangeToast(movedOutOfView, true);
      return;
    }
    showStatusChangeToast(current);
  }

  function showInPlace(updated: readonly TaskView[]): void {
    const byId = new Map(updated.map((task) => [task.id, task]));
    setTasks((previous) => previous.map((existing) => byId.get(existing.id) ?? existing));
  }

  /**
   * Status and priority changes from the list. A row they move out of view
   * shows its new status long enough for the glyph to play, then slides out.
   */
  function showTaskUpdates(updated: TaskView[]): void {
    const nextTasks = visibleTasksAfterUpdate(updated);
    const leaving = updated.filter(
      (task) =>
        tasks.some((existing) => existing.id === task.id) && !taskIsInCurrentView(task, nextTasks),
    );
    const staying = updated.filter((task) => !leaving.includes(task));
    stopRowExits(staying.map((task) => task.id));
    updateVisibleTasks(staying);
    if (leaving.length === 0) return;
    showInPlace(leaving);
    exitRows(leaving, statusExitLinger());
  }

  function handleCanceledMany(previous: TaskView[], current: TaskView[]): void {
    invalidateQueries();
    const previousIds = new Set(previous.map((task) => task.id));
    const exiting = current.filter(
      (task) =>
        previousIds.has(task.id) &&
        tasks.some((existing) => existing.id === task.id) &&
        !isCurrentViewMatch(task),
    );
    if (exiting.length > 0) {
      showInPlace(exiting);
      exitRows(exiting, statusExitLinger(), () => void refreshTasks(0, true));
      updateVisibleTasks(current.filter((task) => !exiting.includes(task)));
    } else {
      updateVisibleTasks(current);
    }
    setAnnouncement(
      current.length === 1 ? `Canceled: ${current[0].title}` : `Canceled ${current.length} tasks`,
    );
  }

  return {
    optimisticCreate,
    setOptimisticCreate,
    statusUndo,
    redoEntry,
    historyBusy,
    newTaskId,
    exitingTaskIds,
    pickerRemoveBlocker,
    pickerRemoveParent,
    pickerSelected,
    pauseTaskFromPalette,
    recordOperationUndo,
    handleUndoStatus: () => handleHistory("undo"),
    handleRedo: () => handleHistory("redo"),
    showOptimisticCreate,
    taskSaved,
    handleStatusChanged,
    handleStatusBatchChanged,
    handleCanceledMany,
    showTaskUpdates,
  };
}
