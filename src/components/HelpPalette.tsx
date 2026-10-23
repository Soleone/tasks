import { Fragment, useRef, type ReactElement } from "react";
import {
  ArrowDownUp,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleHelp,
  Copy,
  CirclePause,
  CornerDownRight,
  FileText,
  Flag,
  Folder,
  Image,
  Link2,
  ListChecks,
  ListChevronsUpDown,
  ListFilter,
  ListPlus,
  MoveLeft,
  Palette,
  Redo2,
  SaveCheck,
  Search,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { TaskView } from "./taskView";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { literalWordScore } from "@/components/commandFilter";
import { PaletteDialog, KeysShortcut } from "@/components/variants/command";

type HelpEntry = {
  label: string;
  hint?: string;
  icon: LucideIcon;
  keys?: string[];
  keywords?: string;
  /** Entries the palette runs itself, rather than explaining. */
  action?:
    | "open-settings"
    | "open-themes"
    | "toggle-done-lens"
    | "widen-done-lens"
    | "add-blocker"
    | "move-under"
    | "pause-task"
    | "new-task"
    | "new-child-task"
    | "filter-category"
    | "filter-status"
    | "filter-priority"
    | "filter-tags"
    | "filter-search"
    | "copy-task"
    | "copy-image"
    | "undo-status"
    | "redo";
};

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Task actions",
    entries: [
      {
        label: "New task",
        hint: "Inline editor",
        icon: ListPlus,
        keys: ["C"],
        action: "new-task",
        keywords: "c create new add task capture inline",
      },
      {
        label: "Edit active task",
        hint: "Inline editor",
        icon: FileText,
        keys: ["Enter"],
        keywords: "enter inline edit selected active task row",
      },
      {
        label: "New child task",
        hint: "Under the selected task",
        icon: CornerDownRight,
        keys: ["Shift", "C"],
        action: "new-child-task",
        keywords: "shift c create child subtask parent selected task capture",
      },
      {
        label: "Set task priority",
        hint: "In the inline editor",
        icon: Flag,
        keys: ["0", "1", "2", "3", "4", "←", "→"],
        keywords:
          "inline editor create edit set choose task priority p0 p1 p2 p3 p4 arrow left right",
      },
      {
        label: "Save the inline editor",
        hint: "Ctrl/⌘+Enter in the description",
        icon: SaveCheck,
        keys: ["Enter"],
        keywords: "enter ctrl cmd save create edit title description inline",
      },
      {
        label: "Change task status",
        hint: "Shift+Space goes back",
        icon: ListChecks,
        keys: ["Space"],
        keywords: "space shift space reverse backward open in progress done status cycle complete",
      },
      {
        label: "Pause or resume task",
        hint: "P pauses, again resumes",
        icon: CirclePause,
        keys: ["P"],
        action: "pause-task",
        keywords: "p pause resume sleep park soft cancel paused in progress",
      },
      {
        label: "Copy task text",
        hint: "Title, description and #tags",
        icon: Copy,
        keys: ["Ctrl/⌘", "C"],
        action: "copy-task",
        keywords:
          "ctrl cmd c copy title description clipboard selected active task category tags metadata",
      },
      {
        label: "Copy newest image",
        hint: "The image added last",
        icon: Image,
        keys: ["Ctrl/⌘", "Shift", "C"],
        action: "copy-image",
        keywords: "ctrl cmd shift c copy image picture screenshot attachment clipboard paste agent",
      },
      {
        label: "Undo last change",
        hint: "Restore the latest task change",
        icon: Undo2,
        keys: ["Ctrl/⌘", "Z"],
        action: "undo-status",
        keywords:
          "ctrl cmd z undo status change restore revert cancel complete edit move priority dependency order",
      },
      {
        label: "Redo last change",
        hint: "Ctrl/⌘+Shift+Z also works",
        icon: Redo2,
        keys: ["Ctrl", "Y"],
        action: "redo",
        keywords:
          "ctrl cmd y shift z redo reapply restore undone change task status capture edit move priority dependency order",
      },
      {
        label: "Set active task priority",
        hint: "0-4 on the list",
        icon: Flag,
        keys: ["0", "1", "2", "3", "4"],
        keywords: "0 1 2 3 4 p0 p1 p2 p3 p4 set active task priority number",
      },
      {
        label: "Switch active or inactive",
        hint: "F then S",
        icon: Circle,
        keys: ["F", "S"],
        action: "filter-status",
        keywords: "f s active inactive filter paused done canceled cancelled show hide toggle",
      },
      {
        label: "Exact status",
        hint: "F then O I D P X",
        icon: Circle,
        keys: ["F", "O/I/D/P/X"],
        action: "filter-status",
        keywords: "f exact open in progress done paused canceled o i d p x status",
      },
      {
        label: "Priority filter",
        hint: "F then 0-4, same key clears",
        icon: Flag,
        keys: ["F", "0-4"],
        action: "filter-priority",
        keywords: "f 0 1 2 3 4 p0 p1 p2 p3 p4 priority flag filter",
      },
      {
        label: "Show unblocked tasks",
        icon: ShieldCheck,
        keys: ["F", "U"],
        keywords: "f u unblocked ready available no blockers dependency depends prerequisite",
      },
      {
        label: "Filter by category",
        hint: "Also F then C",
        icon: Folder,
        keys: ["@", "F → C"],
        action: "filter-category",
        keywords: "@ f c category folder filter",
      },
      {
        label: "Filter by tags",
        hint: "Also F then T",
        icon: Tags,
        keys: ["#", "F → T"],
        action: "filter-tags",
        keywords: "# f t tags filter clear multi and",
      },
      {
        label: "Search tasks",
        hint: "Titles and notes",
        icon: Search,
        keys: ["/"],
        action: "filter-search",
        keywords: "slash search find title description fts query",
      },
      {
        label: "Filter shortcuts",
        hint: "Focus the toolbar; F again closes",
        icon: ListFilter,
        keys: ["F"],
        keywords:
          "f filter mode preset exact status priority category tags unblocked focus close toggle",
      },
      {
        label: "Sort tasks",
        hint: "Focus the toolbar; S then P by priority",
        icon: ArrowDownUp,
        keys: ["S", "C/U/P/T/M/R"],
        keywords:
          "s order sort created updated priority due date deadline time manual reverse newest oldest direction focus close toggle",
      },
      {
        label: "Select a task range",
        hint: "Or Shift/Ctrl-click",
        icon: ListChecks,
        keys: ["Shift+↑/↓", "Shift+Home/End"],
        keywords: "shift selection range sibling group multiselect pointer mouse click",
      },
      {
        label: "Move selected tasks",
        hint: "In manual order",
        icon: ArrowDownUp,
        keys: ["Ctrl/⌘+↑/↓", "Ctrl/⌘+Home/End"],
        keywords: "manual reorder move selected group beginning end up down",
      },
      {
        label: "Show details of the active task",
        hint: "Descriptions and timestamps",
        icon: ListChevronsUpDown,
        keys: ["V"],
        keywords:
          "v view details description notes timestamps created updated time footer today yesterday date",
      },
      {
        label: "Show details of all tasks",
        hint: "Descriptions and timestamps",
        icon: ListChevronsUpDown,
        keys: ["Shift+V"],
        keywords:
          "v view details description notes timestamps created updated time footer today yesterday date everything",
      },
      {
        label: "Add blocker",
        icon: Link2,
        keys: ["B"],
        action: "add-blocker",
        keywords: "b blocked by dependency depends prerequisite",
      },
      {
        label: "Move under…",
        icon: CornerDownRight,
        keys: ["M"],
        action: "move-under",
        keywords: "m move under parent child hierarchy subtask",
      },
      {
        label: "Cancel task",
        hint: "Delete cancels immediately",
        icon: Trash2,
        keys: ["Delete"],
        keywords: "delete remove cancel cancelled status immediate",
      },
    ],
  },
  {
    heading: "Navigation",
    entries: [
      {
        label: "Move backward in dialogs",
        icon: MoveLeft,
        keys: ["Shift", "Tab"],
        keywords: "shift tab backwards dialog fields",
      },
      {
        label: "Move through tasks",
        icon: ListChecks,
        keys: ["↑", "↓", "Home", "End"],
        keywords: "arrow keys up down first last highlight list",
      },
      {
        label: "Navigate task hierarchy or category",
        hint: "Right filters category first",
        icon: ListChecks,
        keys: ["←", "→"],
        keywords: "left right arrow child children parent subtask hierarchy category filter",
      },
      {
        label: "Filter a task by category",
        hint: "Right on a task without a filter",
        icon: Folder,
        keys: ["→"],
        keywords: "right arrow task parent leaf category filter children",
      },
    ],
  },
  {
    heading: "Workspace",
    entries: [
      {
        label: "Settings",
        hint: "Storage and export",
        icon: Settings2,
        keys: ["Ctrl/⌘", ","],
        action: "open-settings",
        keywords: "ctrl cmd comma data export json sqlite database storage path",
      },
      {
        label: "Themes",
        hint: "Choose appearance",
        action: "open-themes",
        icon: Palette,
        keys: ["Alt", "T"],
        keywords: "alt theme colour color dark light accent palette",
      },
      {
        label: "Done today",
        hint: "Done in the last 24 hours",
        action: "toggle-done-lens",
        icon: CircleCheck,
        keys: ["D"],
        keywords: "accomplished finished completed recent history yesterday count",
      },
      {
        label: "Look further back",
        hint: "Done in the last 7 days, then 30",
        action: "widen-done-lens",
        icon: CalendarCheck,
        keys: ["Shift", "D"],
        keywords: "accomplished finished completed week month history",
      },
      {
        label: "Toggle this palette",
        icon: CircleHelp,
        keys: ["Ctrl/⌘", "K"],
        keywords: "ctrl cmd open close help syntax",
      },
      {
        label: "Close or go back",
        hint: "Esc leaves the toolbar",
        icon: Undo2,
        keys: ["Esc", "F/S"],
        keywords:
          "escape palette toolbar focus title notes list edit reset clear filters mode close toggle",
      },
    ],
  },
  {
    heading: "Syntax",
    entries: [
      {
        label: "@category",
        hint: "One per task",
        icon: Folder,
        keywords: "@launch people mentions title description",
      },
      {
        label: "#tags",
        hint: "Any number in title",
        icon: Tags,
        keywords: "#planning #calls title",
      },
      {
        label: "^date",
        hint: "Due: ^fri ^tmr ^3d ^oct31",
        icon: CalendarDays,
        keywords: "^ due date deadline today tomorrow weekday week month year",
      },
    ],
  },
];

