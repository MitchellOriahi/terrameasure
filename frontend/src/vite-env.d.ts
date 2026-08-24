/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Two ambient type references, no runtime code.
//
//   vite/client            : types for import.meta.env and asset imports
//   vite-plugin-pwa/client : types for "virtual:pwa-register", the module
//                            the PWA plugin generates at build time so the
//                            app can hook into service worker updates
//                            (see lib/appUpdate.ts).
