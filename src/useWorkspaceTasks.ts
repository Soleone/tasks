import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { TaskListHandle } from "@/components/TaskList";
import type { ClassificationOption, TaskView } from "@/components/taskView";
import { contextAncestorIds, taskGroupOrder } from "@/components/taskTree";
import { compareTasksForViewSort, presetStatuses, taskMatchesViewFilters, type SortDirection, type SortField, type StatusPreset } from "@/components/taskFilters";
import { closeBackendSession, getWorkspaceRevision, listTasks, receiveWorkspaceStatus, type ReceiveWorkspaceResult, type TaskListResult } from "@/platform/backendClient";
import { runtimeKind } from "@/platform/runtime";

// Android re-reads the whole SAF workspace on every poll (~50 IPCs for a
// mid-size task set), so it polls far less often than desktop, where the read
// is a cheap local-filesystem scan.
const WORKSPACE_REVISION_POLL_MS = runtimeKind() === "android" ? 15000 : 1500;

type WorkspaceTasksView = {
  statusPreset: StatusPreset;
  exactStatus: TaskStatus | null;
  priorityFilter: TaskPriority | null;
  tagFilter: ClassificationOption[];
  searchQuery: string;
  showUnblocked: boolean;
  sortField: SortField;
  sortDirection: SortDirection;
  categoryFilter: ClassificationToken | null;
  setCategoryFilter: Dispatch<SetStateAction<ClassificationToken | null>>;
  setTagFilter: Dispatch<SetStateAction<ClassificationOption[]>>;
  taskListRef: RefObject<TaskListHandle | null>;
};