/** Search text that never shows up in the row but should still find it. */
function entryKeywords(entry: HelpEntry): string[] {
  return [entry.hint, entry.keys?.join(" "), entry.keywords].filter((part): part is string =>
    Boolean(part),
  );
}

export function HelpPalette({
  open,
  onOpenChange,
  finalFocus,
  onOpenSettings,
  onOpenThemes,
  onToggleDoneLens,
  onWidenDoneLens,
  onCreate,
  onCreateChild,
  onOpenCategoryPicker,
  onOpenStatusMenu,
  onOpenPriorityMenu,
  onOpenTagPicker,
  onOpenSearch,
  activeTask,
  onAddBlocker,
  onMoveUnder,
  onPauseTask,
  onCopyTask,
  onCopyImage,
  statusUndoOnly = false,
  canUndoStatus,
  onUndoStatus,
  canRedo,
  onRedo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  onOpenSettings: () => void;
  onOpenThemes: () => void;
  onToggleDoneLens: () => void;
  onWidenDoneLens: () => void;
  onCreate: () => void;
  onCreateChild?: (task: TaskView) => void;
  onOpenCategoryPicker: () => void;
  onOpenStatusMenu: () => void;
  onOpenPriorityMenu: () => void;
  onOpenTagPicker: () => void;
  onOpenSearch: () => void;
  activeTask?: TaskView;
  onAddBlocker?: (task: TaskView) => void;
  onMoveUnder?: (task: TaskView) => void;
  onPauseTask?: (task: TaskView) => void;
  onCopyTask?: (task: TaskView) => void;
  onCopyImage?: (task: TaskView) => void;
  statusUndoOnly?: boolean;
  canUndoStatus?: boolean;
  onUndoStatus?: () => void;
  canRedo?: boolean;
  onRedo?: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <PaletteDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Shortcuts and syntax"
      description="Keyboard help, @categories, #tags and ^dates."
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
                  const label =
                    statusUndoOnly && entry.action === "undo-status"
                      ? "Undo last status change"
                      : entry.label;
                  const hint =
                    statusUndoOnly && entry.action === "undo-status"
                      ? "Restore the latest status change"
                      : entry.hint;
                  const onSelect =
                    entry.action === "open-themes"
                      ? onOpenThemes
                      : entry.action === "toggle-done-lens"
                        ? onToggleDoneLens
                        : entry.action === "widen-done-lens"
                          ? onWidenDoneLens
                          : entry.action === "open-settings"
                            ? onOpenSettings
                            : entry.action === "copy-task" && activeTask && onCopyTask
                              ? () => onCopyTask(activeTask)
                              : entry.action === "copy-image" && activeTask && onCopyImage
                                ? () => onCopyImage(activeTask)
                                : entry.action === "undo-status"
                                  ? canUndoStatus && onUndoStatus
                                    ? onUndoStatus
                                    : undefined
                                  : entry.action === "redo"
                                    ? canRedo
                                      ? onRedo
                                      : undefined
                                    : entry.action === "new-task"
                                      ? onCreate
                                      : entry.action === "new-child-task" &&
                                          activeTask &&
                                          onCreateChild
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
                                                  : entry.action === "add-blocker" &&
                                                      activeTask &&
                                                      onAddBlocker
                                                    ? () => onAddBlocker(activeTask)
                                                    : entry.action === "pause-task" &&
                                                        activeTask &&
                                                        onPauseTask
                                                      ? () => onPauseTask(activeTask)
                                                      : entry.action === "move-under" &&
                                                          activeTask &&
                                                          onMoveUnder
                                                        ? () => onMoveUnder(activeTask)
                                                        : undefined;
                  return (
                    <CommandItem
                      key={entry.label}
                      value={`${group.heading} ${label}`}
                      keywords={entryKeywords(entry)}
                      onSelect={onSelect}
                      disabled={entry.action === "redo" && !canRedo}
                    >
                      <Icon aria-hidden="true" />
                      <span className="shrink-0 font-medium">{label}</span>
                      {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
                      {entry.keys ? (
                        <KeysShortcut>
                          <KbdGroup>
                            {entry.keys.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </KbdGroup>
                        </KeysShortcut>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </Fragment>
          ))}
        </CommandList>
      </Command>
    </PaletteDialog>
  );
}
