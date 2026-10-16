import { useEffect, useState } from "react";

/**
 * The surface that can receive explicit home focus. The inline task editor
 * owns focus while open; modal surfaces use the focus stack instead.
 */
export type DestinationId = "list";

type DestinationHandle = {
  /** Focus the tail of a destination. */
  focusLast: () => void;
};

export type Navigator = {
  register: (id: DestinationId, handle: DestinationHandle) => () => void;
  /** Focus the tail of the final destination (Shift+Tab on a header button). */
  last: () => void;
};

/**
 * Navigation over an ordered destination table. `order` comes from app state,
 * never from the DOM, so modal surfaces cannot become accidental destinations.
 */
export function useFocusNavigation(order: DestinationId[]): Navigator {
  const [navigation] = useState(createNavigation);
  useEffect(() => {
    navigation.setOrder(order);
  });
  return navigation.navigator;
}

function createNavigation(): {
  navigator: Navigator;
  setOrder: (order: DestinationId[]) => void;
} {
  const handles = new Map<DestinationId, DestinationHandle>();
  let order: DestinationId[] = [];
  return {
    navigator: {
      register(id, handle) {
        handles.set(id, handle);
        return () => {
          if (handles.get(id) === handle) handles.delete(id);
        };
      },
      last() {
        const ids = order.filter((id) => handles.has(id));
        if (ids.length) handles.get(ids[ids.length - 1])?.focusLast();
      },
    },
    setOrder(next) {
      order = next;
    },
  };
}

export type FocusStack = {
  /** Stash where focus should return before opening a modal layer. */
  push: (id: string, from?: HTMLElement | null) => void;
  /** Consume the layer's return target when it closes; undefined once detached. */
  restore: (id: string) => HTMLElement | undefined;
};

/**
 * Mouse-only buttons are backup affordances (tabIndex -1). Prevent the
 * mousedown default so clicking them never moves DOM focus off the current
 * keyboard surface; the click still fires and keyboard navigation keeps working.
 */
export function preventFocusSteal(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * Return-focus bookkeeping for modal layers (commands, themes, and settings).
 * Each layer pushes under its own id and restores it on close, so
 * layers compose and one can hand its target to the next (palette -> settings).
 */
export function useFocusStack(): FocusStack {
  const [stack] = useState(createFocusStack);
  return stack;
}

function createFocusStack(): FocusStack {
  const entries: { id: string; element: HTMLElement }[] = [];
  const find = (id: string): number => {
    for (let index = entries.length - 1; index >= 0; --index) {
      if (entries[index].id === id) return index;
    }
    return -1;
  };
  return {
    push(id, from) {
      const element = (from ?? document.activeElement) as HTMLElement | null;
      if (element) entries.push({ id, element });
    },
    restore(id) {
      const index = find(id);
      if (index === -1) return undefined;
      const element = entries.splice(index, 1)[0].element;
      return element.isConnected ? element : undefined;
    },
  };
}
