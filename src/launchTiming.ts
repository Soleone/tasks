import { invoke } from "@tauri-apps/api/core";

/** One launch, split into the steps between starting the app and its first rows on screen. */
export type LaunchTiming = {
  at: string;
  steps: { label: string; ms: number }[];
  totalMs: number;
};

type StartupPoint = "desktop" | "paths" | "documents" | "appData";
type Point = StartupPoint | "process" | "page" | "script" | "appCode" | "backend" | "list" | "rows";

const STORAGE_KEY = "tasks.launchTimings";
const KEPT_LAUNCHES = 5;
const STEPS: { label: string; from: Point; to: Point }[] = [
  { label: "window", from: "process", to: "page" },
  { label: "page", from: "page", to: "script" },
  { label: "app load", from: "script", to: "desktop" },
  { label: "mount", from: "desktop", to: "paths" },
  { label: "documents", from: "paths", to: "documents" },
  { label: "app data", from: "documents", to: "appData" },
  { label: "folder path", from: "appData", to: "appCode" },
  { label: "backend", from: "appCode", to: "backend" },
  { label: "first list", from: "backend", to: "list" },
  { label: "rows", from: "list", to: "rows" },
];

// Points are on the page's clock, where the page started loading at 0.
const points = new Map<Point, number>([["page", 0]]);
let timing = false;
let finishing = false;

function mark(point: Point): void {
  if (!points.has(point)) points.set(point, performance.now());
}

/** The main script ran. Recorded on every launch; kept only if the launch is timed. */
export function markScript(): void {
  mark("script");
}

/** Captures startup work before we know whether a remembered folder will open. */
export function markStartupStep(point: StartupPoint): void {
  mark(point);
}

/**
 * Starts timing a desktop launch that opens the remembered folder directly. The setup form
 * waits for a person, so first launches aren't timed.
 */
export async function startLaunchTiming(): Promise<void> {
  if (timing) return;
  timing = true;
  mark("appCode");
  const sent = performance.now();
  try {
    const elapsed = await invoke<number>("launch_elapsed_ms");
    // The process clock is read somewhere between asking and hearing back.
    points.set("process", (sent + performance.now()) / 2 - elapsed);
  } catch {
    // Without the process start, the launch is timed from the page.
  }
}

export function markBackendReady(): void {
  if (timing) mark("backend");
}

export function markFirstList(): void {
  if (timing) mark("list");
}

/** The first list's rows were committed. The launch ends once they are painted. */
export function markRowsShown(): void {
  if (!timing || !points.has("list") || finishing) return;
  finishing = true;
  // The timeout runs after the frame that paints the rows.
  requestAnimationFrame(() =>
    setTimeout(() => {
      mark("rows");
      save();
    }),
  );
}

function save(): void {
  const steps = STEPS.flatMap(({ label, from, to }) => {
    const start = points.get(from);
    const end = points.get(to);
    return start === undefined || end === undefined ? [] : [{ label, ms: Math.round(end - start) }];
  });
  const first = points.get("process") ?? 0;
  const launch: LaunchTiming = {
    at: new Date().toISOString(),
    steps,
    totalMs: Math.round(points.get("rows")! - first),
  };
  try {
    const kept = [launch, ...recentLaunches()].slice(0, KEPT_LAUNCHES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Without storage, launches simply aren't kept.
  }
}

/** The last few timed launches, newest first. */
export function recentLaunches(): LaunchTiming[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as LaunchTiming[]) : [];
  } catch {
    return [];
  }
}
