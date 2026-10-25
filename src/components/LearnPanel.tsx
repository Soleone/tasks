import type { ReactElement } from "react";
import { Check, Circle, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { Move } from "@/learning/moves";
import { useLearning } from "@/learning/progress";
import {
  pauseQuest,
  resumeQuest,
  startQuest,
  useQuests,
  type QuestView,
} from "@/learning/questProgress";
import { preventFocusSteal } from "@/navigation";
import { LearnIcon } from "./LearnIcon";

function questStatus(quest: QuestView): string {
  if (quest.state === "active") return "Under way";
  if (quest.state === "paused") return `Paused at step ${quest.step + 1} of ${quest.steps.length}`;
  return quest.state === "complete" ? "Complete" : "New";
}

/** The quest log behind `?` (`learn.panel`): every quest, its state and the moves it teaches. */
export function LearnPanel({
  open,
  onClose,
  onOpenPalette,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
}): ReactElement | null {
  const { moves, learned, learnedCount } = useLearning();
  const { quests } = useQuests();
  if (!open) return null;
  const keyboard = moves.some((move) => move.keys);
  // Each move is listed under the first quest that teaches it.
  const taught = new Set<string>();
  const questMoves = new Map(
    quests.map((quest) => [
      quest.id,
      quest.steps.flatMap((step): Move[] => {
        const move = moves.find((entry) => entry.id === step.move);
        if (!move || taught.has(move.id)) return [];
        taught.add(move.id);
        return [move];
      }),
    ]),
  );

  function play(quest: QuestView): void {
    if (quest.state === "active") pauseQuest();
    else {
      if (quest.state === "paused") resumeQuest(quest.id);
      else startQuest(quest.id);
      onClose();
    }
  }

  return (
    <aside
      aria-labelledby="learn-panel-title"
      aria-modal="false"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col overflow-y-auto border-l bg-card p-5 text-card-foreground shadow-xl"
      data-learn-panel
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <LearnIcon progress={learnedCount / moves.length} className="size-8 shrink-0" />
          <div>
            <h2 id="learn-panel-title" className="text-lg font-semibold">
              Learn
            </h2>
            <p className="text-sm text-muted-foreground" data-learn-count>
              {learnedCount < moves.length
                ? `${learnedCount} of ${moves.length} moves learned`
                : `All ${moves.length} moves learned`}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          onMouseDown={preventFocusSteal}
          onClick={onClose}
          aria-label="Close Learn panel"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Short quests teach Tasks a few keys at a time. Pause one whenever you like; it keeps your
        place.
      </p>
      <div className="mt-5 flex flex-col gap-5">
        {quests.map((quest) => (
          <section
            key={quest.id}
            aria-labelledby={`learn-quest-${quest.id}`}
            data-learn-quest={quest.id}
            data-quest-state={quest.state}
          >
            <div className="flex items-center justify-between gap-2 px-2">
              <div className="min-w-0">
                <h3
                  id={`learn-quest-${quest.id}`}
                  className="flex items-center gap-1.5 font-medium"
                >
                  {quest.state === "complete" ? (
                    <Trophy aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  ) : null}
                  {quest.title}
                </h3>
                <p className="text-xs text-muted-foreground">{questStatus(quest)}</p>
              </div>
              <Button
                variant={quest.state === "new" || quest.state === "paused" ? "default" : "outline"}
                size="sm"
                tabIndex={-1}
                onMouseDown={preventFocusSteal}
                onClick={() => play(quest)}
              >
                {quest.state === "active"
                  ? "Pause"
                  : quest.state === "paused"
                    ? "Resume"
                    : quest.state === "complete"
                      ? "Replay"
                      : "Start"}
              </Button>
            </div>
            <ul className="mt-1 flex flex-col">
              {questMoves.get(quest.id)?.map((move) => {
                const isLearned = learned.has(move.id);
                return (
                  <li
                    key={move.id}
                    data-move={move.id}
                    data-learned={isLearned || undefined}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                  >
                    {isLearned ? (
                      <Check aria-label="Learned" className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <Circle
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span
                      className={
                        isLearned ? "min-w-0 flex-1 text-muted-foreground" : "min-w-0 flex-1"
                      }
                    >
                      {move.label}
                    </span>
                    {move.keys ? (
                      <KbdGroup>
                        {move.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <Button
        variant="outline"
        className="mt-6 w-fit"
        tabIndex={-1}
        onMouseDown={preventFocusSteal}
        onClick={onOpenPalette}
      >
        All shortcuts
        {keyboard ? <Kbd>Ctrl/⌘ K</Kbd> : null}
      </Button>
    </aside>
  );
}
