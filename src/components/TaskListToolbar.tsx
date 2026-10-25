import {
  Fragment,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  Circle,
  Flag,
  Folder,
  Funnel,
  ListChevronsUpDown,
  type LucideIcon,
  Plus,
  Pointer,
  Search,
  ShieldCheck,
  Tags,
} from "lucide-react";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ClassificationOption } from "./taskView";
import {
  EXACT_STATUS_META,
  PRIORITY_META,
  type SortDirection,
  type SortField,
  type StatusPreset,
} from "./taskFilters";
import { lensPhrase, widerDoneWindow, type ListLens } from "./listLens";
import { TaskListModeHelp, type TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import { SortMenu } from "./SortMenu";
import { TaskActions } from "./TaskActions";
import { Breadcrumb, BreadcrumbItem, BreadcrumbSeparator } from "./ui/breadcrumb";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Popover, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { preventFocusSteal } from "@/navigation";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { ButtonRow, ToolbarGroup } from "@/components/variants/button-group";
import {
  ToolbarCommand,
  ToolbarGlyph,
  ToolbarToggle,
  ToolbarTooltip,
} from "@/components/variants/toolbar";
import { CompactPopoverContent } from "@/components/variants/popover";
import { CompactBreadcrumbList } from "@/components/variants/breadcrumb";
import { ClassificationBadge } from "@/components/variants/badge";

export const TOOLBAR_FOLD_GROUPS = ["filter", "actions"] as const;
export type ToolbarFoldGroup = (typeof TOOLBAR_FOLD_GROUPS)[number];

// What each sort shows first, descending then ascending.
const ORDER_LABELS: Record<Exclude<SortField, "manual">, [string, string]> = {
  created: ["Newest first", "Oldest first"],
  updated: ["Newest first", "Oldest first"],
  priority: ["Highest priority first", "Lowest priority first"],
  due: ["Soonest due first", "Latest due first"],
  closed: ["Recently done first", "Earliest done first"],
};

type FilterSummaryFilter = "status" | "category" | "priority" | "tags" | "search" | "unblocked";
type FilterSummaryPart = {
  filter: Exclude<FilterSummaryFilter, "status" | "category">;
  value: string;
  label: string;
  onClear: () => void;
};

function FilterSummaryAction({
  filter,
  label,
  onClear,
  className,
  children,
}: {
  filter: FilterSummaryFilter;
  label: string;
  onClear: () => void;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-filter-remove={filter}
      aria-label={label}
      title={label}
      onMouseDown={preventFocusSteal}
      onClick={onClear}
      className={`rounded-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

// A group is its glyph plus its buttons; folded, only the glyph remains. The panel stays
// mounted so the F mode can focus a folded group's toolbar.
function FoldableGroup({
  group,
  icon,
  label,
  open,
  active,
  onFoldChange,
  tooltip,
  children,
}: {
  group: ToolbarFoldGroup;
  icon: LucideIcon;
  label: string;
  open: boolean;
  active: boolean;
  onFoldChange: (group: ToolbarFoldGroup, folded: boolean) => void;
  tooltip: ComponentProps<typeof Tooltip>;
  children: ReactNode;
}): ReactElement {
  return (
    <Collapsible
      className="flex"
      open={open}
      onOpenChange={(nextOpen) => onFoldChange(group, !nextOpen)}
    >
      <ToolbarTooltip
        tooltip={tooltip}
        hint={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
        render={
          <CollapsibleTrigger
            render={
              <ToolbarGlyph
                icon={icon}
                open={open}
                active={!open && active}
                aria-label={label}
                data-toolbar-glyph={group}
              />
            }
          />
        }
      />
      <CollapsibleContent keepMounted className="flex">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Keep refs and actions list-owned so mouse controls and shortcuts share one path.
type TaskListToolbarProps = {
  toolbarMode: ToolbarMode | null;
  helpMode: KeyboardHelpMode;
  onDisableHelp: () => void;
  returnToList: () => void;
  filterToolbar: RefObject<HTMLDivElement | null>;
  sortToolbar: RefObject<HTMLDivElement | null>;
  statusFilterButton: RefObject<HTMLButtonElement | null>;
  activateToolbarMode: (mode: ToolbarMode) => void;
  clearToolbarMode: () => void;
  foldedGroups: readonly ToolbarFoldGroup[];
  setGroupFolded: (group: ToolbarFoldGroup, folded: boolean) => void;
  composerOpen: boolean;
  onCreate: () => void;
  taskActions: Omit<ComponentProps<typeof TaskActions>, "tooltipFor">;
  categoryFilter: ClassificationToken | null;
  toggleCategoryFilter: () => void;
  exactStatus: TaskStatus | null;
  statusPreset: StatusPreset;
  openStatusMenu: () => void;
  priorityFilter: TaskPriority | null;
  openPriorityMenu: () => void;
  tagFilter: ClassificationOption[];
  openTagPicker: () => void;
  showUnblocked: boolean;
  toggleUnblockedFilter: () => void;
  unblockedFeedbackOpen: boolean;
  setUnblockedFeedbackOpen: (open: boolean) => void;
  searchQuery: string;
  searchInput: ReactNode;
  openSearch: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  applySortField: (field: SortField) => void;
  reverseSort: () => void;
  showDetails: boolean;
  mixedDetails: boolean;
  onToggleDetails: () => void;
  moveControlsOpen: boolean;
  setMoveControlsOpen: (open: boolean) => void;
  moveSubjectLabel: string;
  reorderAvailabilityReason: string | null;
  reorderSelection: (direction: TaskMoveDirection) => Promise<void>;
  summaryTaskCount: number;
  lens: ListLens | null;
  widenDoneLens: () => void;
  clearStatusFilter: () => void;
  clearCategoryFilter: () => void;
  clearPriorityFilter: () => void;
  clearTagFilter: () => void;
  clearSearch: () => void;
};

export function TaskListToolbar({
  toolbarMode,
  helpMode,
  onDisableHelp,
  returnToList,
  filterToolbar,
  sortToolbar,
  statusFilterButton,
  activateToolbarMode,
  clearToolbarMode,
  foldedGroups,
  setGroupFolded,
  composerOpen,
  onCreate,
  taskActions,
  categoryFilter,
  toggleCategoryFilter,
  exactStatus,
  statusPreset,
  openStatusMenu,
  priorityFilter,
  openPriorityMenu,
  tagFilter,
  openTagPicker,
  showUnblocked,
  toggleUnblockedFilter,
  unblockedFeedbackOpen,
  setUnblockedFeedbackOpen,
  searchQuery,
  searchInput,
  openSearch,
  sortField,
  sortDirection,
  applySortField,
  reverseSort,
  showDetails,
  mixedDetails,
  onToggleDetails,
  moveControlsOpen,
  setMoveControlsOpen,
  moveSubjectLabel,
  reorderAvailabilityReason,
  reorderSelection,
  summaryTaskCount,
  lens,
  widenDoneLens,
  clearStatusFilter,
  clearCategoryFilter,
  clearPriorityFilter,
  clearTagFilter,
  clearSearch,
}: TaskListToolbarProps): ReactElement {
  const tooltipId = useId();
  const touchTarget = useRef<HTMLButtonElement | null>(null);
  const [touchFeedback, setTouchFeedback] = useState<{ key: string } | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  const dismissFeedback = useEffectEvent((event: PointerEvent | KeyboardEvent) => {
    touchTarget.current =
      "pointerType" in event && event.pointerType === "touch" && event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-toolbar-feedback]")
        : null;
    setTouchFeedback(null);
    setHoveredTooltip(null);
    setUnblockedFeedbackOpen(false);
  });
  useEffect(() => {
    document.addEventListener("pointerdown", dismissFeedback, true);
    document.addEventListener("keydown", dismissFeedback, true);
    return () => {
      document.removeEventListener("pointerdown", dismissFeedback, true);
      document.removeEventListener("keydown", dismissFeedback, true);
    };
  }, []);
  useEffect(() => {
    if (!touchFeedback) return;
    const timeout = window.setTimeout(() => setTouchFeedback(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [touchFeedback]);

  function feedbackTooltip(key: string): ComponentProps<typeof Tooltip> {
    return {
      triggerId: `${tooltipId}-${key}`,
      disableHoverablePopup: touchFeedback !== null,
      open: touchFeedback
        ? touchFeedback.key === key
        : hoveredTooltip !== null
          ? hoveredTooltip === key
          : key === "unblocked" && unblockedFeedbackOpen,
      onOpenChange: (open, details) => {
        // Touch generates press and hover-end events after the click. Neither should
        // dismiss the feedback that click just opened.
        if (
          touchFeedback?.key === key &&
          (details.reason === "trigger-press" || details.reason === "trigger-hover")
        ) {
          details.cancel();
          return;
        }
        setHoveredTooltip((previous) => (open ? key : previous === key ? null : previous));
        if (open || key === "unblocked") setUnblockedFeedbackOpen(false);
        if (open || touchFeedback?.key === key) setTouchFeedback(null);
      },
    };
  }

  const statusActive = exactStatus !== null || statusPreset === "inactive";
  const statusLabel =
    exactStatus !== null
      ? (EXACT_STATUS_META.find((entry) => entry.status === exactStatus)?.label ?? exactStatus)
      : statusPreset === "active"
        ? "Active"
        : "Inactive";
  const priorityLabel =
    priorityFilter !== null
      ? (PRIORITY_META.find((meta) => meta.value === priorityFilter)?.shortLabel ??
        `P${priorityFilter}`)
      : "Priority";
  const searchActive = searchQuery.trim() !== "";
  // Descending is the default direction. The toggle is highlighted only
  // after reversing that default to ascending order.
  const reverseActive = sortField !== "manual" && sortDirection === "asc";
  const summaryStatus = statusLabel.toLowerCase();
  const summaryTags =
    tagFilter.length > 2
      ? `#${tagFilter[0].label} +${tagFilter.length - 1} tags`
      : tagFilter.length > 0
        ? tagFilter.map((tag) => `#${tag.label}`).join(" ")
        : null;
  const summaryBase = lens
    ? `${summaryTaskCount} ${lensPhrase(lens)}`
    : `${summaryTaskCount} ${summaryStatus} ${summaryTaskCount === 1 ? "task" : "tasks"}`;
  const statusIsDefault = statusPreset === "active" && exactStatus === null;
  const summarySuffixParts: FilterSummaryPart[] = [
    priorityFilter !== null
      ? {
          filter: "priority",
          value: priorityLabel,
          label: `Clear priority filter: ${priorityLabel}`,
          onClear: clearPriorityFilter,
        }
      : null,
    summaryTags !== null
      ? {
          filter: "tags",
          value: summaryTags,
          label: `Clear tag filters: ${tagFilter.map((tag) => `#${tag.label}`).join(" ")}`,
          onClear: clearTagFilter,
        }
      : null,
    searchActive
      ? {
          filter: "search",
          value: `“${searchQuery.trim()}”`,
          label: `Clear search filter: ${searchQuery.trim()}`,
          onClear: clearSearch,
        }
      : null,
    showUnblocked
      ? {
          filter: "unblocked",
          value: "unblocked",
          label: "Clear unblocked filter",
          onClear: toggleUnblockedFilter,
        }
      : null,
  ].filter((part): part is FilterSummaryPart => part !== null);
  const filterSummary = [
    summaryBase,
    categoryFilter ? categoryFilter.label : null,
    ...summarySuffixParts.map((part) => part.value),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const groupOpen = (group: ToolbarFoldGroup): boolean =>
    !foldedGroups.includes(group) || toolbarMode === group;
  const [descLabel, ascLabel] = ORDER_LABELS[sortField === "manual" ? "created" : sortField];
  const [reverseLabel, oppositeLabel] =
    sortDirection === "desc" ? [descLabel, ascLabel] : [ascLabel, descLabel];

  return (
    <div
      className="flex shrink-0 flex-col gap-4"
      onClickCapture={(event) => {
        const button = touchTarget.current;
        touchTarget.current = null;
        if (!button || button.disabled || !button.contains(event.target as Node)) return;
        setHoveredTooltip(null);
        setTouchFeedback({ key: button.dataset.toolbarFeedback! });
      }}
    >
      {/* New task holds the first column; groups wrap whole onto rows that start beside it. */}
      <div className="flex items-start">
        <ToolbarTooltip
          tooltip={feedbackTooltip("create")}
          hint="New task (C)"
          render={
            <ToolbarCommand
              variant="default"
              aria-label="New task"
              aria-keyshortcuts="C"
              disabled={composerOpen}
              onClick={() => onCreate()}
            />
          }
        >
          <Plus aria-hidden="true" />
        </ToolbarTooltip>
        <div className="flex min-w-0 flex-1 flex-wrap gap-y-2">
          <FoldableGroup
            group="filter"
            icon={Funnel}
            label="Filters"
            open={groupOpen("filter")}
            active={!statusIsDefault || categoryFilter !== null || summarySuffixParts.length > 0}
            onFoldChange={setGroupFolded}
            tooltip={feedbackTooltip("fold-filter")}
          >
            <div className="relative">
              {toolbarMode === "filter" && helpMode !== "none" ? (
                <TaskListModeHelp
                  mode="filter"
                  onDismiss={returnToList}
                  onDisableHelp={onDisableHelp}
                />
              ) : null}
              <ToolbarGroup
                ref={filterToolbar}
                aria-label="Task list filters"
                aria-keyshortcuts="F S O I D P X 0 1 2 3 4 C T U /"
                tabIndex={-1}
                data-toolbar="filters"
                data-toolbar-active={toolbarMode === "filter" || undefined}
                active={toolbarMode === "filter"}
                onFocus={() => activateToolbarMode("filter")}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) clearToolbarMode();
                }}
              >
                <ToolbarTooltip
                  tooltip={feedbackTooltip("category")}
                  hint={categoryFilter ? categoryFilter.label : "Category"}
                  render={
                    <ToolbarToggle
                      pressed={categoryFilter !== null}
                      aria-label={
                        categoryFilter
                          ? `Clear category filter: ${categoryFilter.label}`
                          : "Filter by category. Press @ or F then C."
                      }
                      aria-keyshortcuts="@ C"
                      data-filter="task-category"
                      onClick={toggleCategoryFilter}
                    />
                  }
                >
                  <Folder
                    className={categoryFilter ? "text-success" : undefined}
                    aria-hidden="true"
                  />
                </ToolbarTooltip>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("status")}
                  hint={statusLabel}
                  render={
                    <ToolbarToggle
                      ref={statusFilterButton}
                      pressed={statusActive}
                      aria-label={
                        exactStatus !== null
                          ? `Status filter: ${statusLabel}. Open status menu.`
                          : `Status filter: ${statusLabel}. Open status menu or press F then S to toggle.`
                      }
                      aria-keyshortcuts="S"
                      data-filter="task-status"
                      onClick={openStatusMenu}
                    />
                  }
                >
                  <Circle aria-hidden="true" />
                </ToolbarTooltip>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("priority-filter")}
                  hint={priorityLabel}
                  render={
                    <ToolbarToggle
                      pressed={priorityFilter !== null}
                      aria-label={
                        priorityFilter !== null
                          ? `Priority filter: ${priorityLabel}. Open priority menu or press F then a number.`
                          : "Filter by priority. Press F then 0-4."
                      }
                      aria-keyshortcuts="0 1 2 3 4"
                      data-filter="task-priority"
                      onClick={openPriorityMenu}
                    />
                  }
                >
                  <Flag aria-hidden="true" />
                </ToolbarTooltip>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("tags")}
                  hint={
                    tagFilter.length > 0 ? tagFilter.map((tag) => tag.label).join(", ") : "Tags"
                  }
                  render={
                    <ToolbarToggle
                      pressed={tagFilter.length > 0}
                      aria-label={
                        tagFilter.length > 0
                          ? `Tag filter: ${tagFilter.map((tag) => tag.label).join(", ")}. Open tag picker.`
                          : "Filter by tags. Press # or F then T."
                      }
                      aria-keyshortcuts="# T"
                      data-filter="task-tags"
                      onClick={openTagPicker}
                    />
                  }
                >
                  <Tags aria-hidden="true" />
                </ToolbarTooltip>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("unblocked")}
                  hint={showUnblocked ? "Unblocked" : "All tasks"}
                  render={
                    <ToolbarToggle
                      pressed={showUnblocked}
                      aria-label={
                        showUnblocked
                          ? "Show all tasks. Press F then U."
                          : "Show unblocked tasks. Press F then U."
                      }
                      aria-keyshortcuts="U"
                      data-filter="task-unblocked"
                      data-toolbar-feedback="unblocked"
                      onClick={toggleUnblockedFilter}
                    />
                  }
                >
                  <ShieldCheck aria-hidden="true" />
                </ToolbarTooltip>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("search")}
                  hint={searchActive ? searchQuery.trim() : "Search"}
                  render={
                    <ToolbarToggle
                      pressed={searchActive}
                      aria-label={
                        searchActive
                          ? `Search: ${searchQuery.trim()}. Open search or clear.`
                          : "Search tasks"
                      }
                      aria-keyshortcuts="/"
                      data-filter="task-search"
                      onClick={openSearch}
                    />
                  }
                >
                  <Search aria-hidden="true" />
                </ToolbarTooltip>
              </ToolbarGroup>
            </div>
          </FoldableGroup>
          {/* Sort has one value at a time, so it needs no fold: its menu is already one cell. */}
          <div className="relative">
            {toolbarMode === "sort" && helpMode !== "none" ? (
              <TaskListModeHelp
                mode="sort"
                onDismiss={returnToList}
                onDisableHelp={onDisableHelp}
              />
            ) : null}
            <ToolbarGroup
              ref={sortToolbar}
              aria-label="Task list sort"
              aria-keyshortcuts={exactStatus === "done" ? "S C U P T D M R" : "S C U P T M R"}
              tabIndex={-1}
              data-toolbar="sort"
              data-toolbar-active={toolbarMode === "sort" || undefined}
              active={toolbarMode === "sort"}
              onFocus={(event) => {
                // React bubbles focus from the menu's portal here too; picking from it is no mode.
                if (event.currentTarget.contains(event.target)) activateToolbarMode("sort");
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) clearToolbarMode();
              }}
            >
              <SortMenu
                sortField={sortField}
                showCompleted={exactStatus === "done"}
                onSelect={applySortField}
                finalFocus={taskActions.finalFocus}
                tooltip={feedbackTooltip("sort")}
              />
              <ToolbarTooltip
                tooltip={feedbackTooltip("reverse")}
                hint={sortField === "manual" ? "Unavailable for manual order" : reverseLabel}
                render={
                  <ToolbarToggle
                    pressed={reverseActive}
                    disabled={sortField === "manual"}
                    aria-label={
                      sortField === "manual"
                        ? "Reverse is unavailable for manual order."
                        : `${reverseLabel}. Activate to show ${oppositeLabel.toLowerCase()}. Press S then R.`
                    }
                    aria-keyshortcuts="R"
                    data-sort="task-sort-reverse"
                    data-toolbar-feedback="reverse"
                    onClick={reverseSort}
                  />
                }
              >
                {sortDirection === "desc" ? (
                  <ArrowDown aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
              </ToolbarTooltip>
            </ToolbarGroup>
          </div>
          <FoldableGroup
            group="actions"
            icon={Pointer}
            label="Actions"
            open={groupOpen("actions")}
            active={showDetails || mixedDetails}
            onFoldChange={setGroupFolded}
            tooltip={feedbackTooltip("fold-actions")}
          >
            <ButtonRow aria-label="Task list actions">
              <ToolbarTooltip
                tooltip={feedbackTooltip("details")}
                hint={
                  showDetails
                    ? `Hide all details${mixedDetails ? ", some tasks differ" : ""}`
                    : `Show all details${mixedDetails ? ", some tasks differ" : ""}`
                }
                render={
                  <ToolbarToggle
                    pressed={showDetails}
                    mixed={mixedDetails}
                    aria-label={
                      showDetails
                        ? "Hide descriptions and timestamps of all tasks. Press Shift+V."
                        : "Show descriptions and timestamps of all tasks. Press Shift+V."
                    }
                    aria-keyshortcuts="Shift+V"
                    data-view="task-details"
                    data-toolbar-feedback="details"
                    onClick={onToggleDetails}
                  />
                }
              >
                <ListChevronsUpDown aria-hidden="true" />
              </ToolbarTooltip>
              <Popover open={moveControlsOpen} onOpenChange={setMoveControlsOpen}>
                <ToolbarTooltip
                  tooltip={feedbackTooltip("move")}
                  hint={moveControlsOpen ? "Hide reorder controls" : "Reorder"}
                  render={
                    <PopoverTrigger
                      render={
                        <ToolbarCommand
                          aria-label="Reorder"
                          data-move-controls-toggle
                          onMouseDown={preventFocusSteal}
                        />
                      }
                    />
                  }
                >
                  <ArrowDownUp aria-hidden="true" />
                </ToolbarTooltip>
                <CompactPopoverContent
                  data-move-controls
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  initialFocus={false}
                  finalFocus={false}
                >
                  <p className="sr-only">Move {moveSubjectLabel} in manual order.</p>
                  <div
                    role="toolbar"
                    aria-label={
                      reorderAvailabilityReason
                        ? `Move ${moveSubjectLabel}. ${reorderAvailabilityReason}`
                        : `Move ${moveSubjectLabel}`
                    }
                    aria-controls="task-list"
                    className="flex items-center gap-1"
                  >
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            tabIndex={-1}
                            aria-label="Move up"
                            aria-disabled={reorderAvailabilityReason !== null || undefined}
                            data-reorder-action="up"
                            onMouseDown={preventFocusSteal}
                            onClick={() => void reorderSelection("up")}
                          />
                        }
                      >
                        <ArrowUp aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8}>
                        {reorderAvailabilityReason ?? "Move up"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            tabIndex={-1}
                            aria-label="Move down"
                            aria-disabled={reorderAvailabilityReason !== null || undefined}
                            data-reorder-action="down"
                            onMouseDown={preventFocusSteal}
                            onClick={() => void reorderSelection("down")}
                          />
                        }
                      >
                        <ArrowDown aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8}>
                        {reorderAvailabilityReason ?? "Move down"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            tabIndex={-1}
                            aria-label="Move to beginning"
                            aria-disabled={reorderAvailabilityReason !== null || undefined}
                            data-reorder-action="start"
                            onMouseDown={preventFocusSteal}
                            onClick={() => void reorderSelection("start")}
                          />
                        }
                      >
                        <ChevronDown aria-hidden="true" className="rotate-180" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8}>
                        {reorderAvailabilityReason ?? "Move to beginning"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            tabIndex={-1}
                            aria-label="Move to end"
                            aria-disabled={reorderAvailabilityReason !== null || undefined}
                            data-reorder-action="end"
                            onMouseDown={preventFocusSteal}
                            onClick={() => void reorderSelection("end")}
                          />
                        }
                      >
                        <ChevronDown aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8}>
                        {reorderAvailabilityReason ?? "Move to end"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </CompactPopoverContent>
              </Popover>
              <TaskActions {...taskActions} tooltipFor={feedbackTooltip} />
            </ButtonRow>
          </FoldableGroup>
        </div>
      </div>
      {searchInput}
      <Breadcrumb
        data-filter-summary="true"
        aria-live="polite"
        aria-atomic="true"
        title={filterSummary}
        className="overflow-hidden"
      >
        <CompactBreadcrumbList>
          <BreadcrumbItem className="shrink-0">
            {statusIsDefault ? (
              <span className="text-sm font-medium">{summaryBase}</span>
            ) : (
              <FilterSummaryAction
                filter="status"
                label={
                  lens?.kind === "done"
                    ? `Show tasks ${lensPhrase({ kind: "done", window: widerDoneWindow(lens.window) })}`
                    : "Reset status filter to Active"
                }
                onClear={lens?.kind === "done" ? widenDoneLens : clearStatusFilter}
                className="text-sm font-medium text-foreground"
              >
                {summaryBase}
              </FilterSummaryAction>
            )}
          </BreadcrumbItem>
          {categoryFilter ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="shrink-0">
                <FilterSummaryAction
                  filter="category"
                  label={`Clear category filter: ${categoryFilter.label}`}
                  onClear={clearCategoryFilter}
                  className="shrink-0 rounded-full"
                >
                  <ClassificationBadge
                    kind="category"
                    data-filter-category="true"
                    className="shrink-0"
                  >
                    <Folder data-icon="inline-start" aria-hidden="true" />
                    {categoryFilter.label}
                  </ClassificationBadge>
                </FilterSummaryAction>
              </BreadcrumbItem>
            </>
          ) : null}
          {summarySuffixParts.map((part) => (
            <Fragment key={part.filter}>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <FilterSummaryAction
                  filter={part.filter}
                  label={part.label}
                  onClear={part.onClear}
                  className="min-w-0 truncate text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  {part.value}
                </FilterSummaryAction>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </CompactBreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
