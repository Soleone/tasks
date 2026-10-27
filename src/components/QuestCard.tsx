import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { CircleCheck, CircleHelp, Hand, Pointer, Trophy } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/variants/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QuietButton } from "@/components/variants/button";
import { KeyCap } from "@/components/variants/kbd";
import { currentDevice, movesFor } from "@/learning/moves";
import {
  dismissComplete,
  pauseQuest,
  stepKeys,
  useQuests,
  welcomeOnce,
  type QuestView,
} from "@/learning/questProgress";
import { reopenStep, type Quest } from "@/learning/quests";
import { preventFocusSteal } from "@/navigation";

// Recap keys pop in one after another (`quest.complete`).
const RECAP_STEP_MS = 150;
// One per nth-child angle in styles.css.
const SPARK_COUNT = 8;

const CARD =
  "relative flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4";

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
  const { quests, active, offer, moment, ahead, editorOpen, welcome } = useQuests();
  const cardRef = useRef<HTMLElement>(null);
  const showing = moment?.kind !== "complete" && Boolean(active ?? offer);
  useLayoutEffect(() => {
    if (showing) welcomeOnce();
  }, [showing]);
  // The welcome starts where the first task sits, so the card measures its dock before moving.
  // Without a list on screen it plays in the dock.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!welcome || !card) return undefined;
    // Measured without the entrance slide, which would leave the start 1rem too high.
    card.style.animation = "none";
    const box = card.getBoundingClientRect();
    card.style.animation = "";
    const list = document.getElementById("task-list")?.getBoundingClientRect() ?? box;
    card.style.setProperty(
      "--welcome-x",
      `${list.left + list.width / 2 - box.left - box.width / 2}px`,
    );
    card.style.setProperty("--welcome-y", `${list.top - box.top}px`);
    card.dataset.questWelcome = "";
    return () => {
      // Already in the dock, so the entrance slide it falls back to must not play again.
      card.style.animation = "none";
      delete card.dataset.questWelcome;
    };
  }, [welcome]);
  if (moment?.kind === "complete") {
    const quest = quests.find((entry) => entry.id === moment.quest);
    return quest ? (
      <QuestComplete
        quest={quest}
        quests={quests}
        leaving={Boolean(moment.leaving)}
        onLearn={onLearn}
      />
    ) : null;
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
    <>
      {welcome ? <div data-quest-spotlight aria-hidden="true" /> : null}
      <section
        ref={cardRef}
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
        {welcome ? <Welcome /> : null}
      </section>
    </>
  );
}

/** Covers the card's own content until it fades into it (`quest.welcome`). */
function Welcome(): ReactElement {
  return (
    <div
      data-quest-greeting
      className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 rounded-xl bg-card"
    >
      <Hand data-quest-wave aria-hidden="true" className="size-8 shrink-0 text-primary" />
      <div>
        <p className="text-lg font-semibold">Welcome to Tasks</p>
        <p className="text-sm text-muted-foreground">Let's learn it one key at a time</p>
      </div>
    </div>
  );
}

/** Opens the Learn panel, where every quest and its progress live (`quest.card`). */
function LearnButton({ onLearn }: { onLearn: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <QuietButton
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

/**
 * A burst from the trophy (`quest.complete`); styles.css gives each spark its angle. The `wave`
 * follows the first one, further out, when every quest is complete.
 */
function Sparks({ wave = false }: { wave?: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-quest-sparks={wave ? "wave" : "burst"}
      className="pointer-events-none absolute inset-0"
    >
      {Array.from({ length: SPARK_COUNT }, (_, index) => (
        <span key={index} className="absolute top-1/2 left-1/2 size-1.5 rounded-full bg-primary" />
      ))}
    </span>
  );
}

function QuestComplete({
  quest,
  quests,
  leaving,
  onLearn,
}: {
  quest: QuestView;
  quests: QuestView[];
  leaving: boolean;
  onLearn: () => void;
}): ReactElement {
  useEffect(() => {
    // Listens from the next tick: the key that finished the quest is still bubbling to window.
    const timer = setTimeout(() => window.addEventListener("keydown", dismissComplete));
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", dismissComplete);
    };
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
    <section
      aria-label="Quest"
      data-quest-complete={quest.id}
      data-quest-finale={next ? undefined : true}
      data-quest-leaving={leaving || undefined}
      className={CARD}
    >
      <span
        aria-hidden="true"
        data-quest-glow
        className="pointer-events-none absolute inset-0 rounded-xl"
      />
      <div className="relative flex min-w-16 shrink-0 justify-center">
        <Trophy aria-hidden="true" data-quest-trophy className="size-10 text-primary" />
        <Sparks />
        {next ? null : <Sparks wave />}
      </div>
      <div className="min-w-0 flex-1">
        <p aria-live="polite" className="font-semibold">
          {next ? `${quest.title} complete` : "Every quest complete"}
        </p>
        <div className="mt-1.5 flex min-h-5 flex-wrap gap-1" data-quest-recap>
          {/* Every key takes its place from the start, so a wrapping recap never grows the card. */}
          {recap.map((label, index) => (
            <span
              key={label}
              className={cn(
                "flex",
                index < revealed ? "motion-safe:animate-in motion-safe:zoom-in-50" : "invisible",
              )}
            >
              <Kbd>{label}</Kbd>
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {next ? (
            `Next: ${next.title}, whenever you like`
          ) : (
            <>
              Replay any of them from <Kbd>?</Kbd>
            </>
          )}
        </p>
      </div>
      <div className="-my-2 -mr-2 shrink-0 self-start">
        <LearnButton onLearn={onLearn} />
      </div>
    </section>
  );
}
