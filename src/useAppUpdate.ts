import { useEffect } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "@/components/ui/toast";
import { availableUpdate, installUpdate } from "@/platform/appUpdate";

/** A toast that stays until it is used or closed; Update installs, and a failure offers Retry. */
function offer(update: Update): void {
  let installing = false;
  const install = () => {
    if (installing) return;
    installing = true;
    toast.update(id, { title: `Updating to Tasks ${update.version}…`, actionProps: {} });
    void installUpdate(update).catch((error: unknown) => {
      installing = false;
      toast.update(id, {
        title: `Couldn't update: ${error instanceof Error ? error.message : String(error)}`,
        actionProps: { children: "Retry", onClick: install },
      });
    });
  };
  const id = toast.add({
    title: `Tasks ${update.version} is available`,
    timeout: 0,
    actionProps: { children: "Update", onClick: install },
  });
}

/** Offers a newer desktop release once per start. */
export function useAppUpdate(): void {
  useEffect(() => {
    let cancelled = false;
    void availableUpdate().then((update) => {
      if (update && !cancelled) offer(update);
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
