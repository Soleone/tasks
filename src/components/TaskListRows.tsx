import { memo, type CSSProperties, type MouseEvent, type ReactElement } from "react";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskView } from "./taskView";
import type { VisibleTaskRow } from "./taskTree";
import { forwardStatusTransition, reverseStatusTransition } from "./taskStatusCycle";
import { taskStatusMeta } from "./taskFilters";
import { TaskRow, TaskStatusDisplay, TaskStatusToggle, taskContextMessage } from "./TaskRow";
import { TaskComposer, type ComposerState, type TaskCreateDraft } from "./TaskComposer";
import { preventFocusSteal } from "@/navigation";
import type { TaskMutationResult } from "@/platform/backendClient";
import { TaskItem } from "@/components/variants/item";
import { cn } from "cn";
import { TaskContextMenu, type TaskContextActions } from "./TaskContextMenu";

/** A task this client just saved from the editor, while its row plays `edit.saved` or `capture.saved`. */
export type SavedTask = { id: string; kind: "created" | "updated" };

const SPARK_ANGLES = [0, 60, 120, 180, 240, 300];

export type TaskOptionClick = (
  row: VisibleTaskRow,
  index: number,
  event: MouseEvent<HTMLDivElement>,
) => void;

type TaskOptionProps = {
  row: VisibleTaskRow;
  index: number;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  pending: boolean;
  feedbackVersion?: number;
  sheenStep?: number;
  saved?: SavedTask["kind"];
  exitingTaskIds: ReadonlySet<string>;
  showDetails: boolean;
  showCompletedAt: boolean;
  hiddenCategorySlug: string | null;
  taskById: ReadonlyMap<string, TaskView>;
  onClick: TaskOptionClick;
  contextActions: (row: VisibleTaskRow, index: number) => TaskContextActions;
  onToggleStatus: (task: TaskView) => void;
  onToggleExpanded: (row: VisibleTaskRow) => void;
  onSelectCategory: (category: ClassificationToken) => void;
  onSelectTag: (tag: ClassificationToken) => void;
  onCopyImage: (task: TaskView) => void;
};

export const TaskOption = memo(function TaskOption({
  row,
  index,
  active,
  selected,
  expanded,
  pending,
  feedbackVersion,
  sheenStep,
  saved,
  exitingTaskIds,
  showDetails,
  showCompletedAt,
  hiddenCategorySlug,
  taskById,
  onClick,
  contextActions,
  onToggleStatus,
  onToggleExpanded,
  onSelectCategory,
  onSelectTag,
  onCopyImage,
}: TaskOptionProps): ReactElement {
  const { task } = row;
  const blockedByLabels = task.blockedByIds
    .map((id) => {
      const blocker = taskById.get(id);
      return blocker ? blocker.title : null;
    })
    .filter((label): label is string => label !== null);
  const DisclosureIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <TaskContextMenu task={task} actions={contextActions(row, index)}>
      <TaskItem
        id={`task-option-${task.id}`}
        role="option"
        aria-selected={selected}
        aria-describedby={row.hasChildren ? `task-children-${task.id}` : undefined}
        aria-label={
          row.contextOnly ? `${task.title}, ${taskContextMessage(row.depth === 1)}` : undefined
        }
        tabIndex={-1}
        data-active={active || undefined}
        data-selected={selected || undefined}
        data-context-parent={(row.contextOnly && row.depth === 0) || undefined}
        data-context-child={(row.contextOnly && row.depth === 1) || undefined}
        data-depth={row.depth}
        nested={row.depth === 1}
        data-saved-task={saved}
        data-exiting-task={exitingTaskIds.has(task.id) || undefined}
        size="sm"
        state={selected ? "selected" : active ? "active" : row.contextOnly ? "context" : undefined}
        onClick={(event) => onClick(row, index, event)}
      >
        <TaskRow
          task={task}
          variant="full"
          indented={row.depth === 1}
          blockedByLabels={blockedByLabels}
          showDetails={showDetails}
          showCompletedAt={showCompletedAt}
          contextOnly={row.contextOnly}
          hiddenCategorySlug={hiddenCategorySlug}
          onSelectCategory={onSelectCategory}
          onSelectTag={onSelectTag}
          onCopyImage={onCopyImage}
          statusSlot={
            <TaskStatusToggle
              task={task}
              pending={pending}
              feedbackVersion={feedbackVersion}
              sheenStep={sheenStep}
              nextLabel={taskStatusMeta[forwardStatusTransition[task.status].next].label}
              previousLabel={taskStatusMeta[reverseStatusTransition[task.status].next].label}
              onToggle={onToggleStatus}
            />
          }
          disclosureSlot={
            row.hasChildren ? (
              <span
                role="img"
                aria-label={expanded ? "Collapse children" : "Expand children"}
                className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground"
                onMouseDown={preventFocusSteal}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded(row);
                }}
              >
                <DisclosureIcon aria-hidden="true" className="size-4" />
              </span>
            ) : null
          }
        />
        {saved ? (
          <span data-save-tick={saved} aria-hidden="true" className="text-primary">
            {saved === "created" ? (
              <>
                <Plus className="size-4" />
                <span data-save-sparks>
                  {SPARK_ANGLES.map((angle) => (
                    <span key={angle} style={{ "--spark-angle": `${angle}deg` } as CSSProperties} />
                  ))}
                </span>
              </>
            ) : (
              <Check className="size-4" />
            )}
          </span>
        ) : null}
        {row.hasChildren ? (
          <span id={`task-children-${task.id}`} hidden>
            Children {expanded ? "expanded" : "collapsed"}.
          </span>
        ) : null}
      </TaskItem>
    </TaskContextMenu>
  );
});

