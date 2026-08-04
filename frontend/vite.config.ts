// vite.config.ts
// This file tells Vite (our build tool and dev server) how to run the app.
// Three jobs happen here:
//   1. Load the React and Tailwind plugins so .tsx files and CSS work.
//   2. Set up the PWA plugin so the app can be installed like a phone app.
//   3. Proxy "/api" requests to the Python backend during development,
//      so the browser never hits a cross-origin (CORS) wall.

import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "autoUpdate" means: when we ship a new version, the installed app
      // quietly refreshes itself next time it loads. No manual steps.
      registerType: "autoUpdate",
      // The manifest is the little JSON file that tells a phone
      // "this website can be installed, here is its name and icon".
      manifest: {
        name: "TerraMeasure",
        short_name: "TerraMeasure",
        description:
          "Site feasibility pre-screen for land: a go or no-go decision in about 60 seconds.",
        theme_color: "#131211",
        background_color: "#131211",
        display: "standalone",
        // Installed-app users have already chosen TerraMeasure: skip the
        // marketing landing page (which lives at "/") and open straight
        // into the survey map.
        start_url: "/map",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache the app shell (JS, CSS, HTML, fonts) for offline startup.
        // We deliberately do NOT cache map tiles or API calls: they are
        // huge and always fresher from the network.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Map libraries produce big chunks; raise the cacheable size limit.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Ship updates immediately. Without these, a user who installed an
        // old (broken) build could stay pinned to it: the new service
        // worker would sit in "waiting" until every tab closed.
        // skipWaiting = the new worker takes over as soon as it installs;
        // clientsClaim = it controls already-open tabs too;
        // cleanupOutdatedCaches = old precaches are deleted, not hoarded.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    // Lets us write imports like "@/components/TopBar" instead of
    // fragile relative paths like "../../components/TopBar".
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    proxy: {
      // In dev, the browser calls "/api/survey/polygon" and Vite quietly
      // forwards it to the local Python backend on port 8000.
      // The rewrite strips the "/api" prefix because the backend routes
      // live at the root (e.g. "/survey/polygon", not "/api/survey/polygon").
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
