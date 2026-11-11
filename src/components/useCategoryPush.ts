import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { flightsPlay } from "./categoryFlight";
import type { ListLens } from "./listLens";

/** How long a row takes to be pushed out past the list's left edge, or to come back in. */
export const PUSH_MS = 160;
/** How long a kept row takes to reach its new place, overshoot and settle. */
const MOVE_MS = 200;
/** How long before one stage ends the next one starts. */
const OVERLAP_MS = 93;
/** Rows go one after another this far apart, closer when many go, so the last starts within the span. */
const ROW_DELAY_MS = 17;
const STAGGER_SPAN_MS = 67;
/** A long move overshoots no further than a short one would, or it reads as a bounce, not a settle. */
const MAX_OVERSHOOT_PX = 8;
export const PUSH_EASE = "cubic-bezier(.5,0,.9,.5)";
const SLIDE_EASE = "cubic-bezier(.2,.8,.2,1)";
const SWING_EASE = "cubic-bezier(.2,.7,.3,1)";

type Shot = { box: DOMRect; ghost: HTMLElement };

type Push = {
  /** The rows on screen when the filter changed, by task id. */
  rows: Map<string, Shot>;
  /** Kept until the next change, which cancels whatever still runs. */
  animations: Animation[];
  /** Clips the pushed-out rows at the list's edges. */
  stage: HTMLElement | null;
  played: boolean;
};

const rowsOf = (list: HTMLElement) => list.querySelectorAll<HTMLElement>("[data-task-id]");

function onScreen(box: DOMRect, list: DOMRect): boolean {
  return box.bottom > list.top && box.top < list.bottom;
}

function stagger(count: number): number {
  return count > 1 ? Math.min(ROW_DELAY_MS, STAGGER_SPAN_MS / (count - 1)) : 0;
}

/** Past its place by a tenth of the way, back a third of that, then still, like the lens turn. */
function settle(dy: number): Keyframe[] {
  const over = Math.sign(dy) * Math.min(Math.abs(dy) * 0.1, MAX_OVERSHOOT_PX);
  return [
    { transform: `translateY(${dy}px)` },
    { offset: 0.62, transform: `translateY(${-over}px)` },
    { offset: 0.84, transform: `translateY(${over / 3}px)` },
    { transform: "none" },
  ];
}

/** The rows on screen, where they stand, with copies to push out if they drop out of the list. */
function snapshot(list: HTMLElement): Map<string, Shot> {
  const view = list.getBoundingClientRect();
  const rows = new Map<string, Shot>();
  for (const row of rowsOf(list)) {
    const box = row.getBoundingClientRect();
    if (!onScreen(box, view)) continue;
    const ghost = row.cloneNode(true) as HTMLElement;
    // Row ids stay unique to the real list, which flights and focus look rows up by.
    for (const element of [ghost, ...ghost.querySelectorAll("[id]")]) element.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    rows.set(row.dataset.taskId ?? "", { box, ghost });
  }
  return rows;
}

function pushOut(push: Push, view: DOMRect, leaving: Shot[]): void {
  const stage = document.createElement("div");
  Object.assign(stage.style, {
    position: "fixed",
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: `${view.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "40",
  });
  document.body.append(stage);
  push.stage = stage;
  const step = stagger(leaving.length);
  leaving.forEach(({ box, ghost }, index) => {
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${box.left - view.left}px`,
      top: `${box.top - view.top}px`,
      width: `${box.width}px`,
      margin: "0",
    });
    stage.append(ghost);
    push.animations.push(
      ghost.animate(
        [{ transform: "none" }, { transform: `translateX(${view.left - box.right}px)` }],
        {
          duration: PUSH_MS,
          delay: index * step,
          easing: PUSH_EASE,
          fill: "forwards",
        },
      ),
    );
  });
  const remove = () => stage.remove();
  Promise.allSettled(push.animations.map((animation) => animation.finished)).then(remove, remove);
}

/**
 * Tasks that drop out are pushed out past the list's left edge one after another; then the tasks
 * that stay slide to their new places, overshoot a little and settle, and tasks that come in
 * slide in from behind that edge. Only rows on screen move.
 */
function play(push: Push, list: HTMLElement): void {
  const view = list.getBoundingClientRect();
  const kept: [HTMLElement, number][] = [];
  const entering: [HTMLElement, DOMRect][] = [];
  const shown = new Set<string>();
  for (const row of rowsOf(list)) {
    const id = row.dataset.taskId ?? "";
    shown.add(id);
    const box = row.getBoundingClientRect();
    const before = push.rows.get(id);
    if (before) kept.push([row, before.box.top - box.top]);
    else if (onScreen(box, view)) entering.push([row, box]);
  }
  const leaving = [...push.rows].filter(([id]) => !shown.has(id)).map(([, shot]) => shot);
  const moving = kept.filter(([, dy]) => Math.abs(dy) > 0.5);

  const leaveEnd = leaving.length ? PUSH_MS + stagger(leaving.length) * (leaving.length - 1) : 0;
  const moveAt = leaving.length ? leaveEnd - OVERLAP_MS : 0;
  const enterAt = moving.length ? moveAt + MOVE_MS - OVERLAP_MS : moveAt;

  if (leaving.length) pushOut(push, view, leaving);
  for (const [row, dy] of moving)
    push.animations.push(
      row.animate(settle(dy), {
        duration: MOVE_MS,
        delay: moveAt,
        easing: SWING_EASE,
        fill: "backwards",
      }),
    );
  const step = stagger(entering.length);
  entering.forEach(([row, box], index) => {
    push.animations.push(
      row.animate(
        [{ transform: `translateX(${view.left - box.right}px)` }, { transform: "none" }],
        { duration: PUSH_MS, delay: enterAt + index * step, easing: SLIDE_EASE, fill: "backwards" },
      ),
    );
  });
}

/**
 * Setting, changing or clearing the category filter pushes the rows that drop out off the list's
 * left edge and settles the rest into place. A lens opening or closing turns the list instead.
 */
export function useCategoryPush(
  list: RefObject<HTMLElement | null>,
  categorySlug: string | null,
  lensKind: ListLens["kind"] | null,
  loading: boolean,
): void {
  const was = useRef({ categorySlug, lensKind });
  const push = useRef<Push | null>(null);

  function stop(): void {
    push.current?.animations.forEach((animation) => animation.cancel());
    push.current?.stage?.remove();
    push.current = null;
  }

  useEffect(() => stop, []);

  // The rows still show the old view here: its tasks load after this commit.
  useLayoutEffect(() => {
    const before = was.current;
    if (before.categorySlug === categorySlug && before.lensKind === lensKind) return;
    was.current = { categorySlug, lensKind };
    // Measured before stopping, so a quick reversal starts from where rows are mid-flight.
    const rows =
      list.current && before.lensKind === lensKind && flightsPlay() ? snapshot(list.current) : null;
    stop();
    if (rows) push.current = { rows, animations: [], stage: null, played: false };
  }, [categorySlug, lensKind, list]);

  // Runs after the effect above, so a view that changes and loads in one commit still measures first.
  useLayoutEffect(() => {
    const current = push.current;
    if (!current || current.played || loading || !list.current) return;
    current.played = true;
    play(current, list.current);
  });
}
