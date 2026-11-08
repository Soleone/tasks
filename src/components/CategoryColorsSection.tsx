import { useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { Folder } from "lucide-react";
import { cn } from "cn";
import { listCategories } from "@/platform/backendClient";
import {
  SWATCHES,
  setCategoryColor,
  useSharedSettings,
  type Swatch,
} from "@/platform/sharedSettings";
import { FOCUS_RING } from "@/components/variants/focus";
import { useLoadOnOpen } from "./useLoadOnOpen";

// By name, so rows hold still while colors change, unlike the picker's most recent first.
const loadCategories = () =>
  listCategories().then((result) =>
    [...result.categories].sort((a, b) => a.slug.localeCompare(b.slug)),
  );
const CHOICES = [...SWATCHES, null] as const;
/** How long typed letters keep adding up to one name, as in a native list. */
const TYPE_AHEAD_MS = 700;
const NEXT_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  Home: -99,
  End: 99,
};

/**
 * Settings › Categories: one row per category, each a radio group of swatches. Up and Down move
 * between categories, Left and Right pick the color, which applies at once on every device. Typing
 * a name jumps to it.
 */
export function CategoryColorsSection({ open }: { open: boolean }): ReactElement {
  const { value, loading, error } = useLoadOnOpen(open, loadCategories);
  const { colors } = useSharedSettings();
  const categories = value ?? [];
  const [active, setActive] = useState(0);
  const typed = useRef({ text: "", at: 0 });

  /** The category the typed letters name. Repeating one letter steps through its categories. */
  function typeAhead(key: string, row: number, now: number): number {
    const text = (now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : "") + key;
    typed.current = { text, at: now };
    const repeated = text === key.repeat(text.length);
    const prefix = repeated ? key : text;
    const from = repeated ? row + 1 : row;
    const order = [...categories.slice(from), ...categories.slice(0, from)];
    const match = order.find((category) => category.slug.startsWith(prefix));
    return match ? categories.indexOf(match) : row;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, row: number, slug: string): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const list = event.currentTarget.parentElement!;
    const focusRow = (index: number) =>
      list.children[index]?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const letter = /^[\p{L}\p{N}-]$/u.test(event.key) ? event.key.toLowerCase() : null;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || letter) {
      event.preventDefault();
      const next = letter
        ? typeAhead(letter, row, event.timeStamp)
        : Math.min(categories.length - 1, Math.max(0, row + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      focusRow(next);
      return;
    }
    const step = NEXT_KEYS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = CHOICES.indexOf(colors[slug] ?? null);
    const next = CHOICES[Math.min(CHOICES.length - 1, Math.max(0, index + step))];
    // Rendered at once, so focus can follow the checked swatch like a native radio group.
    flushSync(() => void setCategoryColor(slug, next));
    focusRow(row);
  }

  return (
    <section
      aria-labelledby="settings-categories"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-categories" className="text-sm font-medium">
          Category colors
        </h2>
        <p className="text-sm text-muted-foreground">
          A color tints the category's folder on every row. It's shared by all your devices.
        </p>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading categories…"
            : (error ?? "No categories yet. Add @category to a task.")}
        </p>
      ) : (
        <>
          <div className="flex max-h-72 flex-col overflow-y-auto" data-category-colors>
            {categories.map(({ slug, label }, row) => {
              const chosen = colors[slug] ?? null;
              return (
                <div
                  key={slug}
                  role="radiogroup"
                  aria-label={`@${label} color`}
                  data-category-color-row={slug}
                  className="group flex min-h-9 items-center justify-between gap-4 rounded-md px-2 focus-within:bg-muted/50 hover:bg-muted/30"
                  onKeyDown={(event) => onKeyDown(event, row, slug)}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Folder
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        chosen ? "text-(--swatch)" : "text-classification-category",
                      )}
                      data-swatch={chosen ?? undefined}
                    />
                    <span className="truncate text-foreground">{label}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {CHOICES.map((swatch) => (
                      <SwatchRadio
                        key={swatch ?? "none"}
                        swatch={swatch}
                        checked={swatch === chosen}
                        tabbable={
                          swatch === chosen && row === Math.min(active, categories.length - 1)
                        }
                        onPick={() => {
                          setActive(row);
                          void setCategoryColor(slug, swatch);
                        }}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            ↑ ↓ category · type a name to jump · ← → color
          </p>
        </>
      )}
    </section>
  );
}

/** Unchecked swatches show only while their row has focus or the pointer, so the list stays calm. */
function SwatchRadio({
  swatch,
  checked,
  tabbable,
  onPick,
}: {
  swatch: Swatch | null;
  checked: boolean;
  tabbable: boolean;
  onPick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={swatch ?? "No color"}
      tabIndex={checked ? (tabbable ? 0 : -1) : -1}
      data-swatch={swatch ?? "none"}
      onClick={onPick}
      className={cn(
        FOCUS_RING,
        "relative size-4 shrink-0 rounded-full focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        checked
          ? "ring-1 ring-foreground ring-offset-2 ring-offset-popover"
          : "hidden group-focus-within:block group-hover:block",
        swatch === null
          ? "border border-muted-foreground after:absolute after:inset-y-0.5 after:left-1/2 after:w-px after:rotate-45 after:bg-muted-foreground"
          : "bg-(--swatch)",
      )}
    />
  );
}
