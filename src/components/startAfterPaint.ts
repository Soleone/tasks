import { noteFrameEvent } from "@/frameMetrics";

/**
 * A ref callback that holds the element's CSS animations, its descendants' included, until its
 * first frame has painted. WebKit starts an animation's clock when styles resolve, so a slow first
 * frame could use up a short entrance (the done check draws in 220 ms) before anything showed.
 * Chromium already waits for the paint. Pass it only while an entrance plays; it holds what runs.
 */
export function startAfterPaint(element: Element | null): (() => void) | undefined {
  // jsdom has no Web Animations.
  const held = element?.getAnimations?.({ subtree: true }) ?? [];
  if (held.length === 0) return;
  held.forEach((animation) => animation.pause());
  noteFrameEvent("animation held");
  // play() would restart one that already finished.
  const release = () =>
    held.forEach((animation) => animation.playState === "paused" && animation.play());
  // The first callback runs before the held frame paints, the second once it has.
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      release();
      noteFrameEvent("animation started");
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    release();
  };
}
