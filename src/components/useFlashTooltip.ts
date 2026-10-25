import { useEffect, useRef, useState } from "react";

/**
 * A tooltip that flashes open for a moment whenever `version` changes after
 * mount, and otherwise opens and closes like any other (hover, Escape).
 * `flashing` stays set from a flash until the next hover opens it.
 */
export function useFlashTooltip(
  version: number | undefined,
  durationMs: number,
): { open: boolean; flashing: boolean; onOpenChange: (open: boolean) => void } {
  const [open, setOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [shownVersion, setShownVersion] = useState(version);
  if (shownVersion !== version) {
    setShownVersion(version);
    if (version !== undefined) {
      setOpen(true);
      setFlashing(true);
    }
  }

  const timedVersion = useRef(version);
  useEffect(() => {
    if (version === timedVersion.current) return;
    timedVersion.current = version;
    if (version === undefined) return;
    const timeout = window.setTimeout(() => setOpen(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [version, durationMs]);

  function onOpenChange(next: boolean): void {
    setOpen(next);
    if (next) setFlashing(false);
  }

  return { open, flashing, onOpenChange };
}