export function useWorkspaceTasks({
  statusPreset,
  exactStatus,
  priorityFilter,
  tagFilter,
  searchQuery,
  showUnblocked,
  sortField,
  sortDirection,
  categoryFilter,
  setCategoryFilter,
  setTagFilter,
  taskListRef,
}: WorkspaceTasksView) {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [contextTasks, setContextTasks] = useState<TaskView[]>([]);
  const [contextOrder, setContextOrder] = useState<Map<string, number>>(() => new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiveState, setReceiveState] = useState<ReceiveWorkspaceResult | null>(null);
  const [unresolvedConflicts, setUnresolvedConflicts] = useState<NonNullable<TaskListResult["unresolvedConflicts"]>>([]);
  const querySequence = useRef(0);
  const initialLoadRetry = useRef(0);
  const statusPresetRef = useRef<StatusPreset>(statusPreset);
  const exactStatusRef = useRef<TaskStatus | null>(exactStatus);
  const priorityFilterRef = useRef<TaskPriority | null>(priorityFilter);
  const tagFilterRef = useRef<string[]>(tagFilter.map((tag) => tag.slug));
  const searchQueryRef = useRef(searchQuery);
  const showUnblockedRef = useRef(showUnblocked);
  const sortFieldRef = useRef<SortField>(sortField);
  const sortDirectionRef = useRef<SortDirection>(sortDirection);
  const categoryFilterRef = useRef<string | null>(categoryFilter?.slug ?? null);
  const restoredMetadataRef = useRef(false);
  const workspaceRevisionRef = useRef<number | null>(null);

  const refreshTasks = useCallback(async (offset = 0, preserveContextOrder = false): Promise<boolean> => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const exact = exactStatusRef.current;
      const statuses = exact !== null ? [exact] : presetStatuses(statusPresetRef.current);
      const result = await listTasks(
        statuses,
        offset,
        showUnblockedRef.current,
        categoryFilterRef.current ?? undefined,
        {
          ...(priorityFilterRef.current !== null ? { priority: priorityFilterRef.current } : {}),
          ...(tagFilterRef.current.length > 0 ? { tags: [...tagFilterRef.current] } : {}),
          ...(searchQueryRef.current.trim() !== "" ? { search: searchQueryRef.current.trim() } : {}),
          sort: sortFieldRef.current,
          direction: sortDirectionRef.current,
          includeAncestors: true,
        },
      );
      if (sequence !== querySequence.current) return false;
      workspaceRevisionRef.current = result.workspaceRevision;
      setUnresolvedConflicts(result.unresolvedConflicts ?? []);
      if (!offset && !preserveContextOrder) setContextOrder(new Map());
      setTasks((previous) => offset ? [...previous, ...result.tasks.filter((task) => !previous.some((existing) => existing.id === task.id))] : result.tasks);
      setContextTasks((previous) => {
        if (!offset) return result.contextTasks;
        const next = new Map(previous.map((task) => [task.id, task]));
        for (const task of result.contextTasks) next.set(task.id, task);
        return [...next.values()];
      });
      if (!offset && !restoredMetadataRef.current) {
        restoredMetadataRef.current = true;
        const categorySlug = categoryFilterRef.current;
        const tagSlugs = [...tagFilterRef.current];
        if (categorySlug !== null || tagSlugs.length > 0) {
          const loadedTasks = [...result.tasks, ...result.contextTasks];
          if (categorySlug !== null) {
            const category = loadedTasks.find((task) => task.category?.slug === categorySlug)?.category;
            const enriched: ClassificationToken = category
              ? { slug: category.slug, label: category.label }
              : { slug: categorySlug, label: categorySlug };
            setCategoryFilter((previous) => previous?.slug === enriched.slug && previous.label === enriched.label ? previous : enriched);
          }
          if (tagSlugs.length > 0) {
            const tags = new Map(loadedTasks.flatMap((task) => task.tags).map((tag) => [tag.slug, tag]));
            const enriched = tagSlugs.map((slug) => {
              const tag = tags.get(slug);
              return tag
                ? { ...tag, taskCount: loadedTasks.filter((task) => task.tags.some((entry) => entry.slug === tag.slug)).length }
                : { slug, label: slug, taskCount: 0 };
            });
            setTagFilter((previous) => {
              const previousSlugs = previous.map((tag) => tag.slug);
              const sameSlugs = previousSlugs.length === enriched.length && previousSlugs.every((slug, index) => slug === enriched[index].slug);
              const sameMeta = previous.length === enriched.length && previous.every((tag, index) => tag.label === enriched[index].label && tag.taskCount === enriched[index].taskCount);
              return sameSlugs && sameMeta ? previous : enriched;
            });
          }
        }
      }
      setTotal(result.total);
      initialLoadRetry.current = 0;
      return true;
    } catch (caught) {
      if (sequence === querySequence.current) setLoadError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      if (sequence === querySequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    statusPresetRef.current = statusPreset;
    exactStatusRef.current = exactStatus;
    priorityFilterRef.current = priorityFilter;
    tagFilterRef.current = tagFilter.map((tag) => tag.slug);
    searchQueryRef.current = searchQuery;
    showUnblockedRef.current = showUnblocked;
    sortFieldRef.current = sortField;
    sortDirectionRef.current = sortDirection;
    categoryFilterRef.current = categoryFilter?.slug ?? null;
    if (!receiveState?.waiting) void refreshTasks();
  }, [statusPreset, exactStatus, priorityFilter, tagFilter, searchQuery, showUnblocked, sortField, sortDirection, categoryFilter, refreshTasks, receiveState?.waiting]);

  useEffect(() => {
    void receiveWorkspaceStatus()
      .then((status) => setReceiveState(status.waiting ? status : null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (loading || !loadError || tasks.length > 0 || initialLoadRetry.current >= 3) return;

    const attempt = initialLoadRetry.current;
    initialLoadRetry.current += 1;
    const timeout = window.setTimeout(() => {
      void refreshTasks();
    }, 250 * (attempt + 1));
    return () => window.clearTimeout(timeout);
  }, [loading, loadError, tasks.length, refreshTasks]);

  useEffect(() => {
    if (loading || receiveState?.waiting) return;

    let disposed = false;
    let checking = false;

    const checkWorkspaceRevision = async (): Promise<void> => {
      if (disposed || checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const revision = await getWorkspaceRevision();
        if (disposed) return;
        const previousRevision = workspaceRevisionRef.current;
        if (previousRevision !== null && revision !== previousRevision) {
          taskListRef.current?.startIdentityPreservingRefresh();
          try {
            await refreshTasks();
          } finally {
            finishIdentityPreservingRefresh();
          }
        } else if (previousRevision === null) {
          workspaceRevisionRef.current = revision;
        }
      } catch {
        // Focus and explicit refresh still surface backend failures.
      } finally {
        checking = false;
      }
    };

    const refreshOnVisibility = (): void => {
      if (document.visibilityState === "visible") void checkWorkspaceRevision();
    };
    const interval = window.setInterval(() => void checkWorkspaceRevision(), WORKSPACE_REVISION_POLL_MS);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [loading, receiveState?.waiting, refreshTasks]);

  useEffect(() => {
    const refreshOnFocus = (): void => { void refreshTasks(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      ++querySequence.current;
      window.removeEventListener("focus", refreshOnFocus);
      void closeBackendSession();
    };
  }, [refreshTasks]);

  function finishIdentityPreservingRefresh(): void {
    window.requestAnimationFrame(() => taskListRef.current?.finishIdentityPreservingRefresh());
  }

  function syncContextTasks(nextTasks: TaskView[], candidates?: TaskView | readonly TaskView[]): void {
    const candidateList = candidates === undefined ? [] : Array.isArray(candidates) ? candidates : [candidates];
    setContextTasks((previous) => {
      const visibleIds = new Set(nextTasks.map((entry) => entry.id));
      const knownTasks = [...previous, ...nextTasks, ...candidateList];
      const requiredContextIds = contextAncestorIds(nextTasks, knownTasks);
      const byId = new Map(previous.map((entry) => [entry.id, entry]));
      for (const candidate of candidateList) byId.set(candidate.id, candidate);
      return [...byId.values()].filter((entry) => !visibleIds.has(entry.id) && requiredContextIds.has(entry.id));
    });
  }

  function removeVisibleTasks(taskIds: string[]): void {
    const ids = new Set(taskIds);
    const nextTasks = tasks.filter((task) => !ids.has(task.id));
    const removed = tasks.length - nextTasks.length;
    if (removed === 0) return;
    const currentGroupOrder = taskGroupOrder(tasks, contextTasks);
    setContextOrder((previous) => {
      const next = new Map(previous);
      let nextOrder = Math.max(-1, ...next.values()) + 1;
      for (const rootId of currentGroupOrder.keys()) {
        if (next.has(rootId)) continue;
        next.set(rootId, nextOrder);
        nextOrder += 1;
      }
      return next;
    });
    setTasks(nextTasks);
    setTotal((previous) => Math.max(previous - removed, 0));
    syncContextTasks(nextTasks);
  }

  function updateVisibleTask(task: TaskView): void {
    updateVisibleTasks([task]);
  }

  function updateVisibleTasks(updatedTasks: TaskView[]): void {
    if (updatedTasks.length === 0) return;
    const updates = new Map(updatedTasks.map((task) => [task.id, task]));
    let nextTasks = tasks;
    let totalDelta = 0;
    let membershipChanged = false;
    let removedTask = false;
    for (const task of updates.values()) {
      const currentIndex = nextTasks.findIndex((existing) => existing.id === task.id);
      const wasVisible = currentIndex !== -1;
      const visible = isCurrentViewMatch(task);
      if (visible) {
        if (wasVisible) {
          nextTasks = nextTasks.map((existing) => existing.id === task.id ? task : existing);
        } else {
          nextTasks = [...nextTasks, task].sort((a, b) => compareTasksForViewSort(a, b, sortField, sortDirection));
          totalDelta += 1;
          membershipChanged = true;
        }
      } else if (wasVisible) {
        nextTasks = nextTasks.filter((existing) => existing.id !== task.id);
        totalDelta -= 1;
        membershipChanged = true;
        removedTask = true;
      }
    }
    if (removedTask) {
      const currentGroupOrder = taskGroupOrder(tasks, contextTasks);
      setContextOrder((previous) => {
        const next = new Map(previous);
        let nextOrder = Math.max(-1, ...next.values()) + 1;
        for (const rootId of currentGroupOrder.keys()) {
          if (next.has(rootId)) continue;
          next.set(rootId, nextOrder);
          nextOrder += 1;
        }
        return next;
      });
    }
    setTasks(nextTasks);
    if (totalDelta !== 0) setTotal((previous) => Math.max(previous + totalDelta, 0));
    syncContextTasks(nextTasks, updatedTasks);
    if (membershipChanged && sortField === "manual") void refreshTasks(0, true);
  }

  function isCurrentViewMatch(task: TaskView): boolean {
    return taskMatchesViewFilters(task, {
      exactStatus,
      statusPreset,
      showUnblocked,
      categorySlug: categoryFilter?.slug ?? null,
      priorityFilter,
      tagSlugs: tagFilter.map((tag) => tag.slug),
      searchQuery,
    });
  }

  function taskIsInCurrentView(task: TaskView, visibleTasks: readonly TaskView[] = tasks): boolean {
    if (isCurrentViewMatch(task)) return true;

    const otherVisibleTasks = visibleTasks.filter((entry) => entry.id !== task.id);
    return contextAncestorIds(otherVisibleTasks, [...otherVisibleTasks, ...contextTasks, task]).has(task.id);
  }

  function visibleTasksAfterUpdate(updatedTasks: readonly TaskView[]): TaskView[] {
    const updates = new Map(updatedTasks.map((task) => [task.id, task]));
    const nextTasks = tasks.flatMap((existing) => {
      const updated = updates.get(existing.id);
      if (!updated) return [existing];
      return isCurrentViewMatch(updated) ? [updated] : [];
    });
    const existingIds = new Set(tasks.map((task) => task.id));
    for (const updated of updatedTasks) {
      if (!existingIds.has(updated.id) && isCurrentViewMatch(updated)) nextTasks.push(updated);
    }
    return nextTasks;
  }

  useEffect(() => {
    if (!receiveState?.waiting) return;
    const timer = window.setInterval(() => {
      void receiveWorkspaceStatus().then((status) => setReceiveState(status.waiting ? status : null));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [receiveState?.waiting]);

  return {
    tasks,
    setTasks,
    contextTasks,
    contextOrder,
    total,
    loading,
    loadError,
    receiveState,
    setReceiveState,
    unresolvedConflicts,
    querySequence,
    sortFieldRef,
    categoryFilterRef,
    refreshTasks,
    finishIdentityPreservingRefresh,
    removeVisibleTasks,
    updateVisibleTask,
    updateVisibleTasks,
    isCurrentViewMatch,
    taskIsInCurrentView,
    visibleTasksAfterUpdate,
  };
}
