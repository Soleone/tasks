import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { flightsPlay } from "./categoryFlight";

/** How long your list takes to turn edge-on, sinking back as it goes. */
const TURN_AWAY_MS = 220;
/** How long the new list takes to swing round to face you and settle. */
const SWING_IN_MS = 520;
const COUNT_FLIGHT_MS = 230;
const SINK = "translateZ(-140px)";

/** A turn about the list's vertical center line, seen from a fixed distance. */
const turn = (degrees: number, sink = ""): string =>
  `perspective(1100px) ${sink} rotateY(${degrees}deg)`;

const headerCount = () =>
  document.querySelector<HTMLElement>("[data-lens-count=done] [data-lens-number]");
const summaryCount = () => document.querySelector<HTMLElement>("[data-summary-count]");

type Flip = {
  direction: 1 | -1;
  startedAt: number;
  /** Kept until the next flip, which cancels whatever still runs. */
  animations: Animation[];
  /** Keeps the list hidden until its new tasks load, so the old ones don't face you again. */
  hold: Animation | null;
  /** Whether the new list has started swinging in. */
  swung: boolean;
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
  const ghost = ghostOf(list);
  const animation = ghost.animate(
    [{ transform: turn(0) }, { transform: turn(90 * flip.direction, SINK), opacity: 0.5 }],
    { duration: TURN_AWAY_MS, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" },
  );
  const remove = () => ghost.remove();
  animation.finished.then(remove, remove);
  flip.animations.push(animation);
}

/** The new list swings past facing you by a few degrees, then settles. */
function swingIn(flip: Flip, list: HTMLElement, delay: number): void {
  const d = flip.direction;
  flip.animations.push(
    list.animate(
      [
        { transform: turn(-90 * d, SINK), opacity: 0.5 },
        { offset: 0.62, transform: turn(9 * d), opacity: 1 },
        { offset: 0.84, transform: turn(-3 * d) },
        { transform: turn(0) },
      ],
      { duration: SWING_IN_MS, delay, easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" },
    ),
  );
}

/**
 * Opening or leaving the done lens turns the list about its vertical center line: your list turns
 * away, and once the new tasks have loaded they swing round to face you. Into the lens the done
 * count's number flies down into the count line; out of it, it flies back to the header.
 */
export function useDoneLensFlip(
  list: RefObject<HTMLElement | null>,
  doneLensOn: boolean,
  loading: boolean,
): void {
  const wasOn = useRef(doneLensOn);
  const flip = useRef<Flip | null>(null);

  function stop(): void {
    flip.current?.animations.forEach((animation) => animation.cancel());
    flip.current?.hold?.cancel();
    flip.current = null;
  }

  useEffect(() => stop, []);

  useLayoutEffect(() => {
    if (wasOn.current === doneLensOn) return;
    wasOn.current = doneLensOn;
    stop();
    if (!flightsPlay()) return;
    const next: Flip = {
      direction: doneLensOn ? 1 : -1,
      startedAt: performance.now(),
      animations: [],
      hold: null,
      swung: false,
    };
    flip.current = next;
    if (list.current) {
      turnAway(next, list.current);
      next.hold = list.current.animate({ opacity: [0, 0] }, { duration: Infinity });
    }
    // The count line already reads as your list, starting where the lens's count stood.
    const from = summaryCount();
    const to = headerCount();
    if (!doneLensOn && from && to) flyNumber(next, from, to, 0);
  }, [doneLensOn, list]);

  // Runs after the effect above, so a view that changes and loads in one commit still turns first.
  useLayoutEffect(() => {
    const current = flip.current;
    if (!current || current.swung || loading) return;
    current.swung = true;
    current.hold?.cancel();
    const delay = Math.max(0, TURN_AWAY_MS - (performance.now() - current.startedAt));
    if (list.current) swingIn(current, list.current, delay);
    const from = headerCount();
    const to = summaryCount();
    if (current.direction === 1 && from && to) flyNumber(current, from, to, delay);
  });
}
