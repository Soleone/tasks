/**
 * The process the backend and memfs see in the browser. memfs owns files by getuid(), so it must
 * be the same everywhere; the backend's path rules are the Linux ones.
 */
export default {
  platform: "linux",
  env: {},
  argv: [],
  cwd: () => "/",
  getuid: () => 0,
  getgid: () => 0,
  emitWarning: () => {},
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
    queueMicrotask(() => callback(...args)),
};
