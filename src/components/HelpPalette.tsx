import { Fragment, useRef, type ReactElement } from "react";
import { CirclePause, Play, Sparkles } from "lucide-react";
import type { ReportRange } from "@/goalReport";
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
import { useKeymap } from "@/keymap";
import { literalWordScore } from "@/components/commandFilter";
import { Command, PaletteDialog, KeysShortcut } from "@/components/variants/command";
import {
  pauseQuest,
  replayWelcome,
  resumeQuest,
  startQuest,
  useQuests,
} from "@/learning/questProgress";
import { helpGroups, type HelpEntry } from "@/components/helpEntries";

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
  onOpenGoalReport,
  onOpenLearn,
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
  onQueueTask,
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
  onOpenGoalReport: (range: ReportRange) => void;
  onOpenLearn: () => void;
  onCreate: () => void;
  onLogDone: () => void;
  onCreateChild: (task: TaskView) => void;
  onOpenCategoryPicker: () => void;
  onOpenStatusMenu: () => void;
  onOpenPriorityMenu: () => void;
  onOpenTagPicker: () => void;
  onOpenSearch: () => void;
  activeTask?: TaskView;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
  onQueueTask: (task: TaskView, front: boolean) => void;
  onPauseTask: (task: TaskView) => void;
  onCopyTask: (task: TaskView) => void;
  onCopyImage: (task: TaskView) => void;
  canUndoStatus: boolean;
  onUndoStatus: () => void;
  canRedo: boolean;
  onRedo: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const questEntry = useQuestEntry();
  useKeymap();

  const actions: Record<NonNullable<HelpEntry["action"]>, (() => void) | undefined> = {
    "open-settings": onOpenSettings,
    "open-themes": onOpenThemes,
    "toggle-done-lens": () => onToggleLens("done"),
    "toggle-due-lens": () => onToggleLens("due"),
    "toggle-agents-lens": () => onToggleLens("agents"),
    "toggle-queue-lens": () => onToggleLens("queue"),
    "widen-done-lens": onWidenDoneLens,
    "open-goal-report": () => onOpenGoalReport("month"),
    "open-goal-report-year": () => onOpenGoalReport("year"),
    "open-learn": onOpenLearn,
    "new-task": onCreate,
    "log-done-task": onLogDone,
    "new-child-task": activeTask ? () => onCreateChild(activeTask) : undefined,
    "filter-category": onOpenCategoryPicker,
    "filter-status": onOpenStatusMenu,
    "filter-priority": onOpenPriorityMenu,
    "filter-tags": onOpenTagPicker,
    "filter-search": onOpenSearch,
    "copy-task": activeTask ? () => onCopyTask(activeTask) : undefined,
    "copy-image": activeTask ? () => onCopyImage(activeTask) : undefined,
    "add-blocker": activeTask ? () => onAddBlocker(activeTask) : undefined,
    "pause-task": activeTask ? () => onPauseTask(activeTask) : undefined,
    "move-under": activeTask ? () => onMoveUnder(activeTask) : undefined,
    "queue-task": activeTask ? () => onQueueTask(activeTask, false) : undefined,
    "queue-first": activeTask ? () => onQueueTask(activeTask, true) : undefined,
    "undo-status": canUndoStatus ? onUndoStatus : undefined,
    redo: canRedo ? onRedo : undefined,
  };

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
                  return (
                    <CommandItem
                      key={entry.label}
                      value={`${group.heading} ${label}`}
                      keywords={entryKeywords(entry)}
                      onSelect={entry.action ? actions[entry.action] : undefined}
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
