import { useLayoutEffect, useRef, type ReactElement, type RefObject } from "react";
import { Folder, X } from "lucide-react";
import { ClassificationBadge } from "@/components/variants/badge";
import { preventFocusSteal } from "@/navigation";
import type { Classification, Marker } from "./composerShorthand";

/** A pill that just lifted out of the title, and where its marker started in the title text. */
export type PillLanding = { marker: Marker; slug: string; at: number };

const pillKey = (marker: Marker, slug: string): string => `${marker}${slug}`;

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

/** The category and tags under the title field. Clicking a pill removes it; pills are not Tab stops. */
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

  const { category, tags } = classification;
  return (
    <div
      ref={row}
      role="list"
      aria-label="Category and tags"
      className="flex min-h-5 flex-wrap items-center gap-1.5"
    >
      {category === null && tags.length === 0 ? (
        <span className="text-xs text-muted-foreground">@category · #tags</span>
      ) : null}
      {category === null ? null : (
        <span role="listitem">
          <ClassificationBadge
            kind="category"
            data-pill={pillKey("@", category)}
            render={
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove category ${category}`}
                onMouseDown={preventFocusSteal}
                onClick={() => onRemove("@", category)}
              />
            }
          >
            <Folder data-icon="inline-start" aria-hidden="true" />
            {category}
            <X data-icon="inline-end" aria-hidden="true" />
          </ClassificationBadge>
        </span>
      )}
      {tags.map((tag) => (
        <span key={tag} role="listitem">
          <ClassificationBadge
            kind="tag"
            data-pill={pillKey("#", tag)}
            render={
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove tag ${tag}`}
                onMouseDown={preventFocusSteal}
                onClick={() => onRemove("#", tag)}
              />
            }
          >
            {tag}
            <X data-icon="inline-end" aria-hidden="true" />
          </ClassificationBadge>
        </span>
      ))}
    </div>
  );
}
