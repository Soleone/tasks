import { Fragment, useRef, type MouseEvent, type ReactElement, type ReactNode } from "react";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority } from "@/backend/taskModel";
import type { ClassificationOption } from "./taskView";
import { CategoryFact } from "./TaskRow";
import { useFilterTuck } from "./useFilterTuck";
import { lensPhrase, nextDoneWindow, type GoalLens, type ListLens } from "./listLens";
import { DoneLensGoals, goalLens, WeekDots } from "./GoalRings";
import { Hinted } from "./Hinted";
import { BindingKbd } from "@/components/variants/kbd";
import type { WeekDay } from "@/useHeaderCounts";
import type { GoalsToday } from "@/goals";
import { Breadcrumb, BreadcrumbItem, BreadcrumbSeparator } from "./ui/breadcrumb";
import { Tooltip, TooltipContent } from "@/components/variants/tooltip";
import { TooltipTrigger } from "./ui/tooltip";
import { preventFocusSteal } from "@/navigation";
import { CompactBreadcrumbList } from "@/components/variants/breadcrumb";

type FilterSummaryFilter = "status" | "category" | "priority" | "tags" | "search" | "unblocked";
type FilterSummaryPart = {
  filter: Exclude<FilterSummaryFilter, "status" | "category">;
  value: string;
  label: string;
  /** The tooltip, when the label repeats a value shown in full on screen. */
  hint?: string;
  onClear: () => void;
};

function FilterSummaryAction({
  filter,
  label,
  hint = label,
  onClear,
  className,
  children,
}: {
  filter: FilterSummaryFilter;
  label: string;
  hint?: string;
  onClear: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            tabIndex={-1}
            data-filter-remove={filter}
            aria-label={label}
            onMouseDown={preventFocusSteal}
            onClick={onClear}
            className={`rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring ${className ?? ""}`}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** The count line under the toolbar: what the list shows, each filter a button that clears it. */
export function TaskListFilterSummary({
  statusLabel,
  statusIsDefault,
  categoryFilter,
  priorityFilter,
  tagFilter,
  searchQuery,
  showUnblocked,
  toggleUnblockedFilter,
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
}: {
  statusLabel: string;
  statusIsDefault: boolean;
  categoryFilter: ClassificationToken | null;
  priorityFilter: TaskPriority | null;
  tagFilter: ClassificationOption[];
  searchQuery: string;
  showUnblocked: boolean;
  toggleUnblockedFilter: () => void;
  summaryTaskCount: number;
  lens: ListLens | null;
  widenDoneLens: (backward: boolean) => void;
  goals: GoalsToday | null;
  week: readonly WeekDay[] | null;
  onOpenGoalReport: () => void;
  onGoalLens: (goal: GoalLens | undefined) => void;
  clearStatusFilter: () => void;
  clearCategoryFilter: () => void;
  clearPriorityFilter: () => void;
  clearTagFilter: () => void;
  clearSearch: () => void;
}): ReactElement {
  const summaryList = useRef<HTMLOListElement | null>(null);
  useFilterTuck(summaryList);

  const priorityLabel = `P${priorityFilter}`;
  const searchActive = searchQuery.trim() !== "";
  const summaryStatus = statusLabel.toLowerCase();
  const summaryTags =
    tagFilter.length > 2
      ? `#${tagFilter[0].label} +${tagFilter.length - 1} tags`
      : tagFilter.length > 0
        ? tagFilter.map((tag) => `#${tag.label}`).join(" ")
        : null;
  const lensGoals = lens?.kind === "done" && lens.window === "day" ? goals : null;
  const narrowedTo = lens?.kind === "done" ? lens.goal : undefined;
  // Only a goal has a target: a total against all targets would look met while a goal is open.
  const lensTarget =
    lensGoals?.goals.find(
      (goal) => JSON.stringify(goalLens(goal, lensGoals)) === JSON.stringify(narrowedTo),
    )?.target ?? null;
  const summaryTarget = lensTarget !== null ? `/${lensTarget}` : "";
  const summaryPhrase = lens
    ? lensPhrase(lens)
    : `${summaryStatus} ${summaryTaskCount === 1 ? "task" : "tasks"}`;
  // The number stands alone so a lens count can fly into it (useLensFlip).
  const summaryText = (
    <>
      <span data-summary-count>{summaryTaskCount}</span>
      {summaryTarget && <span className="opacity-55">{summaryTarget}</span>} {summaryPhrase}
    </>
  );
  const clearTags = `Clear tag filters: ${tagFilter.map((tag) => `#${tag.label}`).join(" ")}`;
  const summarySuffixParts: FilterSummaryPart[] = [
    priorityFilter !== null
      ? {
          filter: "priority",
          value: priorityLabel,
          label: `Clear priority filter: ${priorityLabel}`,
          hint: "Clear priority filter",
          onClear: clearPriorityFilter,
        }
      : null,
    summaryTags !== null
      ? {
          filter: "tags",
          value: summaryTags,
          label: clearTags,
          // "+N tags" hides names, so the tooltip spells them out.
          hint: tagFilter.length > 2 ? clearTags : "Clear tag filters",
          onClear: clearTagFilter,
        }
      : null,
    searchActive
      ? {
          filter: "search",
          value: `“${searchQuery.trim()}”`,
          label: `Clear search filter: ${searchQuery.trim()}`,
          hint: "Clear search",
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

  return (
    // The done lens's week sits beside the summary, or under it on a phone (`goals.report-open`).
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <Breadcrumb
        data-filter-summary="true"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 overflow-hidden"
      >
        <CompactBreadcrumbList ref={summaryList}>
          <BreadcrumbItem className="shrink-0">
            {statusIsDefault ? (
              <span className="font-medium">{summaryText}</span>
            ) : (
              <FilterSummaryAction
                filter="status"
                label={
                  lens?.kind === "done"
                    ? `Show tasks ${lensPhrase({ kind: "done", window: nextDoneWindow(lens.window) })}`
                    : "Reset status filter to Active"
                }
                onClear={
                  lens?.kind === "done"
                    ? (event) => widenDoneLens(event.shiftKey)
                    : clearStatusFilter
                }
                className="font-medium text-foreground"
              >
                {summaryText}
              </FilterSummaryAction>
            )}
          </BreadcrumbItem>
          {lensGoals ? (
            <BreadcrumbItem className="min-w-0">
              <DoneLensGoals today={lensGoals} goal={narrowedTo} onGoal={onGoalLens} />
            </BreadcrumbItem>
          ) : null}
          {categoryFilter ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="shrink-0">
                <FilterSummaryAction
                  filter="category"
                  label={`Clear category filter: ${categoryFilter.label}`}
                  hint="Clear category filter"
                  onClear={clearCategoryFilter}
                  className="group/fact shrink-0"
                >
                  <span data-filter-category="true" className="flex">
                    <CategoryFact label={categoryFilter.label} />
                  </span>
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
                  hint={part.hint}
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
      {lensGoals && week ? (
        <Hinted
          hint={
            <>
              Goal report <BindingKbd id="goals.report" />
            </>
          }
          render={
            <button
              type="button"
              tabIndex={-1}
              data-week-strip
              onMouseDown={preventFocusSteal}
              onClick={onOpenGoalReport}
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:-ml-2"
            />
          }
        >
          This week
          <WeekDots week={week} />
        </Hinted>
      ) : null}
    </div>
  );
}
