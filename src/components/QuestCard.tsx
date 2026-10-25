import { useEffect, useState, type ReactElement } from "react";
import { CircleCheck, CircleHelp, Pointer, Trophy } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyCap } from "@/components/variants/kbd";
import { currentDevice, movesFor } from "@/learning/moves";
import {
  dismissComplete,
  pauseQuest,
  stepKeys,
  useQuests,
  type QuestView,
} from "@/learning/questProgress";
import { reopenStep, type Quest } from "@/learning/quests";
import { preventFocusSteal } from "@/navigation";

// Recap keys pop in one after another (`quest.complete`).
const RECAP_STEP_MS = 150;

const CARD =
  "flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4";

/** Quest text, with the parts in backticks shown as keys. */
function KeyedText({ text }: { text: string }): ReactElement {
  return (
    <>
      {text
        .split("`")
        .map((part, index) => (index % 2 === 1 ? <Kbd key={index}>{part}</Kbd> : part))}
    </>
  );
}

/** The sentence to act on, and the muted one after it (`quest.card`). */
function splitHint(text: string): [line: string, hint: string | undefined] {
  const end = text.indexOf(". ");
  return end < 0 ? [text, undefined] : [text.slice(0, end), text.slice(end + 2)];
}

/**
 * The quest card (`quest.card`): the step to do now, its reward once done, and the finished
 * quest's recap. It never takes focus or handles a key; Later puts the quest aside.
 */
export function QuestCard({ onLearn }: { onLearn: () => void }): ReactElement | null {
  const { quests, active, offer, moment, ahead, editorOpen } = useQuests();
  if (moment?.kind === "complete") {
    const quest = quests.find((entry) => entry.id === moment.quest);
    return quest ? <QuestComplete quest={quest} quests={quests} onLearn={onLearn} /> : null;
  }
  const quest = active ?? offer;
  if (!quest) return null;
  const index = active?.step ?? 0;
  const step = quest.steps[index];
  if (!step) return null;
  const reopen = Boolean(active && step.inEditor && !editorOpen);
  const shown = reopen ? reopenStep(currentDevice()) : step;
  const keys = stepKeys(shown);
  const success = moment?.kind === "success" ? moment : null;
  const [line, hint] = success
    ? splitHint(success.line)
    : active
      ? splitHint(shown.prompt)
      : [step.prompt, quest.summary];

  return (
    <section
      aria-label="Quest"
      data-quest-card={quest.id}
      data-quest-step={active ? index : undefined}
      data-quest-reopen={reopen || undefined}
      className={CARD}
    >
      <div
        key={success ? `done-${index}` : index}
        className="flex min-w-16 shrink-0 justify-center gap-1 motion-safe:animate-in motion-safe:fade-in"
      >
        {success ? (
          <CircleCheck
            aria-hidden="true"
            className="size-10 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300"
          />
        ) : keys ? (
          keys.map((key) => <KeyCap key={key}>{key}</KeyCap>)
        ) : (
          <Pointer aria-hidden="true" className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{quest.title}</span>
          <StepDots quest={quest} done={(step) => step < index || ahead.includes(step)} />
        </div>
        <p
          key={success ? `done-${index}` : index}
          aria-live="polite"
          data-quest-line
          className={cn(
            "mt-1 text-sm motion-safe:animate-in motion-safe:fade-in",
            success ? "font-medium" : "motion-safe:slide-in-from-bottom-1",
          )}
        >
          <KeyedText text={line} />
        </p>
        {hint ? (
          <p className="mt-0.5 text-sm text-muted-foreground" data-quest-hint>
            <KeyedText text={hint} />
          </p>
        ) : null}
        {success?.tryKeys ? (
          <p className="mt-0.5 text-xs text-muted-foreground" data-quest-try>
            Next time, try <Kbd>{success.tryKeys.join("+")}</Kbd>
          </p>
        ) : null}
      </div>
      <div className="-my-2 -mr-2 flex shrink-0 flex-col items-end justify-between gap-2 self-stretch">
        <LearnButton onLearn={onLearn} />
        <Button
          variant="ghost"
          size="sm"
          tabIndex={-1}
          onMouseDown={preventFocusSteal}
          onClick={pauseQuest}
        >
          Later
        </Button>
      </div>
    </section>
  );
}

/** Opens the Learn panel, where every quest and its progress live (`quest.card`). */
function LearnButton({ onLearn }: { onLearn: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-keyshortcuts="Shift+/"
            onMouseDown={preventFocusSteal}
            onClick={onLearn}
          />
        }
      >
        <CircleHelp aria-hidden="true" />
        <span className="sr-only">All quests</span>
      </TooltipTrigger>
      <TooltipContent>
        All quests <Kbd>?</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function StepDots({
  quest,
  done,
}: {
  quest: Quest;
  done: (step: number) => boolean;
}): ReactElement {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {quest.steps.map((_, step) => (
        <span
          key={step}
          data-step-done={done(step) || undefined}
          className={cn(
            "size-1.5 rounded-full transition-colors",
            done(step) ? "bg-primary" : "bg-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

function QuestComplete({
  quest,
  quests,
  onLearn,
}: {
  quest: QuestView;
  quests: QuestView[];
  onLearn: () => void;
}): ReactElement {
  useEffect(() => {
    window.addEventListener("keydown", dismissComplete);
    return () => window.removeEventListener("keydown", dismissComplete);
  }, []);
  const moves = movesFor(currentDevice());
  const recap = [
    ...new Set(
      quest.steps.flatMap((step) => {
        const label =
          stepKeys(step)?.join(" ") ?? moves.find((move) => move.id === step.move)?.label;
        return label ? [label] : [];
      }),
    ),
  ];
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (revealed >= recap.length) return undefined;
    const timer = setTimeout(() => setRevealed((count) => count + 1), RECAP_STEP_MS);
    return () => clearTimeout(timer);
  }, [revealed, recap.length]);
  const later = quests.slice(quests.indexOf(quest) + 1);
  const next = [...later, ...quests].find(
    (entry) => entry.id !== quest.id && entry.state !== "complete",
  );

  return (
    <section aria-label="Quest" data-quest-complete={quest.id} className={CARD}>
      <div className="flex min-w-16 shrink-0 justify-center">
        <Trophy
          aria-hidden="true"
          className="size-10 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:spin-in-12 motion-safe:duration-500"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p aria-live="polite" className="font-semibold">
          {quest.title} complete
        </p>
        <div className="mt-1.5 flex min-h-5 flex-wrap gap-1" data-quest-recap>
          {recap.slice(0, revealed).map((label) => (
            <span key={label} className="flex motion-safe:animate-in motion-safe:zoom-in-50">
              <Kbd>{label}</Kbd>
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {next ? `Next: ${next.title}, whenever you like` : "Every quest complete"}
        </p>
      </div>
      <div className="-my-2 -mr-2 shrink-0 self-start">
        <LearnButton onLearn={onLearn} />
      </div>
    </section>
  );
}
