import {
  ArrowDownUp,
  Bot,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleHelp,
  CirclePause,
  Trophy,
  Copy,
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
  CalendarRange,
  Redo2,
  SaveCheck,
  Search,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  Undo2,
  ListEnd,
  type LucideIcon,
  Menu,
} from "lucide-react";
import { bindingCaps as caps, type BindingId } from "@/keymap";
import { modKey } from "@/platform/runtime";

export type HelpEntry = {
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
    | "toggle-queue-lens"
    | "widen-done-lens"
    | "open-goal-report"
    | "open-goal-report-year"
    | "open-learn"
    | "add-blocker"
    | "move-under"
    | "queue-task"
    | "queue-first"
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
export function helpGroups(): { heading: string; entries: HelpEntry[] }[] {
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
          label: "Queue or unqueue task",
          icon: ListEnd,
          keys: caps("queue.add"),
          action: "queue-task",
          keywords: "q queue add remove take out line up next order",
        },
        {
          label: "Queue task first",
          icon: ListEnd,
          keys: caps("queue.front"),
          action: "queue-first",
          keywords: "shift q queue front first top next line up",
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
          label: "Work off the queue",
          hint: "The tasks you lined up, in your order",
          action: "toggle-queue-lens",
          icon: ListEnd,
          keys: caps("queue.lens"),
          keywords: "queue next up line order focus work list",
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
          label: "Goal report",
          hint: "Every day of the month against your goals",
          action: "open-goal-report",
          icon: CalendarRange,
          keys: caps("goals.report"),
          keywords: "goals report calendar month year streak history days met",
        },
        {
          label: "Goal report by year",
          hint: "Every day of the year against your goals",
          action: "open-goal-report-year",
          icon: CalendarRange,
          keys: caps("goals.report-range"),
          keywords: "goals report calendar year annual streak history days met",
        },
        {
          label: "Quests and learned keys",
          hint: "Every quest and the keys you've picked up",
          action: "open-learn",
          icon: Trophy,
          keys: caps("learn.panel"),
          keywords: "quests learn tutorial log progress keys learned",
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
