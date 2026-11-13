import { Fragment, useRef, type ReactElement } from "react";
import {
  ArrowDownUp,
  Bot,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleHelp,
  Copy,
  CirclePause,
  CornerDownRight,
  FileText,
  ChevronsUp,
  Flag,
  ExternalLink,
  Folder,
  Image,
  Link2,
  ListChecks,
  ListChevronsUpDown,
  ListFilter,
  ListPlus,
  MoveLeft,
  Palette,
  PenLine,
  Play,
  Redo2,
  SaveCheck,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Undo2,
  type LucideIcon,
  Menu,
} from "lucide-react";
import type { TaskView } from "./taskView";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { ListLens } from "@/components/listLens";
import { modKey } from "@/platform/runtime";
import { bindingCaps as caps, useKeymap, type BindingId } from "@/keymap";
import { literalWordScore } from "@/components/commandFilter";
import { Command, PaletteDialog, KeysShortcut } from "@/components/variants/command";
import {
  pauseQuest,
  replayWelcome,
  resumeQuest,
  startQuest,
  useQuests,
} from "@/learning/questProgress";

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
    | "toggle-due-lens"
    | "toggle-agents-lens"
    | "widen-done-lens"
    | "add-blocker"
    | "move-under"
    | "pause-task"
    | "new-task"
    | "new-child-task"
    | "log-done-task"
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

