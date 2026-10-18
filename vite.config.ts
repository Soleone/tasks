import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { themePlugin } from "./src/components/soleone/theme-vite";
import { THEME_CONFIG } from "./src/theme/config";

const host = process.env.TAURI_DEV_HOST;

// Registry internals stay upstream; application code uses their high-level components.
const vendored = ["src/components/ui/**", "src/components/soleone/**"];

const noBaseUi = {
  group: ["@base-ui/react", "@base-ui/react/*"],
  message:
    "Use a local high-level component from @/components/ui instead of importing Base UI primitives directly.",
};
const noCva = {
  group: ["class-variance-authority"],
  message:
    "Variants live in src/components/variants: wrap the primitive there and import the wrapper.",
};

export default defineConfig({
  staged: { "*": "vp check --fix" },
  // Fixtures and frozen evidence keep their exact bytes, and Markdown tables stay unpadded so a spec rule edit is a one-line diff.
  fmt: {
    ignorePatterns: [
      ...vendored,
      "scripts/fixtures/**",
      "docs/evidence/**",
      "src-tauri/**",
      "**/*.md",
    ],
  },
  lint: {
    plugins: ["react", "typescript", "oxc", "unicorn"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }, "@shadcn/lint"],
    ignorePatterns: ["dist/**", "src-tauri/**", ...vendored],
    options: { typeAware: true, typeCheck: true },
    settings: {
      shadcn: {
        ui: "@/components/ui",
        note: "Follow the design tokens and component variants defined in src/styles.css and src/components/ui.",
      },
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": ["error", { allow: ["app-icon", "wrap-anywhere"] }],
      "no-restricted-imports": ["error", { patterns: [noBaseUi, noCva] }],
    },
    overrides: [
      {
        // Wrappers around stock primitives: the one place that restyles them and adds variants.
        files: ["src/components/variants/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "no-restricted-imports": ["error", { patterns: [noBaseUi] }],
        },
      },
      {
        // Tests and scripts build strings and functions from fixtures on purpose, node:test
        // registers top-level tests without awaiting them, and jsdom shims patch prototypes.
        files: ["**/*.test.{ts,tsx,mjs}", "scripts/**", "src/testing/**"],
        rules: {
          "typescript/no-floating-promises": "off",
          "typescript/no-base-to-string": "off",
          "typescript/restrict-template-expressions": "off",
          "typescript/require-array-sort-compare": "off",
          "typescript/no-implied-eval": "off",
          "typescript/no-misused-spread": "off",
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), themePlugin(THEME_CONFIG)]),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Late dependency optimization reloads the page, losing in-memory write requests.
  optimizeDeps: { include: ["@base-ui/react/checkbox"] },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Disposable native data and proof executables are not frontend source.
      ignored: ["**/src-tauri/**", "**/.tmp/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // Client tests render the app in jsdom. Backend and migration tests run under node --test.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/backend/**", "src/migration/**", "**/node_modules/**"],
    setupFiles: ["src/testing/setup.ts"],
    globalSetup: ["src/testing/workspaceServer.ts"],
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
