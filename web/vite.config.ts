/// <reference types="node" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vite config for the standalone GUI.
//
// The dev server proxies `/api/*` to the running daemon so the SPA never needs
// to think about CORS or absolute base URLs. In production the built `dist/`
// is served by the daemon itself (or any static host), and requests go to the
// same origin as the page (overridable via `VITE_DAEMON_URL` at build time).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      "/api": {
        target: process.env.VITE_DAEMON_URL || "http://127.0.0.1:8103",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
