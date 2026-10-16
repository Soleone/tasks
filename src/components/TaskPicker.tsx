import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link2Off } from "lucide-react";
import type { TaskView } from "./taskView";
import { TaskRow, TaskStatusDisplay } from "@/components/TaskRow";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  literalWordScore,
} from "@/components/ui/command";
import { getTask, listTasks } from "@/platform/backendClient";

export type TaskPickerMode = "blocker" | "move";

const NON_CANCELED_TASK_STATUSES = ["open", "in_progress", "paused", "done"] as const;

function collectDescendantIds(candidates: TaskView[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const task of candidates) {
    if (!task.parentId) continue;
    const siblings = childrenByParent.get(task.parentId) ?? [];
    siblings.push(task.id);
    childrenByParent.set(task.parentId, siblings);
  }
  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (current === rootId || descendants.has(current)) continue;
    descendants.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return descendants;
}

function pickerCandidates(all: TaskView[], subject: TaskView, mode: TaskPickerMode): TaskView[] {
  const selectable = all.filter((task) => task.status !== "canceled");
  if (mode === "blocker") {
    const blocked = new Set(subject.dependencyIds);
    return selectable.filter(
      (task) => task.status !== "done" && task.id !== subject.id && !blocked.has(task.id),
    );
  }
  const descendants = collectDescendantIds(all, subject.id);
  return selectable.filter(
    (task) =>
      task.id !== subject.id &&
      !descendants.has(task.id) &&
      task.id !== subject.parentId &&
      task.parentId === null,
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
  const [fetched, setFetched] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Candidate tasks exclude canceled rows at the query boundary. Fetch
    // current relationship targets separately so canceled dependencies and
    // parents remain available for removal and context.
    const relationshipIds = [
      ...new Set([...(subject.parentId ? [subject.parentId] : []), ...subject.dependencyIds]),
    ];
    Promise.all([
      listTasks(NON_CANCELED_TASK_STATUSES, 0),
      Promise.all(relationshipIds.map((id) => getTask(id))),
    ])
      .then(([result, relationships]) => {
        if (cancelled) return;
        const byId = new Map(result.tasks.map((task) => [task.id, task]));
        for (const relationship of relationships) byId.set(relationship.task.id, relationship.task);
        setFetched([...byId.values()]);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setFetched([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, subject, mode]);

  const candidates = useMemo(
    () => pickerCandidates(fetched, subject, mode),
    [fetched, subject, mode],
  );

  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of candidates) {
      const title = task.title;
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  }, [candidates]);

  const heading =
    mode === "blocker" ? `Blocked by: ${subject.title}` : `Move ${subject.title} under…`;
  const groupHeading = mode === "blocker" ? "Select blocker" : "Select new parent";
  const emptyText = loading ? "Loading tasks…" : (error ?? "No matching tasks.");
  const showRemoveParent =
    mode === "move" && subject.parentId !== null && onRemoveParent !== undefined;
  const showRemoveBlocker =
    mode === "blocker" && subject.dependencyIds.length > 0 && onRemoveBlocker;
  const currentParent =
    subject.parentId === null
      ? null
      : (fetched.find((task) => task.id === subject.parentId) ?? null);
  const currentParentTitle = currentParent ? currentParent.title : null;
  const blockers = useMemo(() => {
    if (!showRemoveBlocker) return [];
    return subject.dependencyIds.map((id) => {
      const blocker = fetched.find((task) => task.id === id) ?? null;
      return { id, task: blocker, title: blocker ? blocker.title : null };
    });
  }, [showRemoveBlocker, subject.dependencyIds, fetched]);

  return (
    <CommandDialog
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
          {showRemoveBlocker && onRemoveBlocker ? (
            <CommandGroup>
              {blockers.map((blocker) => (
                <CommandItem
                  key={`remove-${blocker.id}`}
                  value={`Remove blocker ${blocker.title ?? ""} ${blocker.id}`}
                  keywords={["remove", "unblock", "clear", blocker.title ?? ""]}
                  onSelect={() => onRemoveBlocker(blocker.id)}
                >
                  <Link2Off aria-hidden="true" className="text-muted-foreground" />
                  {blocker.task ? <TaskStatusDisplay task={blocker.task} /> : null}
                  <span className="font-medium">Remove blocker</span>
                  {blocker.title ? (
                    <span className="truncate text-muted-foreground">{blocker.title}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={groupHeading}>
            {candidates.map((task) => {
              const displayTitle = task.title;
              const variant = (duplicateTitles.get(displayTitle) ?? 0) > 1 ? "full" : "compact";
              return (
                <CommandItem
                  key={task.id}
                  value={`${displayTitle} ${task.id}`}
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
    </CommandDialog>
  );
}
