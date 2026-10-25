import type { ReactElement } from "react";
import { Check, Circle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { CHAPTERS } from "@/learning/moves";
import { useLearning } from "@/learning/progress";
import { preventFocusSteal } from "@/navigation";
import { LearnIcon } from "./LearnIcon";

/** The quest log behind `?` (`learn.panel`): every move for this device, by chapter. */
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
  if (!open) return null;
  const next = moves.find((move) => !learned.has(move.id));
  const keyboard = moves.some((move) => move.keys);

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
              {next
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
        Each move checks off the first time you use it, and its hints retire.
      </p>
      <div className="mt-5 flex flex-col gap-5">
        {CHAPTERS.map((chapter) => {
          const chapterMoves = moves.filter((move) => move.chapter === chapter);
          if (chapterMoves.length === 0) return null;
          const done = chapterMoves.filter((move) => learned.has(move.id)).length;
          return (
            <section key={chapter} aria-label={chapter} data-learn-chapter={chapter}>
              <div className="mb-1 flex items-center justify-between px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <h3>{chapter}</h3>
                <span>
                  {done}/{chapterMoves.length}
                </span>
              </div>
              <ul className="flex flex-col">
                {chapterMoves.map((move) => {
                  const isLearned = learned.has(move.id);
                  const isNext = move.id === next?.id;
                  return (
                    <li
                      key={move.id}
                      data-move={move.id}
                      data-learned={isLearned || undefined}
                      data-next={isNext || undefined}
                      className={
                        isNext
                          ? "flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-sm"
                          : "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                      }
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
                      {isNext ? <Badge variant="outline">Next</Badge> : null}
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
          );
        })}
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
