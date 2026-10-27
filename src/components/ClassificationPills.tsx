import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { CalendarDays, Folder, X } from "lucide-react";
import { localToday } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import { ClassificationBadge } from "@/components/variants/badge";
import { preventFocusSteal } from "@/navigation";
import type { Classification, Marker } from "./composerShorthand";

/** A pill that just lifted out of the title, and where its marker started in the title text. */
export type PillLanding = { marker: Marker; slug: string; at: number };

type Pill = { marker: Marker; slug: string; kind: "category" | "tag" | "due"; label: string };

/** A pill on its way out, shown at `index` among the pills until its exit has played. */
type LeavingPill = { id: number; pill: Pill; index: number };

const PILL_EXIT_MS = 160;

const pillKey = (marker: Marker, slug: string): string => `${marker}${slug}`;

const removeNoun = { category: "category", tag: "tag", due: "due date" };

function pillsOf({ category, tags, due }: Classification): Pill[] {
  return [
    ...(category === null
      ? []
      : [{ marker: "@", slug: category, kind: "category", label: category } as const]),
    ...tags.map((tag) => ({ marker: "#", slug: tag, kind: "tag", label: tag }) as const),
    ...(due === null
      ? []
      : [
          {
            marker: "^",
            slug: due,
            kind: "due",
            label: formatDueDate(due, localToday()),
          } as const,
        ]),
  ];
}

// The pills in order, with each leaving pill back where it was.
function withLeaving(pills: Pill[], leaving: LeavingPill[]): (Pill | LeavingPill)[] {
  const shown: (Pill | LeavingPill)[] = [...pills];
  for (const exit of [...leaving].sort((a, b) => a.index - b.index))
    shown.splice(Math.min(exit.index, shown.length), 0, exit);
  return shown;
}

const exitsPlay = (): boolean =>
  // jsdom has no Web Animations; there a removed pill simply goes.
  typeof HTMLElement.prototype.animate === "function" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

let nextLeavingId = 0;

// The x position of a code unit in the title field, measured with the field's own font.
function titleOffset(input: HTMLInputElement, index: number): { x: number; y: number } | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const style = getComputedStyle(input);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const box = input.getBoundingClientRect();
  const lead = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  const x = box.left + lead + context.measureText(input.value.slice(0, index)).width;
  return { x: Math.min(x - input.scrollLeft, box.right), y: box.top + box.height / 2 };
}

function PillContent({ pill }: { pill: Pill }): ReactElement {
  return (
    <>
      {pill.kind === "category" ? <Folder data-icon="inline-start" aria-hidden="true" /> : null}
      {pill.kind === "due" ? <CalendarDays data-icon="inline-start" aria-hidden="true" /> : null}
      {pill.label}
      <X data-icon="inline-end" aria-hidden="true" />
    </>
  );
}

/** The pills under the title field. Clicking a pill removes it; pills are not Tab stops. */
export function ClassificationPills({
  classification,
  landing,
  titleInput,
  onRemove,
}: {
  classification: Classification;
  landing: PillLanding | null;
  titleInput: RefObject<HTMLInputElement | null>;
  onRemove: (marker: Marker, slug: string) => void;
}): ReactElement {
  const row = useRef<HTMLDivElement>(null);
  const pills = pillsOf(classification);
  const signature = pills.map((pill) => pillKey(pill.marker, pill.slug)).join(" ");
  const [exits, setExits] = useState(() => ({ signature, pills, leaving: [] as LeavingPill[] }));
  const started = useRef(new Set<number>());

  // A pill gone since the last render stays in its place while its exit plays.
  let leaving = exits.leaving;
  if (exits.signature !== signature) {
    const kept = new Set(pills.map((pill) => pillKey(pill.marker, pill.slug)));
    leaving = withLeaving(exits.pills, exits.leaving).flatMap((shown, index) => {
      const pill = "pill" in shown ? shown.pill : shown;
      if (kept.has(pillKey(pill.marker, pill.slug))) return [];
      if ("pill" in shown) return [{ ...shown, index }];
      return exitsPlay() ? [{ id: nextLeavingId++, pill, index }] : [];
    });
    setExits({ signature, pills, leaving });
  }

  useLayoutEffect(() => {
    const gap = row.current ? parseFloat(getComputedStyle(row.current).columnGap) || 0 : 0;
    for (const { id } of leaving) {
      if (started.current.has(id)) continue;
      const element = row.current?.querySelector<HTMLElement>(`[data-leaving-pill="${id}"]`);
      if (!element) continue;
      started.current.add(id);
      // The negative margin closes its gap, so the pills after it slide over.
      const width = element.getBoundingClientRect().width + gap;
      const drop = () => {
        started.current.delete(id);
        setExits((current) => ({
          ...current,
          leaving: current.leaving.filter((exit) => exit.id !== id),
        }));
      };
      element
        .animate(
          [
            { opacity: 1, transform: "scale(1)", marginInlineEnd: "0px" },
            { opacity: 0, transform: "scale(0.6)", marginInlineEnd: `${-width}px` },
          ],
          { duration: PILL_EXIT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
        )
        .finished.then(drop, drop);
    }
  }, [leaving]);

  // The new pill flies from where its marker was typed.
  useLayoutEffect(() => {
    if (!landing || !titleInput.current) return;
    const pill = row.current?.querySelector<HTMLElement>(
      `[data-pill="${pillKey(landing.marker, landing.slug)}"]`,
    );
    // jsdom has no Web Animations; there the pill simply appears.
    if (!pill || typeof pill.animate !== "function") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = titleOffset(titleInput.current, landing.at);
    if (!from) return;
    const to = pill.getBoundingClientRect();
    pill.animate(
      [
        {
          transform: `translate(${from.x - to.left}px, ${from.y - (to.top + to.height / 2)}px)`,
          opacity: 0.4,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, [landing, titleInput]);

  const shown = withLeaving(pills, leaving);
  return (
    <div
      ref={row}
      role="list"
      aria-label="Category, tags and due date"
      className="flex min-h-5 flex-wrap items-center gap-1.5"
    >
      {shown.length === 0 ? (
        <span className="text-xs text-muted-foreground">@category #tags ^date</span>
      ) : null}
      {shown.map((entry) =>
        "pill" in entry ? (
          <span
            key={`leaving-${entry.id}`}
            data-leaving-pill={entry.id}
            aria-hidden="true"
            className="pointer-events-none flex"
          >
            <ClassificationBadge kind={entry.pill.kind}>
              <PillContent pill={entry.pill} />
            </ClassificationBadge>
          </span>
        ) : (
          <span key={pillKey(entry.marker, entry.slug)} role="listitem" className="flex">
            <ClassificationBadge
              kind={entry.kind}
              touchTarget
              data-pill={pillKey(entry.marker, entry.slug)}
              render={
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${removeNoun[entry.kind]} ${entry.label}`}
                  onMouseDown={preventFocusSteal}
                  onClick={() => onRemove(entry.marker, entry.slug)}
                />
              }
            >
              <PillContent pill={entry} />
            </ClassificationBadge>
          </span>
        ),
      )}
    </div>
  );
}
