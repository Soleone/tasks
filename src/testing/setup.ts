import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks layout APIs the list and popovers call.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.scrollTo ??= function scrollTo() {};
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
window.matchMedia ??= (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
