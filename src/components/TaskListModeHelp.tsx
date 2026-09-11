import type { ReactElement } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export type TaskListMode = "filter" | "sort";

type ShortcutOption = {
  id: string;
  label: string;
  keys: string[];
};

type ModeGuide = {
  title: string;
  instruction: string;
  options: ShortcutOption[];
};

const MODE_GUIDES: Record<TaskListMode, ModeGuide> = {
  filter: {
    title: "Filter tasks",
    instruction: "Choose a filter",
    options: [
      { id: "status-preset", label: "Active / inactive", keys: ["S"] },
      { id: "open", label: "Open", keys: ["O"] },
      { id: "in-progress", label: "In progress", keys: ["I"] },
      { id: "done", label: "Done", keys: ["D"] },
      { id: "paused", label: "Paused", keys: ["P"] },
      { id: "canceled", label: "Canceled", keys: ["X"] },
      { id: "priority", label: "Priority", keys: ["0", "1", "2", "3", "4"] },
      { id: "category", label: "Category", keys: ["C"] },
      { id: "tags", label: "Tags", keys: ["T"] },
      { id: "unblocked", label: "Unblocked", keys: ["U"] },
    ],
  },
  sort: {
    title: "Sort tasks",
    instruction: "Choose a sort",
    options: [
      { id: "created", label: "Created", keys: ["C"] },
      { id: "updated", label: "Updated", keys: ["U"] },
      { id: "reverse", label: "Reverse direction", keys: ["R"] },
    ],
  },
};

export function TaskListModeHelp({ mode }: { mode: TaskListMode }): ReactElement {
  const guide = MODE_GUIDES[mode];

  return (
    <div
      data-shortcut-guide={mode}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-150 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-start min-[480px]:gap-x-3"
    >
      <div className="flex items-center gap-2 min-[480px]:shrink-0">
        <span className="font-medium text-foreground">{guide.title}</span>
        <span className="text-muted-foreground">{guide.instruction}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-[480px]:min-w-0 min-[480px]:flex-1">
        {guide.options.map((option) => (
          <span
            key={option.id}
            data-shortcut-option={option.id}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <KbdGroup>
              {option.keys.map((key) => (
                <Kbd key={key} data-shortcut-key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
            <span className="text-muted-foreground">{option.label}</span>
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground min-[480px]:shrink-0">
        <Kbd data-shortcut-key="Escape">Esc</Kbd>
        <span>cancel</span>
      </span>
    </div>
  );
}
