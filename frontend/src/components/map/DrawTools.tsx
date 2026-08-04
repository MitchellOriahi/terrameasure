// components/map/DrawTools.tsx
// Connects terra-draw (the drawing library) to the MapLibre map.
//
// terra-draw handles the fiddly parts of sketching shapes on a map:
// click to add points, preview lines, double-click or tap to finish.
// Our job here is lifecycle plumbing:
//   1. Create a TerraDraw instance once the map style has loaded.
//   2. Switch its mode when the user presses the Polygon/Rectangle button.
//   3. When a shape is finished, hand the vertices to the app and clear
//      the sketch (the finished shape is re-drawn by MapView from the
//      Zustand store, so it survives basemap switches).
//
// This component renders nothing visible itself; it is pure wiring, which
// is a common React pattern for imperative libraries.

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-maplibre";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useAppStore } from "@/store/appStore";
import type { LatLon } from "@/lib/geo";

interface DrawToolsProps {
  // Called with the finished shape's vertices; the page kicks off a survey.
  onShapeFinished: (vertices: LatLon[]) => void;
}

// One shared style for the in-progress sketch: emerald on dark.
const SKETCH_STYLES = {
  fillColor: "#34d399",
  fillOpacity: 0.12,
  outlineColor: "#34d399",
  outlineWidth: 2,
  closingPointColor: "#34d399",
  closingPointOutlineColor: "#131211",
} as const;

export function DrawTools({ onShapeFinished }: DrawToolsProps) {
  const { current: mapRef } = useMap();
  const drawMode = useAppStore((s) => s.drawMode);
  const setDrawMode = useAppStore((s) => s.setDrawMode);
  const setDrawnVertices = useAppStore((s) => s.setDrawnVertices);

  const drawRef = useRef<TerraDraw | null>(null);
  // Keep the latest callback in a ref so the draw instance (created once)
  // always calls the current version without needing to be rebuilt.
  const finishRef = useRef(onShapeFinished);
  finishRef.current = onShapeFinished;

  // ---- Create / destroy the TerraDraw instance ----
  // A basemap switch calls MapLibre's setStyle(), which wipes ALL custom
  // layers from the map, terra-draw's sketch layers included. Guessing
  // WHEN that wipe happens is fragile (a URL style loads over the
  // network, an object style applies instantly), so we do not guess:
  // the map fires "style.load" every time a new style finishes loading,
  // and we simply rebuild terra-draw on that signal, every time.
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap() as unknown as MaplibreMap;
    let cancelled = false;
    let draw: TerraDraw | null = null;

    const setup = () => {
      if (cancelled) return;
      // Tear down the previous instance first (a rebuild after a style
      // swap). Its layers are usually already gone with the old style,
      // so failures here are expected and harmless.
      try {
        draw?.stop();
      } catch {
        // Old sketch layers vanished with the old style; nothing to do.
      }
      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({ styles: { ...SKETCH_STYLES } }),
          new TerraDrawRectangleMode({ styles: { ...SKETCH_STYLES } }),
        ],
      });
      draw.start();
      // "static" is terra-draw's built-in idle mode (no drawing active)
      draw.setMode("static");

      draw.on("finish", (id, context) => {
        // Only react to a completed drawing action, not edits.
        if (context.action !== "draw" || !draw) return;
        const feature = draw
          .getSnapshot()
          .find((f) => f.id === id && f.geometry.type === "Polygon");
        if (!feature || feature.geometry.type !== "Polygon") return;

        // GeoJSON polygons repeat the first point at the end; drop it.
        const ring = feature.geometry.coordinates[0].slice(0, -1);
        const vertices: LatLon[] = ring.map(([lon, lat]) => ({ lat, lon }));

        // Hand the shape to the app, then clear the sketch layer. The
        // permanent shape is rendered declaratively by MapView instead.
        setDrawnVertices(vertices);
        setDrawMode("none");
        // Clearing the sketch touches map layers, which can fail if a
        // style switch stole them mid-draw. Starting the survey matters
        // more than tidying pixels, so never let a clear() hiccup stop it.
        try {
          draw.clear();
        } catch {
          // Sketch layers already gone; nothing to clear.
        }
        if (vertices.length >= 3) finishRef.current(vertices);
      });

      drawRef.current = draw;

      // If a draw tool was already armed while we were rebuilding (say,
      // the user hit Polygon right as the basemap switched), arm it now
      // so the button state and the actual tool never drift apart.
      const armed = useAppStore.getState().drawMode;
      if (armed !== "none") {
        try {
          draw.setMode(armed);
        } catch {
          // Mode not ready yet; the mode-sync effect below will retry.
        }
      }
    };

    // Build now if the current style is already usable (normal case when
    // this component mounts after the map finished loading)...
    if (map.isStyleLoaded()) {
      setup();
    }
    // ...and rebuild EVERY time a style finishes loading from then on.
    // This single subscription covers the initial load (if the style was
    // still loading above) and every basemap switch, with no timing
    // guesswork about which style isStyleLoaded() was talking about.
    map.on("style.load", setup);

    return () => {
      cancelled = true;
      map.off("style.load", setup);
      try {
        draw?.stop();
      } catch {
        // Map may already be gone during teardown; nothing to clean up.
      }
      drawRef.current = null;
    };
  }, [mapRef, setDrawMode, setDrawnVertices]);

  // ---- Keep terra-draw's mode in sync with the toolbar buttons ----
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !draw.enabled) return;
    try {
      if (drawMode === "none") {
        draw.setMode("static");
        draw.clear(); // abandon any half-finished sketch
      } else {
        draw.setMode(drawMode);
      }
    } catch {
      // setMode can throw if called mid-teardown; safe to ignore.
    }
  }, [drawMode]);

  return null;
}
