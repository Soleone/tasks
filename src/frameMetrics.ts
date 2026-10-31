/**
 * Frame timings around each Space press, for diagnosing animation smoothness on one machine.
 * Only builds made with VITE_FRAME_METRICS=1 record anything or show the copy button.
 */
const enabled = import.meta.env.VITE_FRAME_METRICS === "1";
/** Long enough to cover a completion: check, linger, slide, flight and count roll. */
const RECORD_MS = 1600;
const KEPT_RECORDINGS = 20;

type Recording = {
  start: number;
  rows: number;
  /** Milliseconds between consecutive frames; the first is from the key press. */
  frames: number[];
  events: { name: string; atMs: number }[];
};

const recordings: Recording[] = [];
let current: Recording | null = null;

/** Marks a moment in the recording in progress, so stalls line up with what caused them. */
export function noteFrameEvent(name: string): void {
  if (!enabled || current === null) return;
  current.events.push({ name, atMs: Math.round(performance.now() - current.start) });
}

function record(): void {
  const recording: Recording = {
    start: performance.now(),
    rows: document.querySelectorAll('[role="option"]').length,
    frames: [],
    events: [],
  };
  current = recording;
  recordings.push(recording);
  if (recordings.length > KEPT_RECORDINGS) recordings.shift();
  let last = recording.start;
  const frame = (now: number) => {
    recording.frames.push(Math.round(now - last));
    last = now;
    if (now - recording.start < RECORD_MS) requestAnimationFrame(frame);
    else if (current === recording) current = null;
  };
  requestAnimationFrame(frame);
}

/** Median frame interval while idle, which reads as the display's refresh rate. */
function idleFrameMs(): Promise<number> {
  return new Promise((resolve) => {
    const gaps: number[] = [];
    let last = performance.now();
    const frame = (now: number) => {
      gaps.push(now - last);
      last = now;
      if (gaps.length < 60) return requestAnimationFrame(frame);
      gaps.sort((a, b) => a - b);
      resolve(Math.round(gaps[30] * 10) / 10);
    };
    requestAnimationFrame(frame);
  });
}

function report(idleMs: number | null): string {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: `${innerWidth}x${innerHeight}`,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    idleFrameMs: idleMs,
    presses: recordings.map(({ rows, frames, events }) => ({
      rows,
      firstFrameMs: frames[0],
      worstFrameMs: Math.max(...frames),
      slowFrames: frames.filter((gap) => gap > 20).length,
      events,
      frames: frames.join(","),
    })),
  });
}

/** Starts recording Space presses and adds the copy button at the window's bottom left. */
export function installFrameMetrics(): void {
  if (!enabled) return;
  let idleMs: number | null = null;
  // Once startup has settled. WebKit only lets a click copy right away, so this can't wait for it.
  setTimeout(() => void idleFrameMs().then((ms) => (idleMs = ms)), 3000);
  addEventListener(
    "keydown",
    (event) => {
      if (event.key === " " && !event.repeat) record();
    },
    true,
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "fixed bottom-2 left-2 z-50 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground";
  const label = () => `Copy frame metrics (${recordings.length})`;
  button.textContent = label();
  // Keeps focus in the list, so the next Space still reaches it.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(report(idleMs)).then(
      () => (button.textContent = "Copied"),
      (caught: unknown) => (button.textContent = `Copy failed: ${String(caught)}`),
    );
    setTimeout(() => (button.textContent = label()), 2000);
  });
  addEventListener("keyup", () => (button.textContent = label()));
  document.body.append(button);
}
