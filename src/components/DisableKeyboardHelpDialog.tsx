import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DisableKeyboardHelpDialog({ open, onOpenChange, onConfirm, finalFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  finalFocus: () => HTMLElement | undefined;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Disable keyboard help?</DialogTitle>
          <DialogDescription>
            This will hide the help popovers until you turn keyboard help back on. Re-enable it anytime in Settings → General → Keyboard help.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" data-disable-help-cancel onClick={() => onOpenChange(false)}>Keep help</Button>
          <Button variant="destructive" data-disable-help-confirm onClick={onConfirm}>Disable help</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
