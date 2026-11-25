import type { ComponentProps, ReactElement, ReactNode, RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Flag,
  Folder,
  Funnel,
  ListChevronsUpDown,
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
  STATUS_PRESET_LABELS,
  statusesLabel,
  type SortDirection,
  type SortField,
  type StatusPreset,
} from "./taskFilters";
import { lensFilter, type GoalLens, type ListLens } from "./listLens";
import type { WeekDay } from "@/useHeaderCounts";
import type { GoalsToday } from "@/goals";
import { TaskListModeHelp, type TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import { SortMenu } from "./SortMenu";
import { TaskActions } from "./TaskActions";
import { FoldableGroup, type ToolbarFoldGroup } from "./ToolbarFoldableGroup";
import { ReorderMenu } from "./ReorderMenu";
import { TaskListFilterSummary } from "./TaskListFilterSummary";
import { useToolbarFeedback } from "./useToolbarFeedback";
import { ButtonRow, ToolbarGroup } from "@/components/variants/button-group";
import { ToolbarCommand, ToolbarToggle, ToolbarTooltip } from "@/components/variants/toolbar";

// What each sort shows first, descending then ascending.
const ORDER_LABELS: Record<Exclude<SortField, "manual">, [string, string]> = {
  created: ["Newest first", "Oldest first"],
  updated: ["Newest first", "Oldest first"],
  priority: ["Highest priority first", "Lowest priority first"],
  effort: ["Largest effort first", "Smallest effort first"],
  due: ["Soonest due first", "Latest due first"],
  closed: ["Recently done first", "Earliest done first"],
};

// Keep refs and actions list-owned so mouse controls and shortcuts share one path.
type TaskListToolbarProps = {
  toolbarMode: ToolbarMode | null;
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
  widenDoneLens: (backward: boolean) => void;
  /** Today's goals, shown on the done lens's count line, or null without goals. */
  goals: GoalsToday | null;
  week: readonly WeekDay[] | null;
  onOpenGoalReport: () => void;
  onGoalLens: (goal: GoalLens | undefined) => void;
  clearStatusFilter: () => void;
  clearCategoryFilter: () => void;
  clearPriorityFilter: () => void;
  clearTagFilter: () => void;
  clearSearch: () => void;
};

export function TaskListToolbar({
  toolbarMode,
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
  goals,
  week,
  onOpenGoalReport,
  onGoalLens,
  clearStatusFilter,
  clearCategoryFilter,
  clearPriorityFilter,
  clearTagFilter,
  clearSearch,
}: TaskListToolbarProps): ReactElement {
  const { feedbackTooltip, onClickCapture } = useToolbarFeedback(
    unblockedFeedbackOpen,
    setUnblockedFeedbackOpen,
  );

  // A lens replaces the status filter, so the chip names the statuses it shows.
  const statusActive = lens !== null || exactStatus !== null || statusPreset !== "active";
  const statusLabel = lens
    ? lens.kind === "agents"
      ? STATUS_PRESET_LABELS.all
      : statusesLabel(lensFilter(lens).statuses)
    : exactStatus !== null
      ? statusesLabel([exactStatus])
      : STATUS_PRESET_LABELS[statusPreset];
  const priorityLabel = priorityFilter !== null ? `P${priorityFilter}` : "Priority";
  const searchActive = searchQuery.trim() !== "";
  // Descending is the default direction. The toggle is highlighted only
  // after reversing that default to ascending order.
  const reverseActive = sortField !== "manual" && sortDirection === "asc";
  const statusIsDefault = statusPreset === "active" && exactStatus === null;

  const groupOpen = (group: ToolbarFoldGroup): boolean =>
    !foldedGroups.includes(group) || toolbarMode === group;
  const [descLabel, ascLabel] = ORDER_LABELS[sortField === "manual" ? "created" : sortField];
  const [reverseLabel, oppositeLabel] =
    sortDirection === "desc" ? [descLabel, ascLabel] : [ascLabel, descLabel];

  return (
    <div className="flex shrink-0 flex-col gap-4" onClickCapture={onClickCapture}>
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
            active={
              !statusIsDefault ||
              categoryFilter !== null ||
              priorityFilter !== null ||
              tagFilter.length > 0 ||
              searchActive ||
              showUnblocked
            }
            onFoldChange={setGroupFolded}
            tooltip={feedbackTooltip("fold-filter")}
          >
            <div className="relative">
              {toolbarMode === "filter" ? (
                <TaskListModeHelp mode="filter" onDismiss={returnToList} />
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
            {toolbarMode === "sort" ? (
              <TaskListModeHelp mode="sort" onDismiss={returnToList} />
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
              <ReorderMenu
                open={moveControlsOpen}
                onOpenChange={setMoveControlsOpen}
                tooltip={feedbackTooltip("move")}
                subjectLabel={moveSubjectLabel}
                availabilityReason={reorderAvailabilityReason}
                reorderSelection={reorderSelection}
              />
              <TaskActions {...taskActions} tooltipFor={feedbackTooltip} />
            </ButtonRow>
          </FoldableGroup>
        </div>
      </div>
      {searchInput}
      <TaskListFilterSummary
        statusLabel={statusLabel}
        statusIsDefault={statusIsDefault}
        categoryFilter={categoryFilter}
        priorityFilter={priorityFilter}
        tagFilter={tagFilter}
        searchQuery={searchQuery}
        showUnblocked={showUnblocked}
        toggleUnblockedFilter={toggleUnblockedFilter}
        summaryTaskCount={summaryTaskCount}
        lens={lens}
        widenDoneLens={widenDoneLens}
        goals={goals}
        week={week}
        onOpenGoalReport={onOpenGoalReport}
        onGoalLens={onGoalLens}
        clearStatusFilter={clearStatusFilter}
        clearCategoryFilter={clearCategoryFilter}
        clearPriorityFilter={clearPriorityFilter}
        clearTagFilter={clearTagFilter}
        clearSearch={clearSearch}
      />
    </div>
  );
}
