import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// The Node modules the backend and memfs import, each replaced by src/web/shims/<name>.ts.
const MODULES = [
  "fs",
  "path",
  "crypto",
  "sqlite",
  "zlib",
  "process",
  "buffer",
  "events",
  "stream",
  "url",
];

/**
 * Lets the hosted build and the iOS app bundle the real backend into a worker. The hosted build
 * keeps its files in memory; the iOS app's are real, reached through its shell.
 */
export function nodeShims(): Plugin {
  const fs = process.env.TAURI_ENV_PLATFORM === "ios" ? "iosFs" : "fs";
  return {
    name: "tasks-node-shims",
    enforce: "pre",
    resolveId(source) {
      // memfs imports process without the prefix; other bare names are left to the packages.
      const name = source === "process" ? source : /^node:(.+)$/.exec(source)?.[1];
      if (!name || !MODULES.includes(name)) return null;
      return fileURLToPath(new URL(`./shims/${name === "fs" ? fs : name}.ts`, import.meta.url));
    },
  };
}
