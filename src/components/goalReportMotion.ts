import { flightsPlay } from "./categoryFlight";

/** Where the report's opening flight starts (`goals.report-motion`). */
export type ReportTakeOff =
  | { kind: "count" }
  /** The done lens's week dots, by day, measured before the list made way. */
  | { kind: "week"; dots: ReadonlyMap<string, DOMRect> }
  /** Back from a day in the done lens: no flight, the day just settles. */
  | { kind: "day" };

const FLIGHT_EASE = "cubic-bezier(.45,.05,.3,1)";
const SETTLE_EASE = "cubic-bezier(.2,.8,.3,1)";

/** The done lens's week dots on screen, by day. */
export function weekDots(): Map<string, DOMRect> {
  return new Map(
    [...document.querySelectorAll<HTMLElement>("[data-week-dot]")].map((dot) => [
      dot.dataset.weekDot!,
      dot.getBoundingClientRect(),
    ]),
  );
}

/**
 * A dot, or a copy of `copy`, rises from `from` in an arc and lands on `to`, shrinking into it.
 * Returns when it lands, in milliseconds from now.
 */
function fly(
  from: DOMRect,
  to: DOMRect,
  { copy, color, size, delay = 0, duration = 560, arc }: FlightLook,
): number {
  const flyer = copy
    ? (copy.cloneNode(true) as HTMLElement | SVGElement)
    : document.createElement("span");
  Object.assign(flyer.style, {
    position: "fixed",
    left: `${from.left + from.width / 2 - size / 2}px`,
    top: `${from.top + from.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "60",
    ...(copy ? {} : { borderRadius: "50%", background: color }),
  });
  flyer.setAttribute("aria-hidden", "true");
  document.body.append(flyer);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = (Math.min(to.width, to.height) * 0.55) / size;
  const remove = () => flyer.remove();
  flyer
    .animate(
      [
        { transform: "none", opacity: 1 },
        {
          offset: 0.5,
          transform: `translate(${dx / 2}px, ${dy / 2 - arc}px) scale(${(1 + end) / 2 + 0.25})`,
        },
        { offset: 0.88, transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${end * 1.15})`, opacity: 0 },
      ],
      { duration, delay, easing: FLIGHT_EASE, fill: "both" },
    )
    .finished.then(remove, remove);
  return delay + duration;
}

type FlightLook = {
  copy?: Element;
  color?: string;
  size: number;
  delay?: number;
  duration?: number;
  arc: number;
};

/** A day's dot color: the theme's green, faint for a day that got only part of the way. */
const dotColor = (met: boolean): string =>
  met ? "var(--success)" : "color-mix(in oklab, var(--success) 40%, var(--muted))";

const cellOf = (root: HTMLElement, day: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-day="${day}"]`);

/** Days spread out in order of their distance from `origins`, as if the report grew from them. */
function ripple(root: HTMLElement, origins: HTMLElement[], base: number, year: boolean): number {
  const at = (cell: HTMLElement): [number, number] => [
    Number(cell.dataset.row),
    Number(cell.dataset.col),
  ];
  const points = origins.map(at);
  const step = year ? 9 : 34;
  let last = 0;
  for (const cell of root.querySelectorAll<HTMLElement>("[data-row]")) {
    const [row, col] = at(cell);
    const distance = Math.min(...points.map(([r, c]) => Math.hypot(r - row, c - col)));
    const delay = base + distance * step;
    last = Math.max(last, delay);
    cell.animate(
      [
        { opacity: 0, transform: "scale(.6)" },
        { offset: 0.65, opacity: 1, transform: "scale(1.06)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 420, delay, easing: SETTLE_EASE, fill: "backwards" },
    );
  }
  return last + 420;
}

/** The streak thread draws itself backward from today, one link at a time. */
function threads(root: HTMLElement, base: number): void {
  const links = [...root.querySelectorAll<HTMLElement>("[data-thread]")].sort((a, b) =>
    b.dataset.thread!.localeCompare(a.dataset.thread!),
  );
  links.forEach((link, index) =>
    link.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: 220,
      delay: base + index * 55,
      easing: "ease-out",
      fill: "backwards",
    }),
  );
}

/** The stats count up from zero. */
function countUp(root: HTMLElement, delay: number): void {
  for (const stat of root.querySelectorAll<HTMLElement>("[data-stat]")) {
    const to = Number(stat.dataset.stat);
    const begin = performance.now() + delay;
    stat.textContent = "0";
    const step = (time: number) => {
      const progress = Math.min(1, Math.max(0, (time - begin) / 600));
      stat.textContent = String(Math.round(to * (1 - (1 - progress) ** 3)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/**
 * The report opens: the done count's ring, or each of the lens's week dots, flies to its day,
 * the days spread out from where they land, the streak thread draws in and the stats count up.
 */
export function playOpening(
  root: HTMLElement,
  takeOff: ReportTakeOff,
  today: string,
  year: boolean,
): void {
  if (!flightsPlay()) return;
  root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  if (takeOff.kind === "day") return;
  let landed = 0;
  const targets: HTMLElement[] = [];
  if (takeOff.kind === "count") {
    const ring = document.querySelector("[data-lens-count=done] svg");
    const cell = cellOf(root, today);
    if (ring && cell) {
      targets.push(cell);
      landed = fly(ring.getBoundingClientRect(), cell.getBoundingClientRect(), {
        copy: ring,
        size: 18,
        duration: 620,
        arc: 70,
      });
    }
  } else
    [...takeOff.dots].forEach(([day, from], index) => {
      const cell = cellOf(root, day);
      if (!cell) return;
      targets.push(cell);
      landed = fly(from, cell.getBoundingClientRect(), {
        color: dotColor(cell.dataset.met !== undefined),
        size: 9,
        delay: index * 45,
        arc: 36,
      });
    });
  const origin =
    targets.length > 0 ? targets : [cellOf(root, today)].filter((cell) => cell !== null);
  const settled = ripple(root, origin, landed * 0.82, year);
  if (!year) threads(root, settled - 150);
  countUp(root, landed * 0.6);
}

/** A new month or year slides in from the side it comes from, its days settling one after another. */
export function playSlide(root: HTMLElement, direction: number): void {
  if (!flightsPlay() || direction === 0) return;
  const grid = root.querySelector<HTMLElement>("[data-report-grid]");
  if (!grid) return;
  grid.animate(
    [
      { opacity: 0, transform: `translateX(${direction * 24}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: 240, easing: SETTLE_EASE },
  );
  for (const cell of grid.querySelectorAll<HTMLElement>("[data-row]")) {
    const col = Number(cell.dataset.col);
    const order = direction > 0 ? col : 6 - col;
    cell.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 260,
        delay: Math.min(order, 7) * 22 + Number(cell.dataset.row) * 10,
        easing: "ease-out",
        fill: "backwards",
      },
    );
  }
  threads(root, 320);
  countUp(root, 80);
}

