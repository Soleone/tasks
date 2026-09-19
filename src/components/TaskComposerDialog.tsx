import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import type { TaskRecord } from "@/backend/protocol";
import type { TaskMutationResult } from "@/platform/backendClient";
import { TaskComposer } from "@/components/TaskComposer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ComposerState =
  | { mode: "create"; parentId?: string; initialTitle?: string }
  | { mode: "edit"; task: TaskRecord };

type TaskComposerDialogProps = {
  composer: ComposerState | null;
  onClose: () => void;
  onSaved: (result: TaskMutationResult) => void;
  finalFocus: () => HTMLElement | undefined;
  helpMode: boolean;
};

// One dialog for both create and edit so the two flows stay connected.
// Both flows close after save and return to the task list.
export function TaskComposerDialog({ composer, onClose, onSaved, finalFocus, helpMode }: TaskComposerDialogProps): ReactElement {
  const titleInput = useRef<HTMLInputElement>(null);
  const open = composer !== null;
  const task = composer?.mode === "edit" ? composer.task : undefined;
  const parentId = composer?.mode === "create" ? composer.parentId : undefined;
  const initialTitle = composer?.mode === "create" ? composer.initialTitle : undefined;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => titleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, task?.id, parentId]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        className="overflow-y-auto lg:overflow-visible sm:max-w-md"
        initialFocus={titleInput as RefObject<HTMLElement>}
        finalFocus={finalFocus}
        onKeyDownCapture={(event) => {
          if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>Use @category and #tags in the title.</DialogDescription>
        </DialogHeader>
        {composer ? (
          <TaskComposer
            key={task ? task.id : `create-${parentId ?? "root"}`}
            task={task}
            initialTitle={initialTitle}
            parentId={parentId}
            titleInputRef={titleInput}
            onSaved={onSaved}
            onCancel={onClose}
            helpMode={helpMode}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
