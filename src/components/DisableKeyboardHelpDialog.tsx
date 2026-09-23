import type { ReactElement } from "react";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DisableHelpMode = Extract<KeyboardHelpMode, "basic" | "none">;

export function DisableKeyboardHelpDialog({ open, mode, onOpenChange, onConfirm, finalFocus }: {
  open: boolean;
  mode: DisableHelpMode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  finalFocus: () => HTMLElement | undefined;
}): ReactElement {
  const keepsShortcutGuides = mode === "basic";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{keepsShortcutGuides ? "Hide task editor help?" : "Disable keyboard help?"}</DialogTitle>
          <DialogDescription>
            {keepsShortcutGuides
              ? "Task editors will stop showing contextual help, while filter and sort shortcut help remains visible. Restore Full anytime in Settings → General → Keyboard help."
              : "This will hide all automatic keyboard help. Re-enable it anytime by choosing Full or Basic in Settings → General → Keyboard help."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" data-disable-help-cancel onClick={() => onOpenChange(false)}>Keep help</Button>
          <Button variant={keepsShortcutGuides ? "default" : "destructive"} data-disable-help-confirm onClick={onConfirm}>{keepsShortcutGuides ? "Use basic help" : "Disable help"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
