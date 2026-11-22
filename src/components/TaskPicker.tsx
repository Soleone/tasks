import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { Link2Off } from "lucide-react";
import type { TaskView } from "./taskView";
import { TaskRow, TaskStatusDisplay } from "@/components/TaskRow";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getTask, listTasks } from "@/platform/backendClient";
import { literalWordScore } from "@/components/commandFilter";
import { Command, PaletteDialog } from "@/components/variants/command";
import { useLoadOnOpen } from "./useLoadOnOpen";
import { TASK_LIST_MAX_LIMIT } from "@/backend/protocol";

export type TaskPickerMode = "blocker" | "move";

const NON_CANCELED_TASK_STATUSES = ["open", "in_progress", "paused", "done"] as const;

// The search runs over what is loaded, so every page has to be here, not just the first.
async function listAllNonCanceledTasks(): Promise<TaskView[]> {
  const tasks: TaskView[] = [];
  for (;;) {
    const page = await listTasks({
      status: NON_CANCELED_TASK_STATUSES,
      offset: tasks.length,
      limit: TASK_LIST_MAX_LIMIT,
    });
    tasks.push(...page.tasks);
    if (page.tasks.length === 0 || tasks.length >= page.total) return tasks;
  }
}

function pickerCandidates(all: TaskView[], subject: TaskView, mode: TaskPickerMode): TaskView[] {
  const selectable = all.filter((task) => task.status !== "canceled");
  if (mode === "blocker") {
    const blocked = new Set(subject.dependencyIds);
    return selectable.filter(
      (task) => task.status !== "done" && task.id !== subject.id && !blocked.has(task.id),
    );
  }
  return selectable.filter(
    (task) => task.id !== subject.id && task.id !== subject.parentId && task.parentId === null,
  );
}

export function TaskPicker({
  open,
  mode,
  subject,
  onClose,
  finalFocus,
  onSelect,
  onRemoveBlocker,
  onRemoveParent,
}: {
  open: boolean;
  mode: TaskPickerMode;
  subject: TaskView;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  onSelect: (target: TaskView) => void;
  onRemoveBlocker?: (blockerId: string) => void;
  onRemoveParent?: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  // Candidate tasks exclude canceled rows at the query boundary. Fetch
  // current relationship targets separately so canceled dependencies and
  // parents remain available for removal and context.
  const loadCandidates = useCallback(async (): Promise<TaskView[]> => {
    const relationshipIds = [
      ...new Set([...(subject.parentId ? [subject.parentId] : []), ...subject.dependencyIds]),
    ];
    const [tasks, relationships] = await Promise.all([
      listAllNonCanceledTasks(),
      Promise.all(relationshipIds.map((id) => getTask(id))),
    ]);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const relationship of relationships) byId.set(relationship.task.id, relationship.task);
    return [...byId.values()];
  }, [subject]);
  const { value, loading, error } = useLoadOnOpen(open, loadCandidates);
  const fetched = useMemo(() => value ?? [], [value]);

  const candidates = useMemo(
    () => pickerCandidates(fetched, subject, mode),
    [fetched, subject, mode],
  );

  const titleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of candidates) counts.set(task.title, (counts.get(task.title) ?? 0) + 1);
    return counts;
  }, [candidates]);

  const heading =
    mode === "blocker" ? `Blocked by: ${subject.title}` : `Move ${subject.title} under…`;
  const groupHeading = mode === "blocker" ? "Select blocker" : "Select new parent";
  const emptyText = loading ? "Loading tasks…" : (error ?? "No matching tasks.");
  const showRemoveParent =
    mode === "move" && subject.parentId !== null && onRemoveParent !== undefined;
  const showRemoveBlocker =
    mode === "blocker" && subject.dependencyIds.length > 0 && onRemoveBlocker !== undefined;
  const currentParentTitle = fetched.find((task) => task.id === subject.parentId)?.title ?? null;
  const blockers = useMemo(() => {
    if (!showRemoveBlocker) return [];
    return subject.dependencyIds.map((id) => ({
      id,
      task: fetched.find((task) => task.id === id),
    }));
  }, [showRemoveBlocker, subject.dependencyIds, fetched]);

  return (
    <PaletteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={heading}
      description={
        mode === "blocker"
          ? showRemoveBlocker
            ? "Remove the current blocker, or search tasks and press Enter to mark this task blocked by the selected task."
            : "Search tasks and press Enter to mark this task blocked by the selected task."
          : showRemoveParent
            ? "Remove the current parent, or search tasks and press Enter to move this task under the selected task."
            : "Search tasks and press Enter to move this task under the selected task."
      }
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command label={heading} filter={literalWordScore} loop>
        <CommandInput ref={searchInput} placeholder="Search tasks…" />
        <CommandList label="Task results">
          <CommandEmpty>{emptyText}</CommandEmpty>
          {showRemoveParent ? (
            <CommandGroup heading="Current parent">
              <CommandItem
                value={`Remove parent ${currentParentTitle ?? ""} ${subject.parentId ?? ""}`}
                keywords={[
                  "remove",
                  "parent",
                  "unparent",
                  "detach",
                  "clear",
                  currentParentTitle ?? "",
                ]}
                onSelect={() => onRemoveParent?.()}
              >
                <Link2Off aria-hidden="true" className="text-muted-foreground" />
                <span className="font-medium">Remove parent</span>
                {currentParentTitle ? (
                  <span className="truncate text-muted-foreground">{currentParentTitle}</span>
                ) : null}
              </CommandItem>
            </CommandGroup>
          ) : null}
          {showRemoveBlocker ? (
            <CommandGroup>
              {blockers.map((blocker) => (
                <CommandItem
                  key={`remove-${blocker.id}`}
                  value={`Remove blocker ${blocker.task?.title ?? ""} ${blocker.id}`}
                  keywords={["remove", "unblock", "clear", blocker.task?.title ?? ""]}
                  onSelect={() => onRemoveBlocker?.(blocker.id)}
                >
                  <Link2Off aria-hidden="true" className="text-muted-foreground" />
                  {blocker.task ? <TaskStatusDisplay task={blocker.task} /> : null}
                  <span className="font-medium">Remove blocker</span>
                  {blocker.task?.title ? (
                    <span className="truncate text-muted-foreground">{blocker.task.title}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={groupHeading}>
            {candidates.map((task) => {
              const variant = (titleCounts.get(task.title) ?? 0) > 1 ? "full" : "compact";
              return (
                <CommandItem
                  key={task.id}
                  value={`${task.title} ${task.id}`}
                  keywords={[task.description, task.status]}
                  onSelect={() => onSelect(task)}
                >
                  <TaskRow
                    task={task}
                    variant={variant}
                    statusSlot={<TaskStatusDisplay task={task} />}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PaletteDialog>
  );
}
