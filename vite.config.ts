import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { themePlugin } from "./src/components/soleone/theme-vite";
import { THEME_CONFIG } from "./src/theme/config";
import { priorityColorsPlugin } from "./src/theme/priorityColors";
import { nodeShims } from "./src/web/nodeShims";

const host = process.env.TAURI_DEV_HOST;
// The hosted web build runs the backend in a worker instead of reaching a dev server.
const hosted = process.env.VITE_HOSTED === "1";

// Registry internals stay upstream; application code uses their high-level components.
const vendored = [
  "src/components/ui/**",
  "src/components/soleone/**",
  "src/components/live/**",
  "src/components/react-bits/**",
];

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
const focusVariants = [
  {
    group: [
      "**/components/ui/button",
      "**/components/ui/input",
      "**/components/ui/textarea",
      "**/components/ui/checkbox",
      "**/components/ui/calendar",
    ],
  },
  { group: ["**/components/ui/select"], importNames: ["SelectTrigger"] },
  { group: ["**/components/ui/input-group"], importNames: ["InputGroup"] },
  { group: ["**/components/ui/command"], importNames: ["Command"] },
  { group: ["**/components/ui/toast"], importNames: ["Toast"] },
  { group: ["**/components/ui/tabs"], importNames: ["TabsTrigger"] },
  { group: ["**/components/ui/radio-group"], importNames: ["RadioGroupItem"] },
  { group: ["**/components/ui/badge"], importNames: ["Badge"] },
  { group: ["**/components/ui/item"], importNames: ["Item"] },
].map((pattern) => ({
  ...pattern,
  message: "Use the app wrapper in components/variants so keyboard focus keeps its solid 2px ring.",
}));

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
      "no-restricted-imports": ["error", { patterns: [noBaseUi, noCva, ...focusVariants] }],
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
        // The web build's own components, kept out of the apps, restyle like the wrappers above.
        files: ["src/web/**"],
        rules: { "shadcn/no-restyle": "off" },
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
  plugins: lazyPlugins(() => [
    react(),
    tailwindcss(),
    themePlugin(THEME_CONFIG),
    priorityColorsPlugin(THEME_CONFIG.themes),
    ...(hosted ? [nodeShims()] : []),
  ]),
  worker: { format: "es", plugins: () => [nodeShims()] },
  // Always defined, so other builds drop the hosted entry and its worker.
  define: { "import.meta.env.VITE_HOSTED": JSON.stringify(hosted ? "1" : "") },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Late dependency optimization reloads the page, losing in-memory write requests.
  optimizeDeps: {
    include: ["@base-ui/react/checkbox"],
    // The dev server pre-bundles memfs and the like, where the plugins above never run.
    ...(hosted ? { rolldownOptions: { plugins: [nodeShims()] } } : {}),
  },
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
  // Client tests render the app in jsdom. Backend tests run under node --test.
  test: {
    // Under parallel load a flow takes about twice its serial time; the 5 s default left no margin.
    testTimeout: 15_000,
    // Past about 10 workers, Vitest's piping of worker output into its own trips Node's
    // MaxListenersExceededWarning. 8 runs the suite just as fast.
    maxWorkers: 8,
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/backend/**", "src/web/**", "**/node_modules/**"],
          setupFiles: ["src/testing/setup.ts"],
          globalSetup: ["src/testing/workspaceServer.ts"],
        },
      },
      {
        // The hosted build's Node stand-ins, without jsdom's typed arrays, which Node's Buffer fails.
        extends: true,
        test: { name: "hosted", environment: "node", include: ["src/web/**/*.test.ts"] },
      },
    ],
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    // The first screen needs all of these, so they load together; separate chunks only keep each one small and cacheable.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "base-ui", test: /node_modules[\\/](@base-ui|@floating-ui)[\\/]/ },
            {
              name: "motion",
              test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/,
            },
            {
              name: "calendar",
              test: /node_modules[\\/](react-day-picker|date-fns|@date-fns)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
