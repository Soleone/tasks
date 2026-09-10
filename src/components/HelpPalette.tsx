import { Fragment, useRef, type ReactElement } from "react";
import {
  CircleHelp,
  CornerDownRight,
  FileText,
  Folder,
  Link2,
  ListChecks,
  ListFilter,
  ListPlus,
  MoveLeft,
  MoveRight,
  Palette,
  SaveCheck,
  Settings2,
  Tags,
  Trash2,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { TaskRecord } from "@/backend/protocol";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, literalWordScore } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

type HelpEntry = {
  label: string;
  hint?: string;
  icon: LucideIcon;
  keys?: string[];
  keywords?: string;
  /** Entries the palette runs itself, rather than explaining. */
  action?: "open-settings" | "add-blocker" | "move-under" | "new-task";
};

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Task actions",
    entries: [
      { label: "New task", hint: "Shared create/edit dialog", icon: ListPlus, keys: ["C"], action: "new-task", keywords: "c create new add task capture dialog" },
      { label: "Save from the dialog", icon: SaveCheck, keys: ["Enter"], keywords: "enter save create edit title" },
      { label: "Change task status", icon: ListChecks, keys: ["Space"], keywords: "space open in progress paused done status cycle" },
      { label: "Switch active or inactive", icon: ListFilter, keys: ["A"], keywords: "a active inactive filter paused canceled cancelled show hide" },
      { label: "Show unblocked tasks", icon: TriangleAlert, keys: ["U"], keywords: "u unblocked ready available no blockers dependency depends prerequisite" },
      { label: "Add blocker", icon: Link2, keys: ["B"], action: "add-blocker", keywords: "b blocked by dependency depends prerequisite" },
      { label: "Move under…", icon: CornerDownRight, keys: ["M"], action: "move-under", keywords: "m move under parent child hierarchy subtask" },
      { label: "Cancel task", icon: Trash2, keys: ["Delete"], keywords: "delete remove cancel cancelled status confirmation enter escape" },
    ],
  },
  {
    heading: "Navigation",
    entries: [
      { label: "New task or list", icon: MoveRight, keys: ["Tab"], keywords: "tab cycle new button list" },
      { label: "Previous field", icon: MoveLeft, keys: ["Shift", "Tab"], keywords: "shift backwards cycle" },
      { label: "Move through tasks", icon: ListChecks, keys: ["↑", "↓", "Home", "End"], keywords: "arrow keys up down first last highlight list" },
      { label: "Expand or collapse children", icon: ListChecks, keys: ["←", "→"], keywords: "left right arrow child children parent subtask hierarchy" },
    ],
  },
  {
    heading: "Workspace",
    entries: [
      { label: "Settings", hint: "Storage and export", icon: Settings2, action: "open-settings", keywords: "data export json sqlite database storage path" },
      { label: "Themes", hint: "Workspace appearance", icon: Palette, keys: ["Alt", "T"], keywords: "alt theme colour color dark light accent palette" },
      { label: "Toggle this palette", icon: CircleHelp, keys: ["Ctrl/⌘", "K"], keywords: "ctrl cmd open close help syntax" },
      { label: "Close or go back", icon: Undo2, keys: ["Esc"], keywords: "escape palette focus title notes list edit" },
    ],
  },
  {
    heading: "Syntax",
    entries: [
      { label: "@category", hint: "One per task", icon: Folder, keywords: "@launch people mentions title description" },
      { label: "#tags", hint: "Any number of tags", icon: Tags, keywords: "#planning #calls title description" },
      { label: "Names & Markdown", hint: "Letters, numbers, _ -", icon: FileText, keywords: "case heading code backtick rendered text" },
    ],
  },
];

/** Search text that never shows up in the row but should still find it. */
function entryKeywords(entry: HelpEntry): string[] {
  return [entry.hint, entry.keys?.join(" "), entry.keywords].filter((part): part is string => Boolean(part));
}

export function HelpPalette({ open, onOpenChange, finalFocus, onOpenSettings, onCreate, activeTask, onAddBlocker, onMoveUnder }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  onOpenSettings: () => void;
  onCreate: () => void;
  activeTask?: TaskRecord;
  onAddBlocker?: (task: TaskRecord) => void;
  onMoveUnder?: (task: TaskRecord) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Shortcuts and syntax</DialogTitle>
        <DialogDescription>Keyboard help, @categories and #tags.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
      >
        <Command label="Search shortcuts and syntax" filter={literalWordScore} loop>
          <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
          <CommandList label="Help results">
            <CommandEmpty>No matches. Try “Tab” or “@”.</CommandEmpty>
            {helpGroups.map((group, groupIndex) => (
              <Fragment key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    const onSelect = entry.action === "open-settings"
                      ? onOpenSettings
                      : entry.action === "new-task"
                        ? onCreate
                        : entry.action === "add-blocker" && activeTask && onAddBlocker
                        ? () => onAddBlocker(activeTask)
                        : entry.action === "move-under" && activeTask && onMoveUnder
                          ? () => onMoveUnder(activeTask)
                          : undefined;
                    return (
                      <CommandItem
                        key={entry.label}
                        value={`${group.heading} ${entry.label}`}
                        keywords={entryKeywords(entry)}
                        onSelect={onSelect}
                      >
                        <Icon aria-hidden="true" />
                        <span className="font-medium">{entry.label}</span>
                        {entry.hint ? <span className="text-muted-foreground">{entry.hint}</span> : null}
                        {entry.keys ? (
                          <CommandShortcut className="flex shrink-0 items-center tracking-normal">
                            <KbdGroup>
                              {entry.keys.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </KbdGroup>
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
