import type { ReactElement } from "react";
import { X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { preventFocusSteal } from "@/navigation";
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

type ShortcutGroup = {
  id: string;
  label: string;
  options: ShortcutOption[];
};

type ModeGuide = {
  title: string;
  description: string;
  closeKey: string;
  groups: ShortcutGroup[];
};

const MODE_GUIDES: Record<TaskListMode, ModeGuide> = {
  filter: {
    title: "Filter",
    description: "Choose a filter option, or press F or Escape to return to the task list.",
    closeKey: "F",
    groups: [
      {
        id: "status",
        label: "Status",
        options: [
          { id: "status-preset", label: "Active / inactive", keys: ["S"] },
          { id: "open", label: "Open", keys: ["O"] },
          { id: "in-progress", label: "In progress", keys: ["I"] },
          { id: "done", label: "Done", keys: ["D"] },
          { id: "paused", label: "Paused", keys: ["P"] },
          { id: "canceled", label: "Canceled", keys: ["X"] },
        ],
      },
      {
        id: "more",
        label: "More filters",
        options: [
          { id: "priority", label: "Priority", keys: ["0–4"] },
          { id: "category", label: "Category", keys: ["C"] },
          { id: "tags", label: "Tags", keys: ["T"] },
          { id: "unblocked", label: "Unblocked", keys: ["U"] },
        ],
      },
    ],
  },
  sort: {
    title: "Sort",
    description: "Choose a sort option, or press S or Escape to return to the task list.",
    closeKey: "S",
    groups: [
      {
        id: "order",
        label: "Order",
        options: [
          { id: "created", label: "Created", keys: ["C"] },
          { id: "updated", label: "Updated", keys: ["U"] },
          { id: "priority", label: "Priority", keys: ["P"] },
          { id: "manual", label: "Manual order", keys: ["M"] },
          { id: "reverse", label: "Reverse sort direction", keys: ["R"] },
        ],
      },
    ],
  },
};

export function TaskListModeHelp({
  mode,
  onDismiss,
  onDisableHelp,
}: {
  mode: TaskListMode;
  onDismiss: () => void;
  onDisableHelp: () => void;
}): ReactElement {
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
        render={
          <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
        }
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
        density="guide"
      >
        <PopoverHeader inline>
          <PopoverTitle>{guide.title}</PopoverTitle>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <KbdGroup>
              <Kbd data-shortcut-key={guide.closeKey}>{guide.closeKey}</Kbd>
              <span aria-hidden="true">or</span>
              <Kbd data-shortcut-key="Escape">Esc</Kbd>
            </KbdGroup>
            <span>close</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-label="Disable keyboard help"
              title="Disable keyboard help"
              onMouseDown={preventFocusSteal}
              onClick={onDisableHelp}
            >
              <X aria-hidden="true" />
            </Button>
          </span>
        </PopoverHeader>
        <PopoverDescription className="sr-only">{guide.description}</PopoverDescription>
        <div className="flex flex-col gap-2.5">
          {guide.groups.map((group, groupIndex) => (
            <div
              key={group.id}
              data-shortcut-group={group.id}
              className={cn(groupIndex > 0 && "border-t border-border/60 pt-2.5")}
            >
              <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {group.options.map((option) => (
                  <span
                    key={option.id}
                    data-shortcut-option={option.id}
                    className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs"
                  >
                    <KbdGroup>
                      {option.keys.map((key) => (
                        <Kbd key={key} data-shortcut-key={key}>
                          {key}
                        </Kbd>
                      ))}
                    </KbdGroup>
                    <span className="truncate text-muted-foreground">{option.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
