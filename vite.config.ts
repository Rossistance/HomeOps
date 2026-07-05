import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// HomeOps AI — premium family operating system (frontend).
// /api is proxied to the local backend runtime (server/index.mjs) which owns
// OAuth, secrets, webhooks, scheduled jobs, browser automation, and tool execution.
const BACKEND = process.env.HOMEOPS_BACKEND || "http://localhost:8787";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Cache the SVG icon alongside the build output.
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "HomeOps AI",
        short_name: "HomeOps",
        description: "Personal agent teams for family life and household admin",
        // Warm paper — a dark navy here painted visible dark bands around the app
        // in iOS standalone mode (the "doesn't fit the screen" letterbox effect).
        theme_color: "#ece3d5",
        background_color: "#ece3d5",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        categories: ["productivity", "lifestyle"],
        icons: [
          { src: "/icons/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
          // Run `npm run generate-icons` (requires sharp) to get these PNG variants
          // for strict iOS / older Android compliance, then swap in the .png paths:
          // { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          // { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Pre-cache all build output + icon.
        globPatterns: ["**/*.{js,css,html,svg,woff2,ico}"],
        // NEVER serve the SPA shell for backend navigations. Without this, the
        // service worker (shared with Safari's storage on iOS) intercepts the
        // OAuth redirect to /api/oauth/callback inside ASWebAuthenticationSession
        // and renders the dashboard instead — the code exchange never happens.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // API calls: network first, fall back to cache so offline shows last data.
            urlPattern: /\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "homeops-api",
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Service worker only registers in production builds — dev stays clean.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy vendor libs out of the main bundle (screens are already
        // route-split via React.lazy in App.tsx). Function form for Rolldown/Vite 8.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          return "vendor";
        },
      },
    },
  },
});