function sparks(cell: HTMLElement, colors: string[]): void {
  const box = cell.getBoundingClientRect();
  for (let index = 0; index < 14; index += 1) {
    const spark = document.createElement("span");
    Object.assign(spark.style, {
      position: "fixed",
      left: `${box.left + box.width / 2 - 2.5}px`,
      top: `${box.top + box.height / 2 - 2.5}px`,
      width: "5px",
      height: "5px",
      borderRadius: "50%",
      background: colors[index % colors.length],
      pointerEvents: "none",
      zIndex: "60",
    });
    document.body.append(spark);
    const angle = (index / 14) * Math.PI * 2 + Math.random() * 0.3;
    const reach = 26 + Math.random() * 22;
    const remove = () => spark.remove();
    spark
      .animate(
        [
          { transform: "none", opacity: 1 },
          {
            transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) scale(.3)`,
            opacity: 0,
          },
        ],
        { duration: 560 + Math.random() * 200, easing: "cubic-bezier(.1,.7,.3,1)" },
      )
      .finished.then(remove, remove);
  }
}

/**
 * Today's goals are all met: its ring closes and bumps, sparks fly in the met goals' colors, the
 * thread reaches today, a sheen crosses its week and the streak ticks up.
 */
export function playDayClosed(root: HTMLElement, today: string, colors: string[]): void {
  const cell = cellOf(root, today);
  if (!flightsPlay() || !cell) return;
  cell.animate([{ transform: "none" }, { transform: "scale(1.1)" }, { transform: "none" }], {
    duration: 300,
    easing: "ease-out",
  });
  sparks(cell, colors);
  const link = root.querySelector<HTMLElement>(`[data-thread][data-to="${today}"]`);
  link?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
    duration: 260,
    delay: 260,
    easing: "ease-out",
    fill: "backwards",
    // The link to today grows out of yesterday.
  });
  const week = cell.closest<HTMLElement>("[data-week]");
  if (week) {
    const sheen = document.createElement("span");
    Object.assign(sheen.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      borderRadius: "inherit",
      background:
        "linear-gradient(100deg, transparent 30%, color-mix(in oklab, var(--foreground) 16%, transparent), transparent 70%)",
      backgroundSize: "250% 100%",
    });
    week.append(sheen);
    const remove = () => sheen.remove();
    sheen
      .animate([{ backgroundPosition: "120% 0" }, { backgroundPosition: "-20% 0" }], {
        duration: 900,
        delay: 460,
        easing: "ease-out",
        fill: "both",
      })
      .finished.then(remove, remove);
  }
  const streak = root.querySelector("[data-streak]");
  streak?.animate(
    [
      { transform: "translateY(70%)", opacity: 0 },
      { offset: 0.6, transform: "scale(1.25)", opacity: 1 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 380, delay: 880, easing: "ease-out", fill: "backwards" },
  );
}

/** A day leaves for the done lens: a dot flies from it to the lens's count line. */
export function flyDayToLens(from: DOMRect, met: boolean): void {
  if (!flightsPlay()) return;
  requestAnimationFrame(() => {
    const count = document.querySelector("[data-filter-summary] li");
    if (!count) return;
    const to = count.getBoundingClientRect();
    const landed = fly(from, to, {
      color: dotColor(met),
      size: 26,
      duration: 520,
      arc: 28,
    });
    count.animate([{ opacity: 0 }, { offset: 0.8, opacity: 0 }, { opacity: 1 }], {
      duration: landed,
      easing: "ease-out",
    });
  });
}

/** The report closes onto the done lens: this week's days fly back into its seven dots. */
export function flyWeekHome(days: ReadonlyMap<string, { box: DOMRect; met: boolean }>): void {
  if (!flightsPlay()) return;
  requestAnimationFrame(() => {
    let index = 0;
    for (const [day, { box, met }] of days) {
      const dot = document.querySelector<HTMLElement>(`[data-week-dot="${day}"]`);
      if (!dot) continue;
      const landed = fly(box, dot.getBoundingClientRect(), {
        color: dotColor(met),
        size: Math.min(box.width, box.height) * 0.5,
        duration: 520,
        delay: index * 40,
        arc: 28,
      });
      dot.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 1,
        delay: landed - 40,
        fill: "backwards",
      });
      index += 1;
    }
  });
}
