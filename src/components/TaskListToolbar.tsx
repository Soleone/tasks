import { Fragment, type ReactElement, type ReactNode, type RefObject } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  Circle,
  Clock3,
  Flag,
  Folder,
  ListChevronsUpDown,
  ListOrdered,
  Plus,
  RotateCcwClock,
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
import { TaskListModeHelp, type TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import { Breadcrumb, BreadcrumbItem, BreadcrumbSeparator } from "./ui/breadcrumb";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Popover, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { preventFocusSteal } from "@/navigation";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { ToggleButton } from "@/components/variants/button";
import { ToolbarGroup } from "@/components/variants/button-group";
import { CompactPopoverContent } from "@/components/variants/popover";
import { CompactBreadcrumbList } from "@/components/variants/breadcrumb";
import { ClassificationBadge } from "@/components/variants/badge";

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
  composerOpen: boolean;
  onCreate: () => void;
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
  openSearch: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  applySortField: (field: SortField) => void;
  reverseSort: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
  moveControlsOpen: boolean;
  setMoveControlsOpen: (open: boolean) => void;
  moveSubjectLabel: string;
  reorderAvailabilityReason: string | null;
  reorderSelection: (direction: TaskMoveDirection) => Promise<void>;
  summaryTaskCount: number;
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
  composerOpen,
  onCreate,
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
  openSearch,
  sortField,
  sortDirection,
  applySortField,
  reverseSort,
  showDetails,
  onToggleDetails,
  moveControlsOpen,
  setMoveControlsOpen,
  moveSubjectLabel,
  reorderAvailabilityReason,
  reorderSelection,
  summaryTaskCount,
  clearStatusFilter,
  clearCategoryFilter,
  clearPriorityFilter,
  clearTagFilter,
  clearSearch,
}: TaskListToolbarProps): ReactElement {
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
  const tagLabel =
    tagFilter.length > 0 ? `${tagFilter.length} tag${tagFilter.length === 1 ? "" : "s"}` : "Tags";
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
  const summaryBase = `${summaryTaskCount} ${summaryStatus} ${summaryTaskCount === 1 ? "task" : "tasks"}`;
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

  return (
    <div className="flex shrink-0 flex-col gap-4">
      {/* On a phone the toolbar is two rows on a grid of icon-wide columns: New task spans four
          and a divider one, so the icons line up and larger text wraps whole cells. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1">
        <div className="flex flex-wrap items-center gap-y-2 sm:contents">
          <div className="w-28 sm:mr-auto sm:w-auto">
            <Button
              size="sm"
              tabIndex={-1}
              aria-keyshortcuts="C"
              disabled={composerOpen}
              onClick={() => onCreate()}
            >
              <Plus aria-hidden="true" />
              New task
            </Button>
          </div>
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={categoryFilter ? "outline" : "ghost"}
                      selected={categoryFilter !== null}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        categoryFilter
                          ? `Clear category filter: ${categoryFilter.label}`
                          : "Filter by category. Press @ or F then C."
                      }
                      aria-pressed={categoryFilter !== null}
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
                  <span className="sr-only">
                    {categoryFilter
                      ? `Clear category filter: ${categoryFilter.label}`
                      : "Filter by category"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {categoryFilter ? categoryFilter.label : "Category"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      ref={statusFilterButton}
                      variant={statusActive ? "outline" : "ghost"}
                      selected={statusActive}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        exactStatus !== null
                          ? `Status filter: ${statusLabel}. Open status menu.`
                          : `Status filter: ${statusLabel}. Open status menu or press F then S to toggle.`
                      }
                      aria-pressed={statusActive}
                      aria-keyshortcuts="S"
                      data-filter="task-status"
                      onClick={openStatusMenu}
                    />
                  }
                >
                  <Circle aria-hidden="true" />
                  <span className="sr-only">{`Status: ${statusLabel}`}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {statusLabel}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={priorityFilter !== null ? "outline" : "ghost"}
                      selected={priorityFilter !== null}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        priorityFilter !== null
                          ? `Priority filter: ${priorityLabel}. Open priority menu or press F then a number.`
                          : "Filter by priority. Press F then 0-4."
                      }
                      aria-pressed={priorityFilter !== null}
                      aria-keyshortcuts="0 1 2 3 4"
                      data-filter="task-priority"
                      onClick={openPriorityMenu}
                    />
                  }
                >
                  <Flag aria-hidden="true" />
                  <span className="sr-only">{`Priority: ${priorityLabel}`}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {priorityLabel}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={tagFilter.length > 0 ? "outline" : "ghost"}
                      selected={tagFilter.length > 0}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        tagFilter.length > 0
                          ? `Tag filter: ${tagFilter.map((tag) => tag.label).join(", ")}. Open tag picker.`
                          : "Filter by tags. Press # or F then T."
                      }
                      aria-pressed={tagFilter.length > 0}
                      aria-keyshortcuts="# T"
                      data-filter="task-tags"
                      onClick={openTagPicker}
                    />
                  }
                >
                  <Tags aria-hidden="true" />
                  <span className="sr-only">{`Tags: ${tagLabel}`}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {tagFilter.length > 0 ? tagFilter.map((tag) => tag.label).join(", ") : "Tags"}
                </TooltipContent>
              </Tooltip>
              <Tooltip open={unblockedFeedbackOpen} onOpenChange={setUnblockedFeedbackOpen}>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={showUnblocked ? "outline" : "ghost"}
                      selected={showUnblocked}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        showUnblocked
                          ? "Show all tasks. Press F then U."
                          : "Show unblocked tasks. Press F then U."
                      }
                      aria-pressed={showUnblocked}
                      aria-keyshortcuts="U"
                      data-filter="task-unblocked"
                      onClick={toggleUnblockedFilter}
                    />
                  }
                >
                  <ShieldCheck aria-hidden="true" />
                  <span className="sr-only">
                    {showUnblocked ? "Show all tasks" : "Show unblocked tasks"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {showUnblocked ? "Unblocked" : "All tasks"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={searchActive ? "outline" : "ghost"}
                      selected={searchActive}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={
                        searchActive
                          ? `Search: ${searchQuery.trim()}. Open search or clear.`
                          : "Search tasks"
                      }
                      aria-pressed={searchActive}
                      aria-keyshortcuts="/"
                      data-filter="task-search"
                      onClick={openSearch}
                    />
                  }
                >
                  <Search aria-hidden="true" />
                  <span className="sr-only">
                    {searchActive ? `Search: ${searchQuery.trim()}` : "Search"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {searchActive ? searchQuery.trim() : "Search"}
                </TooltipContent>
              </Tooltip>
            </ToolbarGroup>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-y-2 sm:contents">
          <Separator orientation="vertical" className="hidden h-7 sm:block" />
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
              aria-keyshortcuts="S C U M R"
              tabIndex={-1}
              data-toolbar="sort"
              data-toolbar-active={toolbarMode === "sort" || undefined}
              active={toolbarMode === "sort"}
              onFocus={() => activateToolbarMode("sort")}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) clearToolbarMode();
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={sortField === "created" ? "outline" : "ghost"}
                      selected={sortField === "created"}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={`Sort by created date. Press S then C.`}
                      aria-pressed={sortField === "created"}
                      aria-keyshortcuts="C"
                      data-sort="task-sort-created"
                      onClick={() => applySortField("created")}
                    />
                  }
                >
                  <Clock3 aria-hidden="true" />
                  <span className="sr-only">Sort by created</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  Created
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={sortField === "updated" ? "outline" : "ghost"}
                      selected={sortField === "updated"}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={`Sort by updated date. Press S then U.`}
                      aria-pressed={sortField === "updated"}
                      aria-keyshortcuts="U"
                      data-sort="task-sort-updated"
                      onClick={() => applySortField("updated")}
                    />
                  }
                >
                  <RotateCcwClock aria-hidden="true" />
                  <span className="sr-only">Sort by updated</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  Updated
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={sortField === "priority" ? "outline" : "ghost"}
                      selected={sortField === "priority"}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Sort by priority. Press S then P."
                      aria-pressed={sortField === "priority"}
                      aria-keyshortcuts="P"
                      data-sort="task-sort-priority"
                      onClick={() => applySortField("priority")}
                    />
                  }
                >
                  <Flag aria-hidden="true" />
                  <span className="sr-only">Sort by priority</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  Priority
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={sortField === "manual" ? "outline" : "ghost"}
                      selected={sortField === "manual"}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Sort by manual order. Press S then M."
                      aria-pressed={sortField === "manual"}
                      aria-keyshortcuts="M"
                      data-sort="task-sort-manual"
                      onClick={() => applySortField("manual")}
                    />
                  }
                >
                  <ListOrdered aria-hidden="true" />
                  <span className="sr-only">Sort by manual order</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  Manual order
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      variant={reverseActive ? "outline" : "ghost"}
                      selected={reverseActive}
                      size="icon-sm"
                      tabIndex={-1}
                      disabled={sortField === "manual"}
                      aria-pressed={reverseActive}
                      aria-label={
                        sortField === "manual"
                          ? "Reverse is unavailable for manual order."
                          : sortField === "priority"
                            ? sortDirection === "desc"
                              ? "Highest priority first. Activate to show lowest priority first. Press S then R."
                              : "Lowest priority first. Activate to show highest priority first. Press S then R."
                            : sortDirection === "desc"
                              ? "Newest first. Activate to show oldest first. Press S then R."
                              : "Oldest first. Activate to show newest first. Press S then R."
                      }
                      aria-keyshortcuts="R"
                      data-sort="task-sort-reverse"
                      onClick={reverseSort}
                    />
                  }
                >
                  {sortDirection === "desc" ? (
                    <ArrowDown aria-hidden="true" />
                  ) : (
                    <ArrowUp aria-hidden="true" />
                  )}
                  <span className="sr-only">
                    {sortField === "priority"
                      ? sortDirection === "desc"
                        ? "Highest priority first"
                        : "Lowest priority first"
                      : sortDirection === "desc"
                        ? "Newest first"
                        : "Oldest first"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {sortField === "manual"
                    ? "Unavailable for manual order"
                    : sortField === "priority"
                      ? sortDirection === "desc"
                        ? "Highest priority first"
                        : "Lowest priority first"
                      : sortDirection === "desc"
                        ? "Newest first"
                        : "Oldest first"}
                </TooltipContent>
              </Tooltip>
            </ToolbarGroup>
          </div>
          <div className="flex w-7 justify-center sm:contents">
            <Separator orientation="vertical" className="h-7" />
          </div>
          <ButtonGroup aria-label="Task list view">
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleButton
                    variant={showDetails ? "outline" : "ghost"}
                    selected={showDetails}
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label={
                      showDetails
                        ? "Hide descriptions and timestamps. Press V."
                        : "Show descriptions and timestamps. Press V."
                    }
                    aria-pressed={showDetails}
                    aria-keyshortcuts="V"
                    data-view="task-details"
                    onClick={onToggleDetails}
                  />
                }
              >
                <ListChevronsUpDown aria-hidden="true" />
                <span className="sr-only">
                  {showDetails
                    ? "Hide descriptions and timestamps"
                    : "Show descriptions and timestamps"}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {showDetails ? "Hide details" : "Show details"}
              </TooltipContent>
            </Tooltip>
            <Popover open={moveControlsOpen} onOpenChange={setMoveControlsOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      render={
                        <ToggleButton
                          variant={moveControlsOpen ? "outline" : "ghost"}
                          selected={moveControlsOpen}
                          size="icon-sm"
                          tabIndex={-1}
                          aria-label={
                            moveControlsOpen ? "Hide move controls" : "Show move controls"
                          }
                          aria-pressed={moveControlsOpen}
                          data-move-controls-toggle
                          onMouseDown={preventFocusSteal}
                        />
                      }
                    />
                  }
                >
                  <ArrowDownUp aria-hidden="true" />
                  <span className="sr-only">
                    {moveControlsOpen ? "Hide move controls" : "Show move controls"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {moveControlsOpen ? "Hide move controls" : "Show move controls"}
                </TooltipContent>
              </Tooltip>
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
          </ButtonGroup>
        </div>
      </div>
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
                label="Reset status filter to Active"
                onClear={clearStatusFilter}
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
