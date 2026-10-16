import { useEffect, useState } from "react";

type Loaded<T> = { value: T | null; loading: boolean; error: string | null };

/**
 * Loads a picker's options each time it opens, and again when `load` changes
 * while open, so `load` must be stable. Loading shows from the opening render
 * on, the previous options stay visible meanwhile, and an answer that lands
 * after the picker closed is dropped.
 */
export function useLoadOnOpen<T>(open: boolean, load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ value: null, loading: open, error: null });
  const [request, setRequest] = useState({ open, load });

  if (request.open !== open || request.load !== load) {
    setRequest({ open, load });
    if (open) setLoaded((previous) => ({ ...previous, loading: true, error: null }));
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    load().then(
      (value) => {
        if (!cancelled) setLoaded({ value, loading: false, error: null });
      },
      (caught: unknown) => {
        if (!cancelled)
          setLoaded({
            value: null,
            loading: false,
            error: caught instanceof Error ? caught.message : String(caught),
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  return loaded;
}
