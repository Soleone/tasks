import { useEffect, useRef } from "react";

/**
 * The surfaces that can receive explicit focus. The composer is a modal
 * dialog on the focus stack, not a destination: "create" is the New task
 * button, and the list is the default stop. Tab stays inert on the list.
 */
export type DestinationId = "create" | "list";

export type DestinationHandle = {
  /** Focus the front of a destination. */
  focusFirst: () => void;
  /** Focus the tail of a destination. */
  focusLast: () => void;
};

export type Navigator = {
  register: (id: DestinationId, handle: DestinationHandle) => () => void;
  /** Focus the tail of the final destination (Shift+Tab on a header button). */
  last: () => void;
  /** Jump straight to a destination's front. */
  go: (id: DestinationId) => void;
};

/**
 * Navigation over an ordered destination table. `order` comes from app state,
 * never from the DOM: the capture composer stays mounted while hidden during
 * editing, so DOM presence would route focus into a hidden subtree.
 */
export function useFocusNavigation(order: DestinationId[]): Navigator {
  const handles = useRef(new Map<DestinationId, DestinationHandle>());
  const orderRef = useRef(order);
  const navigator = useRef<Navigator | null>(null);

  useEffect(() => {
    orderRef.current = order;
  });

  if (!navigator.current) {
    const available = (): DestinationId[] =>
      orderRef.current.filter((id) => handles.current.has(id));
    navigator.current = {
      register(id, handle) {
        handles.current.set(id, handle);
        return () => {
          if (handles.current.get(id) === handle) handles.current.delete(id);
        };
      },
      last() {
        const ids = available();
        if (ids.length) handles.current.get(ids[ids.length - 1])?.focusLast();
      },
      go: (id) => handles.current.get(id)?.focusFirst(),
    };
  }
  return navigator.current;
}

export type FocusStack = {
  /** Stash where focus should return before opening a modal layer. */
  push: (id: string, from?: HTMLElement | null) => void;
  /** Consume the layer's return target when it closes; undefined once detached. */
  restore: (id: string) => HTMLElement | undefined;
};

/**
 * Return-focus bookkeeping for modal layers (commands, themes, settings,
 * delete). Each layer pushes under its own id and restores it on close, so
 * layers compose and one can hand its target to the next (palette -> settings).
 */
export function useFocusStack(): FocusStack {
  const entries = useRef<{ id: string; element: HTMLElement }[]>([]);
  const stack = useRef<FocusStack | null>(null);

  if (!stack.current) {
    const find = (id: string): number => {
      for (let index = entries.current.length - 1; index >= 0; --index) {
        if (entries.current[index].id === id) return index;
      }
      return -1;
    };
    stack.current = {
      push(id, from) {
        const element = (from ?? document.activeElement) as HTMLElement | null;
        if (element) entries.current.push({ id, element });
      },
      restore(id) {
        const index = find(id);
        if (index === -1) return undefined;
        const element = entries.current.splice(index, 1)[0].element;
        return element.isConnected ? element : undefined;
      },
    };
  }
  return stack.current;
}