/** The palette's rows, with the keys as they are set now (`keys.everywhere`). */
function helpGroups(): { heading: string; entries: HelpEntry[] }[] {
  return [
    {
      heading: "Task actions",
      entries: [
        {
          label: "New task",
          hint: "Inline editor",
          icon: ListPlus,
          keys: caps("capture.open"),
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
          label: "Log a task already done",
          hint: "Created done, now or earlier",
          icon: CircleCheck,
          keys: caps("capture.log"),
          action: "log-done-task",
          keywords: "l log done finished completed already record goal",
        },
        {
          label: "New child task",
          hint: "Under the selected task",
          icon: CornerDownRight,
          keys: caps("capture.child"),
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
          hint: `${modKey}+Enter in the description`,
          icon: SaveCheck,
          keys: ["Enter"],
          keywords: "enter ctrl cmd save create edit title description inline",
        },
        {
          label: "Change task status",
          hint: `${key("status.back")} goes back`,
          icon: ListChecks,
          keys: caps("status.forward"),
          keywords:
            "space shift space reverse backward open in progress done status cycle complete",
        },
        {
          label: "Pause or resume task",
          hint: "Again resumes",
          icon: CirclePause,
          keys: caps("status.pause"),
          action: "pause-task",
          keywords: "p pause resume sleep park soft cancel paused in progress",
        },
        {
          label: "Copy task text",
          hint: "Title, description and #tags",
          icon: Copy,
          keys: caps("copy.text"),
          action: "copy-task",
          keywords:
            "ctrl cmd c copy title description clipboard selected active task category tags metadata",
        },
        {
          label: "Open link",
          hint: "The first web link in the task's title or notes",
          icon: ExternalLink,
          keys: caps("details.open-link"),
          keywords: "o open link url web browser pr issue notes description",
        },
        {
          label: "Copy newest image",
          hint: "The image added last",
          icon: Image,
          keys: caps("attach.copy"),
          action: "copy-image",
          keywords:
            "ctrl cmd shift c copy image picture screenshot attachment clipboard paste agent",
        },
        {
          label: "Undo last change",
          hint: "Restore the latest task change",
          icon: Undo2,
          keys: caps("undo.latest"),
          action: "undo-status",
          keywords:
            "ctrl cmd z undo status change restore revert cancel complete edit move priority dependency order",
        },
        {
          label: "Redo last change",
          hint: "Ctrl+Y also works",
          icon: Redo2,
          keys: caps("redo.latest"),
          action: "redo",
          keywords:
            "ctrl cmd y shift z redo reapply restore undone change task status capture edit move priority dependency order",
        },
        {
          label: "Change active task priority",
          hint: `${key("priority.lower")} lower, ${key("priority.raise")} higher, or 0-4 to jump straight there`,
          icon: Flag,
          keys: [...caps("priority.lower"), ...caps("priority.raise")],
          keywords:
            "[ ] bracket 0 1 2 3 4 p0 p1 p2 p3 p4 set raise lower active task priority number",
        },
        {
          label: "Change active task effort",
          hint: `${key("effort.smaller")} smaller, ${key("effort.bigger")} bigger, from tiny to huge`,
          icon: ChevronsUp,
          keys: [...caps("effort.smaller"), ...caps("effort.bigger")],
          keywords:
            ", . < > comma period effort size big small tiny huge large estimate active task",
        },
        {
          label: "Switch active or inactive",
          hint: `${key("filter.mode")} then S`,
          icon: Circle,
          keys: [...caps("filter.mode"), "S"],
          action: "filter-status",
          keywords: "f s active inactive filter paused done canceled cancelled show hide toggle",
        },
        {
          label: "Show all statuses",
          hint: `${key("filter.mode")} then A`,
          icon: Circle,
          keys: [...caps("filter.mode"), "A"],
          action: "filter-status",
          keywords: "f a all every status filter show",
        },
        {
          label: "Exact status",
          hint: `${key("filter.mode")} then O I D P X`,
          icon: Circle,
          keys: [...caps("filter.mode"), "O/I/D/P/X"],
          action: "filter-status",
          keywords: "f exact open in progress done paused canceled o i d p x status",
        },
        {
          label: "Priority filter",
          hint: `${key("filter.mode")} then 0-4, same key clears`,
          icon: Flag,
          keys: [...caps("filter.mode"), "0-4"],
          action: "filter-priority",
          keywords: "f 0 1 2 3 4 p0 p1 p2 p3 p4 priority flag filter",
        },
        {
          label: "Show unblocked tasks",
          icon: ShieldCheck,
          keys: [...caps("filter.mode"), "U"],
          keywords: "f u unblocked ready available no blockers dependency depends prerequisite",
        },
        {
          label: "Filter by category",
          hint: `Also ${key("filter.mode")} then C`,
          icon: Folder,
          keys: [...caps("filter.category"), `${key("filter.mode")} → C`],
          action: "filter-category",
          keywords: "@ f c category folder filter",
        },
        {
          label: "Filter by tags",
          hint: `Also ${key("filter.mode")} then T`,
          icon: Tags,
          keys: [...caps("filter.tags"), `${key("filter.mode")} → T`],
          action: "filter-tags",
          keywords: "# f t tags filter clear multi and",
        },
        {
          label: "Rename a category or tag",
          hint: "In the @ or # picker, on every task",
          icon: PenLine,
          keys: [modKey, "R"],
          keywords: "ctrl cmd r rename category tag typo merge @ #",
        },
        {
          label: "Search tasks",
          hint: "Titles and notes",
          icon: Search,
          keys: caps("filter.search"),
          action: "filter-search",
          keywords: "slash search find title description fts query",
        },
        {
          label: "Filter shortcuts",
          hint: "Focus the toolbar; the same key closes",
          icon: ListFilter,
          keys: caps("filter.mode"),
          keywords:
            "f filter mode preset exact status priority category tags unblocked focus close toggle",
        },
        {
          label: "Sort tasks",
          hint: `Focus the toolbar; ${key("sort.mode")} then P by priority`,
          icon: ArrowDownUp,
          keys: [...caps("sort.mode"), "C/U/P/E/T/M/R"],
          keywords:
            "s order sort created updated priority effort due date deadline time manual reverse newest oldest direction focus close toggle",
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
          keys: [`${modKey}+↑/↓`, `${modKey}+Home/End`],
          keywords: "manual reorder move selected group beginning end up down",
        },
        {
          label: "Show details of the active task",
          hint: "Descriptions and timestamps",
          icon: ListChevronsUpDown,
          keys: caps("details.toggle-active"),
          keywords:
            "v view details description notes timestamps created updated time footer today yesterday date",
        },
        {
          label: "Show details of all tasks",
          hint: "Descriptions and timestamps",
          icon: ListChevronsUpDown,
          keys: caps("details.toggle-all"),
          keywords:
            "v view details description notes timestamps created updated time footer today yesterday date everything",
        },
        {
          label: "Add blocker",
          icon: Link2,
          keys: caps("pick.blocker"),
          action: "add-blocker",
          keywords: "b blocked by dependency depends prerequisite",
        },
        {
          label: "Move under…",
          icon: CornerDownRight,
          keys: caps("pick.parent"),
          action: "move-under",
          keywords: "m move under parent child hierarchy subtask",
        },
        {
          label: "Open task menu",
          hint: "Or the Menu key",
          icon: Menu,
          keys: caps("home.task-context-menu"),
          keywords: "a actions menu key context right click long press",
        },
        {
          label: "Cancel task",
          hint: "Delete cancels immediately",
          icon: Trash2,
          keys: caps("status.cancel"),
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
          keys: caps("settings.open"),
          action: "open-settings",
          keywords: "ctrl cmd comma data export json sqlite database storage path",
        },
        {
          label: "Themes",
          hint: "Choose appearance",
          action: "open-themes",
          icon: Palette,
          keys: caps("theme.picker"),
          keywords: "alt theme colour color dark light accent palette",
        },
        {
          label: "Done today",
          hint: "Done in the last 24 hours",
          action: "toggle-done-lens",
          icon: CircleCheck,
          keys: caps("done.lens"),
          keywords: "accomplished finished completed recent history yesterday count",
        },
        {
          label: "Due now",
          hint: "Due today or late",
          action: "toggle-due-lens",
          icon: CalendarDays,
          keys: caps("due.lens"),
          keywords: "overdue late deadline today calendar date count",
        },
        {
          label: "Changed by agents",
          hint: "What agents changed since you last looked",
          action: "toggle-agents-lens",
          icon: Bot,
          keys: caps("agents.lens"),
          keywords: "agent claude cli activity history who changed bot ai",
        },
        {
          label: "Look further back",
          hint: "Done yesterday, then the last 7 days, then 30",
          action: "widen-done-lens",
          icon: CalendarCheck,
          keys: caps("done.lens-window"),
          keywords: "accomplished finished completed yesterday week month history",
        },
        {
          label: "Toggle this palette",
          icon: CircleHelp,
          keys: caps("help.palette"),
          keywords: "ctrl cmd open close help syntax",
        },
        {
          label: "Close or go back",
          hint: "Esc leaves the toolbar",
          icon: Undo2,
          keys: ["Esc", `${key("filter.mode")}/${key("sort.mode")}`],
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
          label: "!date",
          hint: "Due: !fri !tmr !3d !oct31",
          icon: CalendarDays,
          keywords: "! due date deadline today tomorrow weekday week month year",
        },
      ],
    },
  ];
}

