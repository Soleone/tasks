import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
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
