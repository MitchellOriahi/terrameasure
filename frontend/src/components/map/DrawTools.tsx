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
  const basemap = useAppStore((s) => s.basemap);
  const setDrawMode = useAppStore((s) => s.setDrawMode);
  const setDrawnVertices = useAppStore((s) => s.setDrawnVertices);

  const drawRef = useRef<TerraDraw | null>(null);
  // Keep the latest callback in a ref so the draw instance (created once)
  // always calls the current version without needing to be rebuilt.
  const finishRef = useRef(onShapeFinished);
  finishRef.current = onShapeFinished;

  // ---- Create / destroy the TerraDraw instance ----
  // We rebuild it whenever the basemap changes, because switching styles
  // wipes all custom layers from the map, including terra-draw's.
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap() as unknown as MaplibreMap;
    let cancelled = false;
    let draw: TerraDraw | null = null;

    const setup = () => {
      if (cancelled) return;
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
        draw.clear();
        if (vertices.length >= 3) finishRef.current(vertices);
      });

      drawRef.current = draw;
    };

    // Style must be loaded before terra-draw can add its layers.
    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.once("idle", setup);
    }

    return () => {
      cancelled = true;
      try {
        draw?.stop();
      } catch {
        // Map may already be gone during teardown; nothing to clean up.
      }
      drawRef.current = null;
    };
  }, [mapRef, basemap, setDrawMode, setDrawnVertices]);

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
  }, [drawMode, basemap]);

  return null;
}
