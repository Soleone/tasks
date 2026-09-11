import type { ReactElement } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export type TaskListMode = "filter" | "sort";

type ShortcutOption = {
  id: string;
  label: string;
  keys: string[];
};

type ModeGuide = {
  title: string;
  description: string;
  options: ShortcutOption[];
};

const MODE_GUIDES: Record<TaskListMode, ModeGuide> = {
  filter: {
    title: "Filter",
    description: "Choose a filter option.",
    options: [
      { id: "status-preset", label: "Active / inactive", keys: ["S"] },
      { id: "open", label: "Open", keys: ["O"] },
      { id: "in-progress", label: "In progress", keys: ["I"] },
      { id: "done", label: "Done", keys: ["D"] },
      { id: "paused", label: "Paused", keys: ["P"] },
      { id: "canceled", label: "Canceled", keys: ["X"] },
      { id: "priority", label: "Priority", keys: ["0–4"] },
      { id: "category", label: "Category", keys: ["C"] },
      { id: "tags", label: "Tags", keys: ["T"] },
      { id: "unblocked", label: "Unblocked", keys: ["U"] },
    ],
  },
  sort: {
    title: "Sort",
    description: "Choose a sort option.",
    options: [
      { id: "created", label: "Created", keys: ["C"] },
      { id: "updated", label: "Updated", keys: ["U"] },
      { id: "reverse", label: "Reverse", keys: ["R"] },
    ],
  },
};

export function TaskListModeHelp({ mode, onDismiss }: { mode: TaskListMode; onDismiss: () => void }): ReactElement {
  const guide = MODE_GUIDES[mode];

  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (!open && details.reason !== "focus-out") onDismiss();
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={<span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />}
      />
      <PopoverContent
        data-shortcut-guide={mode}
        role="status"
        aria-live="polite"
        side="top"
        align="end"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        className="w-[min(20rem,calc(100vw-2rem))] gap-2 p-3"
      >
        <PopoverHeader className="flex-row items-center justify-between gap-4">
          <PopoverTitle>{guide.title}</PopoverTitle>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Kbd data-shortcut-key="Escape">Esc</Kbd>
            <span>close</span>
          </span>
        </PopoverHeader>
        <PopoverDescription className="sr-only">{guide.description}</PopoverDescription>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {guide.options.map((option) => (
            <span
              key={option.id}
              data-shortcut-option={option.id}
              className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs"
            >
              <KbdGroup>
                {option.keys.map((key) => (
                  <Kbd key={key} data-shortcut-key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
              <span className="truncate text-muted-foreground">{option.label}</span>
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
