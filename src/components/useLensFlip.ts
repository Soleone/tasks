import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { flightsPlay } from "./categoryFlight";
import type { ListLens } from "./listLens";

/** How long your list takes to turn edge-on, sinking back as it goes. */
const TURN_AWAY_MS = 220;
/** How long the new list takes to swing round to face you and settle. */
const SWING_IN_MS = 520;
const COUNT_FLIGHT_MS = 230;
const SINK = "translateZ(-140px)";

type LensKind = ListLens["kind"];
type Axis = "X" | "Y";

/** Done turns sideways like a card; due turns over the top like a page on a flip calendar. */
const LENS_AXIS: Record<LensKind, Axis> = { done: "Y", due: "X" };

/** A turn about the list's center line on `axis`, seen from a fixed distance. */
const turn = (axis: Axis, degrees: number, sink = ""): string =>
  `perspective(1100px) ${sink} rotate${axis}(${degrees}deg)`;

const headerCount = (kind: LensKind) =>
  document.querySelector<HTMLElement>(`[data-lens-count=${kind}] [data-lens-number]`);
const summaryCount = () => document.querySelector<HTMLElement>("[data-summary-count]");

/** The middle of the rows on screen, so a short list turns about its tasks, not the space below. */
function rowsMiddle(list: HTMLElement): string {
  const top = list.getBoundingClientRect().top;
  const bottom = list.lastElementChild?.getBoundingClientRect().bottom ?? top;
  return `50% ${Math.min(list.clientHeight, bottom - top) / 2}px`;
}

type Flip = {
  axis: Axis;
  /** Into a lens turns one way, back to your list the other. */
  direction: 1 | -1;
  /** The lens opening, whose count flies into the count line once its tasks load. */
  entering: LensKind | null;
  startedAt: number;
  /** Kept until the next flip, which cancels whatever still runs. */
  animations: Animation[];
  /** Keeps the list hidden until its new tasks load, so the old ones don't face you again. */
  hold: Animation | null;
  /** Whether the new list has started swinging in. */
  swung: boolean;
  /** The list, which paints every row until it faces you again (see TaskList's row families). */
  turning: HTMLElement | null;
};

/** A copy of the list fixed where it stands, so it can turn away after the list changes under it. */
function ghostOf(list: HTMLElement): HTMLElement {
  const box = list.getBoundingClientRect();
  const ghost = list.cloneNode(true) as HTMLElement;
  // Row ids stay unique to the real list, which flights and focus look rows up by.
  for (const element of [ghost, ...ghost.querySelectorAll("[id]")]) element.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "40",
  });
  document.body.append(ghost);
  ghost.scrollTop = list.scrollTop;
  return ghost;
}

/**
 * The count's number lifts off `from` and lands on `to`, which stays hidden until it arrives.
 * Starts after `delay`, sitting on `from` until then.
 */
