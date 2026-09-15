import { Fragment, useRef, type ReactElement } from "react";
import {
  ArrowDownUp,
  Circle,
  CircleHelp,
  CirclePause,
  CornerDownRight,
  FileText,
  Flag,
  Folder,
  Link2,
  ListChecks,
  ListChevronsUpDown,
  ListFilter,
  ListPlus,
  MoveLeft,
  Palette,
  SaveCheck,
  Search,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
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
  action?: "open-settings" | "add-blocker" | "move-under" | "pause-task" | "new-task" | "new-child-task" | "filter-category" | "filter-status" | "filter-priority" | "filter-tags" | "filter-search" | "undo-status";
};

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Task actions",
    entries: [
      { label: "New task", hint: "Shared create/edit dialog", icon: ListPlus, keys: ["C"], action: "new-task", keywords: "c create new add task capture dialog" },
      { label: "New child task", hint: "Use the selected task as parent", icon: CornerDownRight, keys: ["Shift", "C"], action: "new-child-task", keywords: "shift c create child subtask parent selected task capture" },
      { label: "Set task priority", hint: "Focus Priority in dialog", icon: Flag, keys: ["0", "1", "2", "3", "4", "←", "→"], keywords: "dialog composer create edit set choose task priority p0 p1 p2 p3 p4 arrow left right" },
      { label: "Save from the dialog", icon: SaveCheck, keys: ["Enter"], keywords: "enter save create edit title" },
      { label: "Change task status", hint: "Space forward, Shift+Space back", icon: ListChecks, keys: ["Space", "Shift+Space"], keywords: "space shift space reverse backward open in progress done status cycle complete" },
      { label: "Pause or resume task", hint: "P pauses, again resumes", icon: CirclePause, keys: ["P"], action: "pause-task", keywords: "p pause resume sleep park soft cancel paused in progress" },
      { label: "Undo status change", hint: "Restore the last status", icon: Undo2, keys: ["Ctrl/⌘", "Z"], action: "undo-status", keywords: "ctrl cmd z undo status restore revert cancel complete" },
      { label: "Set active task priority", hint: "0-4 on the list", icon: Flag, keys: ["0", "1", "2", "3", "4"], keywords: "0 1 2 3 4 p0 p1 p2 p3 p4 set active task priority number" },
      { label: "Switch active or inactive", hint: "F then S", icon: Circle, keys: ["F", "S"], action: "filter-status", keywords: "f s active inactive filter paused done canceled cancelled show hide toggle" },
      { label: "Exact status", hint: "F then O I D P X", icon: Circle, keys: ["F", "O/I/D/P/X"], action: "filter-status", keywords: "f exact open in progress done paused canceled o i d p x status" },
      { label: "Priority filter", hint: "F then 0-4, same key clears", icon: Flag, keys: ["F", "0-4"], action: "filter-priority", keywords: "f 0 1 2 3 4 p0 p1 p2 p3 p4 priority flag filter" },
      { label: "Show unblocked tasks", icon: ShieldCheck, keys: ["F", "U"], keywords: "f u unblocked ready available no blockers dependency depends prerequisite" },
      { label: "Filter by category", hint: "@ opens; F then C also works", icon: Folder, keys: ["@", "F → C"], action: "filter-category", keywords: "@ f c category folder filter" },
      { label: "Filter by tags", hint: "# opens; F then T also works, Space picks, Enter closes", icon: Tags, keys: ["#", "F → T"], action: "filter-tags", keywords: "# f t tags filter clear multi and" },
      { label: "Search tasks", hint: "/ opens, titles and notes", icon: Search, keys: ["/"], action: "filter-search", keywords: "slash search find title description fts query" },
      { label: "Filter shortcuts", hint: "F focuses toolbar; F again closes", icon: ListFilter, keys: ["F"], keywords: "f filter mode preset exact status priority category tags unblocked focus close toggle" },
      { label: "Sort tasks", hint: "S focuses toolbar; R reverses date direction", icon: ArrowDownUp, keys: ["S", "C/U/M/R"], keywords: "s order sort created updated manual reverse newest oldest direction focus close toggle" },
      { label: "Select a task range", hint: "Shift+keys or Shift/Ctrl-click", icon: ListChecks, keys: ["Shift+↑/↓", "Shift+Home/End"], keywords: "shift selection range sibling group multiselect pointer mouse click" },
      { label: "Move selected tasks", hint: "Manual order; Ctrl/⌘+keys", icon: ArrowDownUp, keys: ["Ctrl/⌘+↑/↓", "Ctrl/⌘+Home/End"], keywords: "manual reorder move selected group beginning end up down" },
      { label: "Show task details", hint: "Descriptions and timestamps", icon: ListChevronsUpDown, keys: ["V"], keywords: "v view details description notes timestamps created updated time footer today yesterday date" },
      { label: "Add blocker", icon: Link2, keys: ["B"], action: "add-blocker", keywords: "b blocked by dependency depends prerequisite" },
      { label: "Move under…", icon: CornerDownRight, keys: ["M"], action: "move-under", keywords: "m move under parent child hierarchy subtask" },
      { label: "Cancel task", hint: "Delete cancels immediately", icon: Trash2, keys: ["Delete"], keywords: "delete remove cancel cancelled status immediate" },
    ],
  },
  {
    heading: "Navigation",
    entries: [
      { label: "Move backward in dialogs", icon: MoveLeft, keys: ["Shift", "Tab"], keywords: "shift tab backwards dialog fields" },
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
      { label: "Close or go back", hint: "Esc returns from toolbar; F/S also closes it", icon: Undo2, keys: ["Esc", "F/S"], keywords: "escape palette toolbar focus title notes list edit reset clear filters mode close toggle" }
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

export function HelpPalette({ open, onOpenChange, finalFocus, onOpenSettings, onCreate, onCreateChild, onOpenCategoryPicker, onOpenStatusMenu, onOpenPriorityMenu, onOpenTagPicker, onOpenSearch, activeTask, onAddBlocker, onMoveUnder, onPauseTask, canUndoStatus, onUndoStatus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  onOpenSettings: () => void;
  onCreate: () => void;
  onCreateChild?: (task: TaskRecord) => void;
  onOpenCategoryPicker: () => void;
  onOpenStatusMenu: () => void;
  onOpenPriorityMenu: () => void;
  onOpenTagPicker: () => void;
  onOpenSearch: () => void;
  activeTask?: TaskRecord;
  onAddBlocker?: (task: TaskRecord) => void;
  onMoveUnder?: (task: TaskRecord) => void;
  onPauseTask?: (task: TaskRecord) => void;
  canUndoStatus?: boolean;
  onUndoStatus?: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Shortcuts and syntax</DialogTitle>
        <DialogDescription>Keyboard help, @categories and #tags.</DialogDescription>
      </DialogHeader>
      <DialogContent
        data-command
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
     >
        <Command label="Search shortcuts and syntax" filter={literalWordScore} loop>
          <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
          <CommandList label="Help results">
            <CommandEmpty>No matches. Try “Tab”, “@”, or “#”.</CommandEmpty>
            {helpGroups.map((group, groupIndex) => (
              <Fragment key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    const onSelect = entry.action === "open-settings"
                      ? onOpenSettings
                      : entry.action === "undo-status"
                        ? (canUndoStatus && onUndoStatus ? onUndoStatus : undefined)
                      : entry.action === "new-task"
                        ? onCreate
                        : entry.action === "new-child-task" && activeTask && onCreateChild
                          ? () => onCreateChild(activeTask)
                          : entry.action === "filter-category"
                          ? onOpenCategoryPicker
                          : entry.action === "filter-status"
                            ? onOpenStatusMenu
                            : entry.action === "filter-priority"
                              ? onOpenPriorityMenu
                              : entry.action === "filter-tags"
                                ? onOpenTagPicker
                                : entry.action === "filter-search"
                                  ? onOpenSearch
                                  : entry.action === "add-blocker" && activeTask && onAddBlocker
                                    ? () => onAddBlocker(activeTask)
                                    : entry.action === "pause-task" && activeTask && onPauseTask
                                      ? () => onPauseTask(activeTask)
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
                          <CommandShortcut data-keys>
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
