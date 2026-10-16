import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback with a fixed identity that runs the latest `handler`, so memoized
 * rows keep their props while the list's handlers change every render. Call it
 * from events only; it sees the handler of the last commit.
 */
export function useStableHandler<Args extends unknown[]>(
  handler: (...args: Args) => void,
): (...args: Args) => void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
