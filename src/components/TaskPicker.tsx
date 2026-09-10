import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link2Off } from "lucide-react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskRow, TaskStatusDisplay, taskTitleDisplay } from "@/components/TaskRow";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, literalWordScore } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listTasks } from "@/platform/backendClient";

export type TaskPickerMode = "blocker" | "move";

const PICKER_LIMIT = 100;

function collectDescendantIds(candidates: TaskRecord[], rootId: string): Set<string> {
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

function pickerCandidates(all: TaskRecord[], subject: TaskRecord, mode: TaskPickerMode): TaskRecord[] {
  if (mode === "blocker") {
    const blocked = new Set(subject.blockedByIds);
    return all.filter((task) => task.id !== subject.id && !blocked.has(task.id));
  }
  const descendants = collectDescendantIds(all, subject.id);
  return all.filter((task) =>
    task.id !== subject.id
    && !descendants.has(task.id)
    && task.id !== subject.parentId
    && task.parentId === null,
  );
}

export function TaskPicker({ open, mode, subject, onClose, finalFocus, onSelect, onRemoveBlocker }: {
  open: boolean;
  mode: TaskPickerMode;
  subject: TaskRecord;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  onSelect: (target: TaskRecord) => void;
  onRemoveBlocker?: (blockerId: string) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const [fetched, setFetched] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Bounded candidate set; the backend stays authoritative on cycles and
    // duplicates the picker cannot see past the limit.
    listTasks(undefined, 0)
      .then((result) => {
        if (cancelled) return;
        setFetched(result.tasks.slice(0, PICKER_LIMIT));
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
      const title = taskTitleDisplay(task.title);
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  }, [candidates]);

  const heading = mode === "blocker" ? `Blocked by: ${taskTitleDisplay(subject.title)}` : `Move ${taskTitleDisplay(subject.title)} under…`;
  const groupHeading = mode === "blocker" ? "Select blocker" : "Select new parent";
  const emptyText = loading ? "Loading tasks…" : error ?? "No matching tasks.";
  const showRemoveBlocker = mode === "blocker" && subject.blockedByIds.length > 0 && onRemoveBlocker;
  const blockers = useMemo(() => {
    if (!showRemoveBlocker) return [];
    return subject.blockedByIds.map((id) => {
      const blocker = fetched.find((task) => task.id === id) ?? null;
      return { id, title: blocker ? taskTitleDisplay(blocker.title) : null };
    });
  }, [showRemoveBlocker, subject.blockedByIds, fetched]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogHeader className="sr-only">
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>
          {mode === "blocker"
            ? showRemoveBlocker
              ? "Remove the current blocker, or search tasks and press Enter to mark this task blocked by the selected task."
              : "Search tasks and press Enter to mark this task blocked by the selected task."
            : "Search tasks and press Enter to move this task under the selected task."}
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
      >
        <Command label={heading} filter={literalWordScore} loop>
          <CommandInput ref={searchInput} placeholder="Search tasks…" />
          <CommandList label="Task results">
            <CommandEmpty>{emptyText}</CommandEmpty>
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
                    <span className="font-medium">Remove blocker</span>
                    {blocker.title ? <span className="truncate text-muted-foreground">{blocker.title}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading={groupHeading}>
              {candidates.map((task) => {
                const displayTitle = taskTitleDisplay(task.title);
                const variant = (duplicateTitles.get(displayTitle) ?? 0) > 1 ? "full" : "compact";
                return (
                  <CommandItem
                    key={task.id}
                    value={`${displayTitle} ${task.id}`}
                    keywords={[task.descriptionMarkdown, task.status]}
                    onSelect={() => onSelect(task)}
                  >
                    <TaskRow task={task} variant={variant} statusSlot={<TaskStatusDisplay task={task} />} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