/** The key `id` has now, written like `Shift+C`, or Off. */
function key(id: BindingId): string {
  return caps(id).join("+") || "Off";
}

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
  onToggleLens,
  onWidenDoneLens,
  onCreate,
  onLogDone,
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
  onToggleLens: (kind: ListLens["kind"]) => void;
  onWidenDoneLens: () => void;
  onCreate: () => void;
  onLogDone: () => void;
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
  canUndoStatus?: boolean;
  onUndoStatus?: () => void;
  canRedo?: boolean;
  onRedo?: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const questEntry = useQuestEntry();
  useKeymap();

  return (
    <PaletteDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Shortcuts and syntax"
      description="Keyboard help, @categories, #tags and !dates."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command label="Search shortcuts and syntax" filter={literalWordScore} loop>
        <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
        <CommandList label="Help results">
          <CommandEmpty>No matches. Try “Tab”, “@”, or “#”.</CommandEmpty>
          {helpGroups().map((group, groupIndex) => (
            <Fragment key={group.heading}>
              {groupIndex > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={group.heading}>
                {group.entries.map((entry) => {
                  const Icon = entry.icon;
                  const { label, hint } = entry;
                  const onSelect =
                    entry.action === "open-themes"
                      ? onOpenThemes
                      : entry.action === "toggle-done-lens"
                        ? () => onToggleLens("done")
                        : entry.action === "toggle-due-lens"
                          ? () => onToggleLens("due")
                          : entry.action === "toggle-agents-lens"
                            ? () => onToggleLens("agents")
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
                                          : entry.action === "log-done-task"
                                            ? onLogDone
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
                      {entry.keys?.length ? (
                        <KeysShortcut>
                          <KbdGroup>
                            {entry.keys.map((cap, index) => (
                              <Kbd key={index}>{cap}</Kbd>
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
          {questEntry || import.meta.env.DEV ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Quests">
                {questEntry ? (
                  <CommandItem
                    value={`Quests ${questEntry.label}`}
                    keywords={[questEntry.hint, "quest learn tutorial later pause resume start"]}
                    onSelect={() => {
                      onOpenChange(false);
                      questEntry.run();
                    }}
                  >
                    {questEntry.label === "Pause quest" ? (
                      <CirclePause aria-hidden="true" />
                    ) : (
                      <Play aria-hidden="true" />
                    )}
                    <span className="shrink-0 font-medium">{questEntry.label}</span>
                    <span className="truncate text-muted-foreground">{questEntry.hint}</span>
                  </CommandItem>
                ) : null}
                {/* A testing aid for the welcome, so release builds leave it out. */}
                {import.meta.env.DEV ? (
                  <CommandItem
                    value="Quests Replay welcome"
                    keywords={["welcome intro greeting first start quest"]}
                    onSelect={() => {
                      onOpenChange(false);
                      replayWelcome();
                    }}
                  >
                    <Sparkles aria-hidden="true" />
                    <span className="shrink-0 font-medium">Replay welcome</span>
                    <span className="truncate text-muted-foreground">
                      The greeting on first start
                    </span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </PaletteDialog>
  );
}

/** Pause the quest under way, or resume or start one (`quest.pause`, `quest.resume`). */
function useQuestEntry(): { label: string; hint: string; run: () => void } | null {
  const { quests, active } = useQuests();
  if (active) return { label: "Pause quest", hint: active.title, run: pauseQuest };
  const paused = quests.find((quest) => quest.state === "paused");
  if (paused)
    return {
      label: "Resume quest",
      hint: `${paused.title}, step ${paused.step + 1} of ${paused.steps.length}`,
      run: () => resumeQuest(paused.id),
    };
  const next = quests.find((quest) => quest.state === "new");
  return next ? { label: "Start quest", hint: next.title, run: () => startQuest(next.id) } : null;
}
