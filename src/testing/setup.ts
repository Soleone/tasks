import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vite-plus/test";
import { createThemeHead } from "@/components/soleone/theme/head";
import { THEME_CONFIG } from "@/theme/config";

// Parallel workers share the CPU with every test's backend, so waiting for a backend round trip
// takes a few times as long as in a serial run, where the library's 1 s default suffices.
const BACKEND_ROUND_TRIP_WAIT_MS = 3000;
configure({ asyncUtilTimeout: BACKEND_ROUND_TRIP_WAIT_MS });

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
