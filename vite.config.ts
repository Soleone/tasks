import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// Vendored shadcn primitives. They carry local fixes until those move into wrappers; see PLAN.md.
const vendored = ["src/components/ui/**"];

const noBaseUi = {
  group: ["@base-ui/react", "@base-ui/react/*"],
  message:
    "Use a local high-level component from @/components/ui instead of importing Base UI primitives directly.",
};

export default defineConfig({
  staged: { "*": "vp check --fix" },
  // Fixtures and frozen evidence keep their exact bytes, legacy code is deleted at cutover, and
  // Markdown tables stay unpadded so a spec rule edit is a one-line diff.
  fmt: {
    ignorePatterns: [
      ...vendored,
      "src/legacy/**",
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
      "no-restricted-imports": ["error", { patterns: [noBaseUi] }],
    },
    overrides: [
      {
        // node:test registers top-level tests without awaiting them.
        files: ["**/*.test.{ts,tsx,mjs}", "scripts/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
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
  // Client tests render the app in jsdom. Backend, legacy and migration tests run under node --test.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/backend/**", "src/legacy/**", "src/migration/**", "**/node_modules/**"],
    setupFiles: ["src/testing/setup.ts"],
    globalSetup: ["src/testing/workspaceServer.ts"],
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
