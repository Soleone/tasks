/** The sheen's band, its sweep and its easing, which the push solves against to meet it. */
const SHINE = { band: 180, duration: 900, curve: [0.45, 0, 0.3, 1] } as const;
/** How long after the sheen reaches the done count's ring the sparks fly. */
const SPARKS_AFTER_MS = 300;
const PIP_FLIGHT_MS = 420;
const PIP_STAGGER_MS = 140;
const PUSH_MS = 520;

type Point = { x: number; y: number };

const center = (element: Element): Point => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const bezier = (u: number, a: number, b: number) =>
  3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;

/** The share of an eased animation's duration at which it reaches `progress`. */
function timeAt(progress: number, [x1, y1, x2, y2]: readonly number[]): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step++) {
    const u = (low + high) / 2;
    if (bezier(u, y1, y2) < progress) low = u;
    else high = u;
  }
  return bezier((low + high) / 2, x1, x2);
}

/** A dot or spark fixed over the page, moved by its animation's transforms. */
function speck(width: number, height: number, background: string): HTMLElement {
  const element = document.createElement("span");
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "fixed",
    left: `${-width / 2}px`,
    top: `${-height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    borderRadius: "9999px",
    background,
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.append(element);
  return element;
}

function bump(element: Element, scale: number, duration: number): void {
  element.animate(
    [{ transform: "scale(1)" }, { transform: `scale(${scale})` }, { transform: "scale(1)" }],
    { duration, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
  );
}

/** Each met goal's pip arcs into the done count's ring, bumping it as it lands, while the check fades. */
function gatherPips(met: Element, ring: Element): Promise<unknown> {
  const to = center(ring);
  const pips = [...met.querySelectorAll("circle")].reverse();
  met.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 220,
    delay: 120,
    easing: "ease-in",
    fill: "forwards",
  });
  return Promise.all(
    pips.map((pip, index) => {
      const from = center(pip);
      const dot = speck(7, 7, getComputedStyle(pip).fill);
      const bend = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 14 - index * 7 };
      const keyframes = Array.from({ length: 15 }, (_, frame) => {
        const t = frame / 14;
        const u = 1 - t;
        const x = u * u * from.x + 2 * u * t * bend.x + t * t * to.x;
        const y = u * u * from.y + 2 * u * t * bend.y + t * t * to.y;
        return {
          transform: `translate(${x}px, ${y}px) scale(${1 + 0.4 * Math.sin(Math.PI * t)})`,
          opacity: t > 0.9 ? 0 : 1,
        };
      });
      const flight = dot.animate(keyframes, {
        duration: PIP_FLIGHT_MS,
        delay: index * PIP_STAGGER_MS,
        easing: "cubic-bezier(0.5, 0, 0.3, 1)",
        fill: "backwards",
      });
      return flight.finished.then(() => {
        dot.remove();
        bump(ring, 1.15, 200);
      });
    }),
  );
}

/** Sweeps a sheen across the header. Returns when its peak reaches `ring`, in ms from now. */
function shine(header: HTMLElement, ring: Element): number {
  const box = header.getBoundingClientRect();
  const clip = document.createElement("span");
  clip.setAttribute("aria-hidden", "true");
  clip.className = "pointer-events-none absolute -inset-y-3 inset-x-0 overflow-hidden";
  const band = document.createElement("span");
  band.className = "absolute inset-y-0 left-0";
  Object.assign(band.style, {
    width: `${SHINE.band}px`,
    background:
      "linear-gradient(100deg, transparent 0%, color-mix(in oklab, var(--primary) 28%, transparent) 50%, transparent 100%)",
  });
  clip.append(band);
  header.append(clip);
  const sweep = band.animate(
    [{ transform: `translateX(${-SHINE.band}px)` }, { transform: `translateX(${box.width}px)` }],
    { duration: SHINE.duration, easing: `cubic-bezier(${SHINE.curve.join(", ")})` },
  );
  const remove = () => clip.remove();
  sweep.finished.then(remove, remove);
  const ringLeft = ring.getBoundingClientRect().left - box.left;
  const progress = (ringLeft + SHINE.band / 2) / (box.width + SHINE.band);
  return timeAt(progress, SHINE.curve) * SHINE.duration;
}

/**
 * On the frame the sheen reaches the ring, the rings' slot closes and `shifted` are knocked right
 * into it, past where they land and back, the way the done lens's list swings in. Both start on
 * the animation clock, so the contact can't drift.
 */
function closeSlot(rings: HTMLElement, shifted: Element[], contact: number): Promise<unknown> {
  const slot = rings.getBoundingClientRect().width;
  const closed = { width: "0px", padding: "0px", margin: "0px" };
  for (const element of shifted)
    element.animate(
      [
        { transform: `translateX(${-slot}px)` },
        { offset: 0.62, transform: "translateX(5px)" },
        { offset: 0.84, transform: "translateX(-1.5px)" },
        { transform: "translateX(0)" },
      ],
      { delay: contact, duration: PUSH_MS, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    );
  return rings.animate([closed, closed], { delay: contact, duration: 1, fill: "forwards" })
    .finished;
}

function sparkBurst(ring: Element, palette: string[]): void {
  const { x, y } = center(ring);
  const count = 12;
  const turn = Math.random() * 180;
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * 360 + (index % 2) * 7 + turn;
    const reach = 25 + (index % 3) * 5;
    const spark = speck(5, 1.6, palette[index % palette.length]);
    const at = (distance: number, stretch: number) =>
      `translate(${x}px, ${y}px) rotate(${angle}deg) translateX(${distance}px) scaleX(${stretch})`;
    const animation = spark.animate(
      [
        { transform: at(9, 0.4), opacity: 1 },
        { transform: at(reach * 0.6, 1.2), opacity: 1, offset: 0.45 },
        { transform: at(reach, 0.2), opacity: 0 },
      ],
      {
        duration: 620,
        delay: (index % 2) * 40,
        easing: "cubic-bezier(0.15, 0.7, 0.3, 1)",
        fill: "backwards",
      },
    );
    const remove = () => spark.remove();
    animation.finished.then(remove, remove);
  }
}

/**
 * Every goal met: the met check's pips gather into the done count's ring, then a sheen sweeps the
 * header, closing the rings' slot as it passes the ring, and sparks fly. Without the met check on
 * screen nothing moves: the sheen passes over the ring and the sparks fly. `onFolded` runs once
 * the rings' slot has closed, so they can leave the header; it must commit at once.
 */
export async function celebrateGoals(onFolded: () => void): Promise<void> {
  const header = document.querySelector<HTMLElement>("[data-app-header]");
  const ring = document.querySelector("[data-lens-count=done] svg");
  if (!header || !ring) return;
  // The last completion is still easing the ring closed.
  const filling = ring.querySelector("[data-goal-arc]")?.getAnimations() ?? [];
  await Promise.all(filling.map((animation) => animation.finished.catch(() => {})));

  const rings = document.querySelector<HTMLElement>("[data-goal-rings]");
  const met = rings?.querySelector("[data-goal-met]");
  const palette = ["var(--success)", "var(--primary)"];
  if (rings && met && rings.getBoundingClientRect().width > 0) {
    palette.unshift(
      ...[...met.querySelectorAll("circle")].map((pip) => getComputedStyle(pip).fill),
    );
    await gatherPips(met, ring);
    const shifted = [...header.querySelectorAll("[data-lens-count]")];
    const contact = shine(header, ring);
    await closeSlot(rings, shifted, contact);
    onFolded();
    // Rings that stay, as after an undo, show again.
    for (const animation of rings.getAnimations({ subtree: true })) animation.cancel();
    await wait(SPARKS_AFTER_MS);
  } else {
    onFolded();
    palette.push("var(--foreground)");
    await wait(shine(header, ring) + SPARKS_AFTER_MS);
  }
  bump(ring, 1.28, 320);
  sparkBurst(ring, palette);
}
