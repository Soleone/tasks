import { useLayoutEffect, useRef, type RefObject } from "react";
import { flightsPlay } from "./categoryFlight";
import { PUSH_EASE, PUSH_MS } from "./useCategoryPush";

/** What the live filters are looked up by, which a filter on its way out must not answer to. */
const LIVE_MARKS = ["data-filter-remove", "data-filter-category"];

/** Puts the removed items back where they stood, then slides them out under their left edge. */
function tuck(list: HTMLElement, leaving: HTMLElement[], next: HTMLElement | null): void {
  const gap = getComputedStyle(list).columnGap;
  const stage = document.createElement("li");
  stage.dataset.filterLeaving = "true";
  stage.setAttribute("aria-hidden", "true");
  stage.inert = true;
  Object.assign(stage.style, { display: "flex", alignItems: "center", gap, overflow: "hidden" });
  stage.append(...leaving);
  for (const mark of LIVE_MARKS)
    for (const marked of stage.querySelectorAll(`[${mark}]`)) marked.removeAttribute(mark);
  list.insertBefore(stage, next);

  const timing = { duration: PUSH_MS, easing: PUSH_EASE, fill: "forwards" } as const;
  const width = stage.getBoundingClientRect().width;
  leaving[0].animate({ marginInlineStart: ["0px", `${-width}px`] }, timing);
  // The stage narrows as its items leave it; this closes the gap it would still hold at no width.
  const remove = () => stage.remove();
  stage.animate({ marginInlineEnd: ["0px", `-${gap}`] }, timing).finished.then(remove, remove);
}

/**
 * A filter removed from the summary slides out to the left, under the item before it, as the
 * filters after it close the gap. It moves like the rows the category filter pushes out.
 */
export function useFilterTuck(list: RefObject<HTMLElement | null>): void {
  const shown = useRef<HTMLElement[]>([]);

  useLayoutEffect(() => {
    const current = list.current;
    if (!current) return;
    const before = shown.current;
    shown.current = ([...current.children] as HTMLElement[]).filter(
      (item) => !item.dataset.filterLeaving,
    );
    if (!flightsPlay()) return;
    let leaving: HTMLElement[] = [];
    for (const item of before) {
      // An item removed on its own has no parent; one that went with the whole list still has.
      if (item.parentNode === null) leaving.push(item);
      else if (leaving.length) {
        tuck(current, leaving, item);
        leaving = [];
      }
    }
    if (leaving.length) tuck(current, leaving, null);
  });
}
