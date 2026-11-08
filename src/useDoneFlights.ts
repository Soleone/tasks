import { useEffect, useRef, useState } from "react";
import { noteFrameEvent } from "./frameMetrics";
import { ROW_EXIT_MS } from "./useRowExits";
import { hasGoals } from "./goals";
import { readSharedSettings } from "./platform/sharedSettings";

/** The check rises once the row is 60% of the way out, so it reads as coming from where it left. */
const LAUNCH_INTO_SLIDE_MS = ROW_EXIT_MS * 0.6;
/** How long a check takes from the list's edge to the done count. */
const FLIGHT_MS = 250;
/** How far the path bows in toward the list, as a share of its length. */
const BOW = 0.24;
const FRAMES = 40;

type Point = { x: number; y: number };
type Flight = { timer: number; animation?: Animation };

const center = (box: DOMRect): Point => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2,
});

// A small wind-up, then it speeds into the count.
const pullIn = (t: number): number => 2 * t * t * t - t * t;

function curvePoint(from: Point, bend: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * bend.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * bend.y + t * t * to.y,
  };
}

const DONE_ICON = "[data-lens-count=done] svg";

/**
 * Where a completion lands with goals set: the open ring of the goal it fills, or the done count
 * when that goal is met (its ring has left the row) or there is none.
 */
function landingRing(row: HTMLElement): SVGElement | null {
  const settings = readSharedSettings();
  if (!hasGoals(settings)) return null;
  const category = row.querySelector("[data-category]")?.getAttribute("data-category") ?? null;
  const key = category !== null && category in settings.goals ? category : "";
  return document.querySelector<SVGElement>(`[data-goal-ring="${key}"] svg`);
}

/**
 * A copy of the done count's check rises from the list's right edge, level with the row that just
 * slid out there, and lands on the done count or the goal ring it fills. Null when the row or the
 * count isn't on screen.
 */
function flyCheck(taskId: string): { animation: Animation; target: SVGElement } | null {
  const row = document.getElementById(`task-option-${taskId}`);
  const list = row?.closest('[role="listbox"]');
  const count = document.querySelector<SVGElement>(DONE_ICON);
  if (!row || !list || !count) return null;
  const icon = landingRing(row) ?? count;
  const rowBox = row.getBoundingClientRect();
  const iconBox = icon.getBoundingClientRect();
  const from = { x: list.getBoundingClientRect().right - 12, y: rowBox.top + rowBox.height / 2 };
  const to = center(iconBox);
  // Bowing to the left of the line from the edge up to the count bends it in over the list.
  const bend = {
    x: (from.x + to.x) / 2 + (to.y - from.y) * BOW,
    y: (from.y + to.y) / 2 - (to.x - from.x) * BOW,
  };
  const ghost = count.cloneNode(true) as SVGElement;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${iconBox.width}px`,
    height: `${iconBox.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "50",
    filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--primary) 55%, transparent))",
  });
  document.body.append(ghost);
  const keyframes = Array.from({ length: FRAMES + 1 }, (_, index) => {
    const t = index / FRAMES;
    const eased = pullIn(t);
    const point = curvePoint(from, bend, to, eased);
    const scale = 1.25 - 0.25 * Math.min(1, Math.max(0, eased));
    return {
      offset: t,
      opacity: Math.min(1, t / 0.1),
      transform: `translate(${point.x - iconBox.width / 2}px, ${point.y - iconBox.height / 2}px) scale(${scale})`,
    };
  });
  const flight = ghost.animate(keyframes, { duration: FLIGHT_MS, easing: "linear" });
  const remove = () => ghost.remove();
  flight.finished.then(remove, remove);
  return { animation: flight, target: icon };
}

const bump = (icon: Element | null): Animation | undefined =>
  icon?.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }],
    {
      duration: 220,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
  );

/**
 * After a goal ring takes a completion, a dot in its color carries it on to the done count, whose
 * ring is the goals added up.
 */
function handOff(ring: SVGElement): void {
  const count = document.querySelector<SVGElement>(DONE_ICON);
  if (!count) return;
  const from = center(ring.getBoundingClientRect());
  const to = center(count.getBoundingClientRect());
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  const swatch = ring.getAttribute("data-swatch");
  if (swatch) dot.dataset.swatch = swatch;
  const stroke = ring.querySelector("circle:last-of-type")?.getAttribute("class") ?? "";
  Object.assign(dot.style, {
    position: "fixed",
    left: `${from.x - 3}px`,
    top: `${from.y - 3}px`,
    width: "6px",
    height: "6px",
    borderRadius: "9999px",
    pointerEvents: "none",
    zIndex: "50",
    background: swatch
      ? "var(--swatch)"
      : stroke.includes("classification")
        ? "var(--classification-category)"
        : "var(--foreground)",
  });
  document.body.append(dot);
  const dx = to.x - from.x;
  const animation = dot.animate(
    [
      { transform: "translate(0, 0) scale(0.6)", opacity: 0 },
      { transform: `translate(${dx / 2}px, -9px) scale(1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${to.y - from.y}px) scale(0.5)`, opacity: 0.9 },
    ],
    { duration: 420, delay: 120, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both" },
  );
  const remove = () => dot.remove();
  animation.finished.then(remove, remove);
}

/**
 * Checks flying from completed rows up to the header's done count. `landingTaskIds` are the
 * completions the count holds back until their check arrives.
 */
export function useDoneFlights() {
  const [landingTaskIds, setLandingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const flights = useRef(new Map<string, Flight>());

  useEffect(() => {
    const running = flights.current;
    return () =>
      running.forEach((flight) => {
        window.clearTimeout(flight.timer);
        flight.animation?.cancel();
      });
  }, []);

  function setLanding(taskId: string, landing: boolean): void {
    setLandingTaskIds((previous) => {
      const next = new Set(previous);
      if (landing) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  function land(taskId: string): void {
    flights.current.delete(taskId);
    setLanding(taskId, false);
  }

  /** Sends a completed row's check to the count partway into its slide, which starts at `slideAtMs`. */
  function launch(taskId: string, slideAtMs: number): void {
    // The confirmed write reports the completion again; its flight is already on the way.
    if (flights.current.has(taskId)) return;
    // jsdom has no Web Animations; there and with reduced motion the count rises at once.
    if (typeof document.body.animate !== "function") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setLanding(taskId, true);
    const flight: Flight = {
      timer: window.setTimeout(() => {
        const flown = flyCheck(taskId);
        if (!flown) return land(taskId);
        noteFrameEvent("check flight");
        flight.animation = flown.animation;
        flown.animation.finished.then(
          () => {
            noteFrameEvent("check landed");
            land(taskId);
            const toCount = flown.target.matches(DONE_ICON);
            // The count's ring takes a completion by filling; only its plain check bumps.
            if (!toCount || !hasGoals(readSharedSettings())) bump(flown.target);
            if (!toCount) handOff(flown.target);
          },
          () => {},
        );
      }, slideAtMs + LAUNCH_INTO_SLIDE_MS),
    };
    flights.current.set(taskId, flight);
  }

  /** Stops the given flights (all when omitted); the count shows their completions at once. */
  function cancelFlights(taskIds?: readonly string[]): void {
    for (const taskId of taskIds ?? [...flights.current.keys()]) {
      const flight = flights.current.get(taskId);
      if (!flight) continue;
      window.clearTimeout(flight.timer);
      flight.animation?.cancel();
      land(taskId);
    }
  }

  return { landingTaskIds, launch, cancelFlights };
}
