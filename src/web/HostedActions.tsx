import { Download, ListPlus } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { showTaskToast } from "@/components/TaskToaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FloatingButton } from "@/components/variants/button";
import { preventFocusSteal } from "@/navigation";

export const RELEASES_URL = "https://github.com/Soleone/tasks/releases/latest";
const SAMPLES_ADDED_KEY = "tasks.sampleTasksAdded";

/** The tooltip names an action only where the button shows just its icon. */
function Labeled({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="left" className="xl:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Where the quest card spans the window, as on phones, the corner sits just above it. */
function useAboveQuestCard(): RefObject<HTMLDivElement | null> {
  const corner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = () => {
      const element = corner.current;
      const card = document.querySelector("[data-quest-card]")?.getBoundingClientRect();
      if (!element) return;
      const covers = card && card.right > element.getBoundingClientRect().left;
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

/** The web build's corner: example tasks until they're added, and the way to the apps. */
export function HostedActions({ addSamples }: { addSamples: () => Promise<void> }) {
  const [added, setAdded] = useState(() => localStorage.getItem(SAMPLES_ADDED_KEY) === "1");
  const [adding, setAdding] = useState(false);
  const corner = useAboveQuestCard();

  async function add(): Promise<void> {
    setAdding(true);
    try {
      await addSamples();
      // The list reloads when the window regains focus, as after the CLI changes tasks; this saves
      // waiting up to 1.5 s for its next check.
      window.dispatchEvent(new Event("focus"));
      localStorage.setItem(SAMPLES_ADDED_KEY, "1");
      setAdded(true);
    } catch (error) {
      showTaskToast(
        `Example tasks couldn't be added. ${error instanceof Error ? error.message : ""}`,
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      ref={corner}
      className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 motion-safe:transition-all md:right-8 md:bottom-8"
    >
      {added ? null : (
        <Labeled label="Add example tasks">
          <FloatingButton
            icon={ListPlus}
            label="Add example tasks"
            disabled={adding}
            onMouseDown={preventFocusSteal}
            onClick={() => void add()}
          />
        </Labeled>
      )}
      <Labeled label="Get the app">
        <FloatingButton
          icon={Download}
          label="Get the app"
          variant="outline"
          nativeButton={false}
          render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
        />
      </Labeled>
    </div>
  );
}
