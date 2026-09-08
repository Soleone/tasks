import { useRef, useState, type ReactElement } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { BackendCommandError, deleteTask } from "@/platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TaskDeleteDialogProps = {
  task: TaskRecord;
  open: boolean;
  onClose: () => void;
  onDeleted: (task: TaskRecord) => void;
  returnFocus: () => HTMLElement | undefined;
};

export function TaskDeleteDialog({ task, open, onClose, onDeleted, returnFocus }: TaskDeleteDialogProps): ReactElement {
  const confirmButton = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);
  const receipt = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    if (deleting.current) return;
    deleting.current = true;
    setPending(true);
    setError(null);
    try {
      await deleteTask(task.id, task.version, { idempotencyKey: receipt.current });
      onDeleted(task);
      onClose();
    } catch (caught) {
      setError(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? "This task changed elsewhere. Cancel and return to the refreshed list before deleting it."
        : caught instanceof Error ? caught.message : String(caught));
    } finally {
      deleting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !deleting.current) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto"
        initialFocus={confirmButton}
        finalFocus={returnFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229)) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete task?</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            “{task.title}” and its activity history will be deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">
          <AlertTitle>Could not delete task</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert> : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button ref={confirmButton} focusableWhenDisabled disabled={pending} onClick={() => void confirmDelete()}>
            {pending ? "Deleting…" : "Delete task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
