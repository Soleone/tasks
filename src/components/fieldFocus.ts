// Title and description both take focus with the caret after the text.
export function focusAtEnd(field: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

/**
 * Scrolls `element` into view now and again once the on-screen keyboard has
 * resized the window, which happens after focus. Returns its cleanup.
 */
export function keepInView(element: HTMLElement): () => void {
  const scroll = () => element.scrollIntoView({ block: "nearest" });
  scroll();
  window.addEventListener("resize", scroll);
  const timeout = window.setTimeout(() => {
    scroll();
    window.removeEventListener("resize", scroll);
  }, 400);
  return () => {
    window.clearTimeout(timeout);
    window.removeEventListener("resize", scroll);
  };
}
