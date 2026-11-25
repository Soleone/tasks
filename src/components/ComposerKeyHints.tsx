import type { ReactElement } from "react";
import { KeyHintButton } from "@/components/variants/button";

// The editor's mouse fallbacks, each labeled with the key that does the same.
export function ComposerKeyHints({
  pending,
  notesOpen,
  saveKeys,
  saveName,
  onCancel,
  onAddDescription,
  onPointerSave,
}: {
  pending: boolean;
  notesOpen: boolean;
  saveKeys: string;
  saveName: string;
  onCancel: () => void;
  onAddDescription: () => void;
  onPointerSave: () => void;
}): ReactElement {
  return (
    <div className="-my-0.5 ml-auto flex items-center justify-end gap-0.5 motion-safe:animate-in motion-safe:fade-in @max-md:order-last @max-md:basis-full">
      <KeyHintButton keys="Esc" disabled={pending} onClick={onCancel} tabIndex={-1} type="button">
        Cancel
      </KeyHintButton>
      {!notesOpen ? (
        <KeyHintButton
          keys="Tab"
          aria-label="Add description"
          onClick={onAddDescription}
          tabIndex={-1}
          type="button"
        >
          Description
        </KeyHintButton>
      ) : null}
      <KeyHintButton
        keys={saveKeys}
        aria-label={saveName}
        disabled={pending}
        onClick={onPointerSave}
        tabIndex={-1}
        type="submit"
      >
        {pending ? "Saving…" : "Save"}
      </KeyHintButton>
    </div>
  );
}