export function OptimisticTaskOption({
  task,
  showDetails,
  hiddenCategorySlug,
}: {
  task: TaskView;
  showDetails: boolean;
  hiddenCategorySlug: string | null;
}): ReactElement {
  return (
    <TaskItem
      id={`pending-task-option-${task.id}`}
      role="option"
      aria-selected={false}
      aria-disabled="true"
      aria-busy="true"
      tabIndex={-1}
      data-optimistic-task
      size="sm"
    >
      <TaskRow
        task={task}
        variant="full"
        indented={task.parentId !== null}
        showDetails={showDetails}
        hiddenCategorySlug={hiddenCategorySlug}
        statusSlot={<TaskStatusDisplay task={task} />}
      />
    </TaskItem>
  );
}

/** Leaving the editor mid-save would let the save's reply close the next editor. */
export function isEditorSaving(): boolean {
  return document.querySelector('[data-inline-task-editor] form[aria-busy="true"]') !== null;
}

// What a new task starts as, so capture shows the glyph it will save with.
const NEW_TASK_STATUS = { status: "open", priority: 2, effort: 3 } as const;

export function InlineTaskComposer({
  composer,
  onClose,
  onSaved,
  onCreatePending,
  onCreateFailed,
  onCopyImage,
  inList = false,
}: {
  composer: ComposerState;
  onClose: () => void;
  onSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  onCopyImage: (name: string) => void;
  inList?: boolean;
}): ReactElement {
  const task = composer.mode === "edit" ? composer.task : undefined;
  const parentId = composer.mode === "create" ? composer.parentId : undefined;
  const initialTitle = composer.mode === "create" ? composer.initialTitle : undefined;
  const indented = (task ? task.parentId : parentId) != null;

  // Laid out like the row it replaces: the status glyph, then the title, so nothing shifts when
  // editing starts.
  return (
    <TaskItem
      role="group"
      aria-label={task ? `Editing ${task.title}` : "New task inline"}
      data-inline-task-editor
      editor
      nested={indented}
      state="active"
      size="sm"
      className={inList ? "w-full shrink-0" : "w-full"}
    >
      <div className={cn("flex min-w-0 flex-1 items-start gap-2.5", indented && "pl-6")}>
        <div className="flex h-[1.375em] w-8 shrink-0 items-center justify-center">
          <TaskStatusDisplay task={task ?? NEW_TASK_STATUS} />
        </div>
        <TaskComposer
          key={task ? task.id : `create-${parentId ?? "root"}`}
          task={task}
          parentId={parentId}
          initialTitle={initialTitle}
          onSaved={onSaved}
          onCreatePending={onCreatePending}
          onCreateFailed={onCreateFailed}
          onCancel={onClose}
          onCopyImage={onCopyImage}
        />
      </div>
    </TaskItem>
  );
}
