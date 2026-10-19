import { useState } from "react";

/**
 * True once `value` has changed while mounted, so a fresh mount (load,
 * scroll, filter) stays still and only real changes animate.
 */
export function useChangedAfterMount<T>(value: T): boolean {
  const [seen, setSeen] = useState(value);
  const [changed, setChanged] = useState(false);
  if (seen !== value) {
    setSeen(value);
    setChanged(true);
  }
  return changed;
}
