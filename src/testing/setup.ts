import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vite-plus/test";
import { createThemeHead } from "@/components/soleone/theme/head";
import { THEME_CONFIG } from "@/theme/config";

// jsdom lacks layout APIs the list and popovers call.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.scrollTo ??= function scrollTo() {};
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});

const { themeScript } = createThemeHead(THEME_CONFIG);
beforeEach(() => {
  // jsdom does not load index.html, where the Vite plugin installs this script.
  new Function(themeScript)();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