function flyNumber(flip: Flip, from: HTMLElement, to: HTMLElement, delay: number): void {
  const start = from.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  const style = getComputedStyle(to);
  const flyer = document.createElement("span");
  flyer.textContent = to.textContent;
  flyer.setAttribute("aria-hidden", "true");
  Object.assign(flyer.style, {
    position: "fixed",
    left: `${end.left}px`,
    top: `${end.top}px`,
    margin: "0",
    font: style.font,
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.append(flyer);
  to.style.visibility = "hidden";
  const dx = start.left - end.left;
  const dy = start.top - end.top;
  const animation = flyer.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, color: getComputedStyle(from).color },
      // An arc: up and a touch larger halfway, so it reads as lifting off.
      { offset: 0.45, transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 10}px) scale(1.15)` },
      { transform: "none", color: style.color },
    ],
    { duration: COUNT_FLIGHT_MS, delay, easing: "cubic-bezier(.45,.05,.2,1)", fill: "backwards" },
  );
  const land = () => {
    flyer.remove();
    to.style.visibility = "";
  };
  animation.finished.then(land, land);
  flip.animations.push(animation);
}

function turnAway(flip: Flip, list: HTMLElement): void {
  // Set first, so the ghost copied from the list keeps every row painted as it turns too.
  list.dataset.turning = "";
  flip.turning = list;
  const ghost = ghostOf(list);
  ghost.style.transformOrigin = rowsMiddle(list);
  const animation = ghost.animate(
    [
      { transform: turn(flip.axis, 0) },
      { transform: turn(flip.axis, 90 * flip.direction, SINK), opacity: 0.5 },
    ],
    { duration: TURN_AWAY_MS, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" },
  );
  const remove = () => ghost.remove();
  animation.finished.then(remove, remove);
  flip.animations.push(animation);
}

/** The new list swings past facing you by a few degrees, then settles. */
function swingIn(flip: Flip, list: HTMLElement, delay: number): void {
  const { axis, direction: d } = flip;
  const transformOrigin = rowsMiddle(list);
  const animation = list.animate(
    [
      { transformOrigin, transform: turn(axis, -90 * d, SINK), opacity: 0.5 },
      { transformOrigin, offset: 0.62, transform: turn(axis, 9 * d), opacity: 1 },
      { transformOrigin, offset: 0.84, transform: turn(axis, -3 * d) },
      { transformOrigin, transform: turn(axis, 0) },
    ],
    { duration: SWING_IN_MS, delay, easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" },
  );
  // A canceled swing leaves this to the stop that canceled it.
  animation.finished.then(
    () => delete list.dataset.turning,
    () => undefined,
  );
  flip.animations.push(animation);
}

/**
 * Opening or leaving a lens turns the list over: your list turns away, and once the new tasks have
 * loaded they swing round to face you. Into a lens its count's number flies down into the count
 * line; out of one, it flies back to the header. Switching lenses plays the new lens's turn while
 * the old count flies home.
 */
export function useLensFlip(
  list: RefObject<HTMLElement | null>,
  lensKind: LensKind | null,
  loading: boolean,
): void {
  const wasKind = useRef(lensKind);
  const flip = useRef<Flip | null>(null);

  function stop(): void {
    flip.current?.animations.forEach((animation) => animation.cancel());
    flip.current?.hold?.cancel();
    flip.current?.turning?.removeAttribute("data-turning");
    flip.current = null;
  }

  useEffect(() => stop, []);

  useLayoutEffect(() => {
    const leaving = wasKind.current;
    if (leaving === lensKind) return;
    wasKind.current = lensKind;
    stop();
    if (!flightsPlay()) return;
    const next: Flip = {
      // One of the two is a lens, since they differ.
      axis: LENS_AXIS[(lensKind ?? leaving) as LensKind],
      direction: lensKind ? 1 : -1,
      entering: lensKind,
      startedAt: performance.now(),
      animations: [],
      hold: null,
      swung: false,
      turning: null,
    };
    flip.current = next;
    if (list.current) {
      turnAway(next, list.current);
      next.hold = list.current.animate({ opacity: [0, 0] }, { duration: Infinity });
    }
    // The count line already reads as the new view, its number where the lens's count stood.
    const from = summaryCount();
    const home = leaving && headerCount(leaving);
    if (from && home) flyNumber(next, from, home, 0);
  }, [lensKind, list]);

  // Runs after the effect above, so a view that changes and loads in one commit still turns first.
  useLayoutEffect(() => {
    const current = flip.current;
    if (!current || current.swung || loading) return;
    current.swung = true;
    current.hold?.cancel();
    const delay = Math.max(0, TURN_AWAY_MS - (performance.now() - current.startedAt));
    if (list.current) swingIn(current, list.current, delay);
    const from = current.entering && headerCount(current.entering);
    const to = summaryCount();
    if (from && to) flyNumber(current, from, to, delay);
  });
}
