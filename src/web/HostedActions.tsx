import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { Corner, DownloadButton } from "@/components/live/corners";
import SquishSwitch from "@/components/react-bits/SquishSwitch";
import { showTaskToast } from "@/components/TaskToaster";
import { Tooltip } from "@/components/variants/tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal } from "@/navigation";

export const RELEASES_URL = "https://github.com/Soleone/tasks/releases/latest";
const SAMPLE_IDS_KEY = "tasks.sampleTaskIds";
const SWITCH_ID = "example-tasks-switch";
const TASK_ROWS = '[role="option"][data-depth]';

/** The tooltip names an action only where the button shows just its icon. */
function Labeled({
  label,
  side,
  children,
}: {
  label: string;
  side: "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="xl:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Where the quest card reaches under a corner, as on phones, the corner sits just above it. */
function useAboveQuestCard(): RefObject<HTMLDivElement | null> {
  const corner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = () => {
      const element = corner.current;
      const card = document.querySelector("[data-quest-card]")?.getBoundingClientRect();
      if (!element) return;
      const box = element.getBoundingClientRect();
      const covers = card && card.left < box.right && card.right > box.left;
      element.style.bottom = covers ? `${window.innerHeight - card.top + 12}px` : "";
    };
    // The card comes and goes, and its text changes its height.
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    place();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return corner;
}

const MATERIALIZE: Keyframe[] = [
  { opacity: 0, filter: "blur(6px)", transform: "scale(1.04)" },
  { opacity: 1, filter: "none", transform: "none" },
];
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Brings each task row that appears from now on into focus from a soft blur, top to bottom, until
 * the returned function stops it.
 */
function materializeNewRows(): () => void {
  if (reducedMotion()) return () => {};
  const seen = new Set(document.querySelectorAll(TASK_ROWS));
  const observer = new MutationObserver(() => {
    const fresh = [...document.querySelectorAll(TASK_ROWS)].filter((row) => !seen.has(row));
    fresh.forEach((row, index) => {
      seen.add(row);
      for (const part of row.children)
        part.animate(MATERIALIZE, {
          duration: 230,
          delay: index * 15,
          easing: "ease-out",
          fill: "backwards",
        });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** The reverse, for the rows of these tasks: they blur away, top to bottom, and stay hidden. */
function dematerializeRows(ids: string[]): Animation[] {
  if (reducedMotion()) return [];
  const rows = [...document.querySelectorAll<HTMLElement>(TASK_ROWS)].filter((row) =>
    ids.includes(row.dataset.taskId ?? ""),
  );
  return rows.flatMap((row, index) =>
    [...row.children].map((part) =>
      part.animate([...MATERIALIZE].reverse(), {
        duration: 150,
        delay: index * 10,
        easing: "ease-in",
        fill: "forwards",
      }),
    ),
  );
}

function storedSampleIds(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(SAMPLE_IDS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The list reloads when the window regains focus, as after the CLI changes tasks; this saves
 * waiting up to 1.5 s for its next check. */
const reloadList = () => window.dispatchEvent(new Event("focus"));

/** The web build's corners: example tasks to switch on and off, and the way to the apps. */
export function HostedActions({
  addSamples,
  removeSamples,
}: {
  addSamples: () => Promise<string[]>;
  removeSamples: (ids: string[]) => Promise<void>;
}) {
  // The switch moves at once; the tasks follow, one change at a time, in the order asked for.
  const [on, setOn] = useState(() => storedSampleIds().length > 0);
  const queue = useRef(Promise.resolve());
  const left = useAboveQuestCard();
  const right = useAboveQuestCard();

  async function show(): Promise<void> {
    // Started first, since the list may pick up some tasks while the rest are still being added.
    const stop = materializeNewRows();
    try {
      localStorage.setItem(SAMPLE_IDS_KEY, JSON.stringify(await addSamples()));
      reloadList();
    } finally {
      setTimeout(stop, 2000);
    }
  }

  async function hide(): Promise<void> {
    const ids = storedSampleIds();
    const leaving = dematerializeRows(ids);
    // Any row still listed afterwards, as under Canceled, comes back once the list has reloaded.
    const restore = () =>
      setTimeout(() => leaving.forEach((animation) => animation.cancel()), 1500);
    try {
      await Promise.all(leaving.map((animation) => animation.finished));
      await removeSamples(ids);
      localStorage.setItem(SAMPLE_IDS_KEY, "[]");
      reloadList();
    } finally {
      restore();
    }
  }

  function toggle(next: boolean): void {
    setOn(next);
    queue.current = queue.current.then(async () => {
      if (next === storedSampleIds().length > 0) return;
      try {
        await (next ? show() : hide());
      } catch (error) {
        setOn(!next);
        showTaskToast(
          `Example tasks couldn't be ${next ? "added" : "removed"}. ${error instanceof Error ? error.message : ""}`,
        );
      }
    });
  }

  return (
    <>
      <Corner side="left" ref={left}>
        <Labeled label="Show example tasks" side="right">
          {/* Clicking keeps focus in the list, so its keys go on working. */}
          <span className="flex items-center" onMouseDown={preventFocusSteal}>
            <SquishSwitch
              checked={on}
              onChange={toggle}
              id={SWITCH_ID}
              width={40}
              height={22}
              radius={11}
              trackColor="var(--muted)"
              trackOnColor="var(--primary)"
              thumbColor="var(--muted-foreground)"
              thumbOnColor="var(--primary-foreground)"
              className="rounded-full has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring"
            />
            <label
              htmlFor={SWITCH_ID}
              className="ml-2.5 cursor-pointer text-sm font-medium select-none max-xl:sr-only"
            >
              Show example tasks
            </label>
          </span>
        </Labeled>
      </Corner>
      <Corner side="right" ref={right}>
        <DownloadButton href={RELEASES_URL} />
      </Corner>
    </>
  );
}
