// lib/maplibreWorker.ts
// One small but critical piece of plumbing for the map library.
//
// THE PROBLEM: MapLibre does its heavy lifting (decoding vector map tiles,
// elevation data, and our drawn GeoJSON shapes) inside a Web Worker, which
// is a background thread the browser runs from a separate script file.
// MapLibre v6 tries to find that file NEXT TO its own code, at a relative
// URL like "./maplibre-gl-worker.mjs". But once Vite bundles the app, that
// relative address points at a file that does not exist, so the worker
// request 404s. Without the worker, every vector layer silently renders
// nothing: the street basemap becomes a black void, drawn polygons and
// the mobile reticle dots are invisible, and 3D terrain never loads.
//
// THE FIX: Vite's special "?worker&url" import below tells Vite to bundle
// the worker file properly (with everything it imports baked in) and hand
// us the real URL it will be served from, in both dev and production.
// We then pass that URL to MapLibre's official setWorkerUrl() override.
//
// This module must run BEFORE any map is created, so main.tsx imports it
// first.

import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);
