import type { ReactElement } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const STARTER_SHORTCUTS = [
  { keys: ["C"], label: "New task" },
  { keys: ["F"], label: "Filter tasks" },
  { keys: ["S"], label: "Sort tasks" },
  { keys: ["V"], label: "Show task details" },
  { keys: ["@"], label: "Filter by category" },
  { keys: ["Alt", "T"], label: "Choose a theme" },
];

export function StarterHelp({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  if (!open) return null;

  return (
    <aside
      aria-labelledby="starter-help-title"
      aria-modal="false"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l bg-card p-5 text-card-foreground shadow-xl"
      data-starter-help
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="starter-help-title" className="text-lg font-semibold">Getting started</h2>
          <p className="mt-1 text-sm text-muted-foreground">The shortcuts you need to begin.</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close help">
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-6 space-y-1" aria-label="Starter shortcuts">
        {STARTER_SHORTCUTS.map((shortcut) => (
          <div key={shortcut.label} className="flex items-center justify-between gap-4 rounded-md px-2 py-2.5 text-sm">
            <span>{shortcut.label}</span>
            <KbdGroup>
              {shortcut.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
            </KbdGroup>
          </div>
        ))}
      </div>
    </aside>
  );
}
