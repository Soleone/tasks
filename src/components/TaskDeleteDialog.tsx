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
  onCanceled: (task: TaskRecord) => void;
  returnFocus: () => HTMLElement | undefined;
};

export function TaskDeleteDialog({ task, open, onClose, onCanceled, returnFocus }: TaskDeleteDialogProps): ReactElement {
  const confirmButton = useRef<HTMLButtonElement>(null);
  const canceling = useRef(false);
  const receipt = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmCancel(): Promise<void> {
    if (canceling.current) return;
    canceling.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await deleteTask(task.id, task.version, { idempotencyKey: receipt.current });
      onCanceled(result.task);
      onClose();
    } catch (caught) {
      setError(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? "This task changed elsewhere. Close this dialog and return to the refreshed list before cancelling it."
        : caught instanceof Error ? caught.message : String(caught));
    } finally {
      canceling.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !canceling.current) onClose(); }}>
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
          <DialogTitle>Cancel task?</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            “{task.title}” will be marked cancelled. You can reopen it later.
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">
          <AlertTitle>Could not cancel task</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert> : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Keep task</Button>
          <Button ref={confirmButton} focusableWhenDisabled disabled={pending} onClick={() => void confirmCancel()}>
            {pending ? "Cancelling…" : "Cancel task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
