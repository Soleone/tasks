import { useRef, type ReactElement, type RefObject } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskComposer } from "@/components/TaskComposer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ComposerState =
  | { mode: "create" }
  | { mode: "edit"; task: TaskRecord };

type TaskComposerDialogProps = {
  composer: ComposerState | null;
  onClose: () => void;
  onSaved: (task: TaskRecord) => void;
  finalFocus: () => HTMLElement | undefined;
};

// One dialog for both create and edit so the two flows stay connected.
// Create stays open after save for rapid capture; edit closes on save.
export function TaskComposerDialog({ composer, onClose, onSaved, finalFocus }: TaskComposerDialogProps): ReactElement {
  const titleInput = useRef<HTMLInputElement>(null);
  const open = composer !== null;
  const task = composer?.mode === "edit" ? composer.task : undefined;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        className="overflow-y-auto sm:max-w-md"
        initialFocus={titleInput as RefObject<HTMLElement>}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>Use @category and #tags in the title.</DialogDescription>
        </DialogHeader>
        {composer ? (
          <TaskComposer
            key={task ? task.id : "create"}
            task={task}
            titleInputRef={titleInput}
            onSaved={onSaved}
            onCancel={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
