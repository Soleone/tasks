import { useRef, useState, type ReactElement } from "react";
import { Split } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/variants/button";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { Tooltip } from "@/components/variants/tooltip";
import { preventFocusSteal } from "@/navigation";
import type { SyncConflict } from "@/platform/backendClient";
import { TaskRow, TaskStatusDisplay } from "./TaskRow";
import type { TaskView } from "./taskView";

const countLabel = (total: number): string =>
  total === 1 ? "1 task changed on two devices" : `${total} tasks changed on two devices`;

/** A quiet header count of the tasks sync left in two versions. Hidden at zero; opens the dialog. */
export function ConflictCount({
  total,
  onOpen,
}: {
  total: number;
  onOpen: () => void;
}): ReactElement | null {
  if (total === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            tabIndex={-1}
            aria-label={countLabel(total)}
            data-conflict-count
            onMouseDown={preventFocusSteal}
            onClick={onOpen}
          />
        }
      >
        <Split data-icon="inline-start" aria-hidden="true" className="text-warning" />
        <span className="text-warning">{total}</span>
      </TooltipTrigger>
      <TooltipContent>{countLabel(total)}. Choose which to keep</TooltipContent>
    </Tooltip>
  );
}

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** What a person would call the fields two versions disagree on, in the order a row shows them. */
function differences(a: TaskView, b: TaskView): string[] {
  const slugs = (task: TaskView) => task.tags.map((tag) => tag.slug);
  return [
    ["title", a.title === b.title],
    ["notes", a.description === b.description],
    ["status", a.status === b.status],
    ["priority", a.priority === b.priority],
    ["effort", a.effort === b.effort],
    ["category", a.category?.slug === b.category?.slug],
    ["tags", sameList(slugs(a), slugs(b))],
    ["due date", a.due === b.due],
    ["parent", a.parentId === b.parentId],
    ["blockers", sameList(a.dependencyIds, b.dependencyIds)],
    ["images", sameList(a.attachments, b.attachments)],
  ].flatMap(([label, same]) => (same ? [] : [label as string]));
}

function differenceLine(versions: SyncConflict["versions"]): string {
  const labels = [
    ...new Set(versions.slice(1).flatMap(({ task }) => differences(versions[0].task, task))),
  ];
  if (labels.length === 0) return "They differ only in when they were saved.";
  return `They differ in ${new Intl.ListFormat("en-GB", { type: "conjunction" }).format(labels)}.`;
}

/**
 * Settles one conflict at a time: each version shown as the list would show it, with a button to
 * keep it. Mounted only while a conflict is open.
 */
export function ConflictDialog({
  conflicts,
  onKeep,
  onClose,
}: {
  conflicts: SyncConflict[];
  /** Keeps that version and drops the others; rejects when the backend refuses. */
  onKeep: (conflict: SyncConflict, versionRef: string) => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict = conflicts[0];
  // Focus starts on no version, so Enter never keeps one by accident.
  const versionList = useRef<HTMLUListElement>(null);

  async function keep(versionRef: string): Promise<void> {
    setKeeping(true);
    setError(null);
    try {
      await onKeep(conflict, versionRef);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setKeeping(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnchoredDialogContent className="sm:max-w-xl" initialFocus={versionList}>
        <DialogHeader>
          <DialogTitle>
            Changed on two devices
            {conflicts.length > 1 && (
              <span className="font-normal text-muted-foreground"> · {conflicts.length} tasks</span>
            )}
          </DialogTitle>
          <DialogDescription>
            Sync kept every version of this task. Keep one, and the rest go to a recovery copy.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{differenceLine(conflict.versions)}</p>
        <ul
          ref={versionList}
          tabIndex={-1}
          className="flex flex-col gap-3 overflow-y-auto outline-none"
        >
          {conflict.versions.map(({ versionRef, task }, index) => (
            <li
              key={versionRef}
              data-conflict-version
              // Notes show in full, since they may be what differs, and the empty chevron slot goes.
              className="flex flex-col gap-2 rounded-lg border p-3 [&_[data-task-description]]:line-clamp-none [&_[data-task-disclosure]]:hidden"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {index === 0 ? "In your list" : "Set aside by sync"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={keeping}
                  onClick={() => void keep(versionRef)}
                >
                  Keep this one
                </Button>
              </div>
              <TaskRow
                task={task}
                variant="full"
                showDetails
                statusSlot={<TaskStatusDisplay task={task} />}
              />
            </li>
          ))}
        </ul>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </AnchoredDialogContent>
    </Dialog>
  );
}
