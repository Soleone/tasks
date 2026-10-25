import type { ReactElement } from "react";
import { Check, Lightbulb } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import type { Move } from "@/learning/moves";

/** Lesson text, with the parts in backticks shown as keys. */
function KeyedText({ text }: { text: string }): ReactElement {
  return (
    <>
      {text
        .split("`")
        .map((part, index) => (index % 2 === 1 ? <Kbd key={index}>{part}</Kbd> : part))}
    </>
  );
}

/** The editor's one-line lesson (`learn.nudge`), checked once the move is done (`learn.nudge-done`). */
export function MoveNudge({
  id,
  move,
  done,
}: {
  id: string;
  move: Move & { nudge: string };
  done: boolean;
}): ReactElement {
  return (
    <p
      id={id}
      data-move-nudge={move.id}
      data-done={done || undefined}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {done ? (
        <Check
          aria-hidden="true"
          className="size-3.5 shrink-0 text-primary motion-safe:animate-in motion-safe:zoom-in-50"
        />
      ) : (
        <Lightbulb aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span>
        <KeyedText text={move.nudge} />
      </span>
    </p>
  );
}
