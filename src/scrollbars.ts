const SCROLLING_ATTRIBUTE = "data-scrolling";
const REST_DELAY_MS = 800;

/** Marks an element while it scrolls so styles.css can show its scrollbar, like overlay scrollbars. */
export function revealScrollbarsWhileScrolling(): () => void {
  const restTimers = new Map<Element, number>();
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    target.setAttribute(SCROLLING_ATTRIBUTE, "");
    window.clearTimeout(restTimers.get(target));
    restTimers.set(
      target,
      window.setTimeout(() => {
        target.removeAttribute(SCROLLING_ATTRIBUTE);
        restTimers.delete(target);
      }, REST_DELAY_MS),
    );
  };
  const options = { capture: true, passive: true };
  document.addEventListener("scroll", onScroll, options);
  return () => {
    document.removeEventListener("scroll", onScroll, options);
    for (const timer of restTimers.values()) window.clearTimeout(timer);
    restTimers.clear();
  };
}
