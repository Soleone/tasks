export const PILL_FLIGHT_MS = 280;

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export const centerY = (box: DOMRect): number => box.top + box.height / 2;

/** A copy of `source` fixed where it stands, so a flight can start there after it is gone. */
function ghostOf(source: HTMLElement): HTMLElement {
  const from = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-filter-category");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.append(ghost);
  return ghost;
}

/** The ghost flies to `to`'s left edge, fading once `fadeFrom` of the way there, then goes. */
function flyGhost(ghost: HTMLElement, to: DOMRect, fadeFrom = 0): void {
  const from = ghost.getBoundingClientRect();
  const remove = () => ghost.remove();
  ghost
    .animate(
      [
        { transform: "none", opacity: 1 },
        { offset: fadeFrom, opacity: 1 },
        {
          transform: `translate(${to.left - from.left}px, ${centerY(to) - centerY(from)}px)`,
          opacity: 0,
        },
      ],
      { duration: PILL_FLIGHT_MS, easing: EASE_OUT },
    )
    .finished.then(remove, remove);
}

/** How far up the ghost of a row's category stays solid before it hands over to the badge. */
const HAND_OVER_AT = 0.75;

// jsdom has no Web Animations; there and with reduced motion nothing flies.
const flightsPlay = (): boolean =>
  typeof HTMLElement.prototype.animate === "function" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A copy of the category filter's badge flies to the new pill and fades as the pill fades in, so
 * the filter reads as turning into the pill. Returns the ghost so a rerun can drop it.
 */
export function flyFilterToPill(badge: HTMLElement, pill: DOMRect): HTMLElement {
  const ghost = ghostOf(badge);
  flyGhost(ghost, pill);
  return ghost;
}

/**
 * The reverse, when a row's category becomes the filter: a copy of the row's category flies up to
 * the filter's badge as the badge fades in. Call it before filtering; the row's category column
 * goes once the list is filtered, and the badge is there by the next frame.
 */
export function flyCategoryToFilter(source: HTMLElement | null): void {
  if (!source || !flightsPlay()) return;
  const ghost = ghostOf(source);
  requestAnimationFrame(() => {
    const badge = document.querySelector<HTMLElement>("[data-filter-category]");
    if (!badge) return ghost.remove();
    flyGhost(ghost, badge.getBoundingClientRect(), HAND_OVER_AT);
    badge.animate([{ opacity: 0 }, { offset: HAND_OVER_AT, opacity: 0 }, { opacity: 1 }], {
      duration: PILL_FLIGHT_MS,
      easing: EASE_OUT,
    });
  });
}
