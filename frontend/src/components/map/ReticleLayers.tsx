// components/map/ReticleLayers.tsx
// The map half of mobile reticle drawing. Two jobs:
//
//   1. WATCH the camera. While reticle mode is on, every map movement
//      streams the center point and zoom into the Zustand store, so the
//      readout strip and rubber-band line follow the crosshair live.
//      It also checks "is the crosshair close to the first vertex?"
//      (snap-to-close) and handles taps on existing vertex dots.
//
//   2. DRAW the sketch. The placed vertices, the dashed lines between
//      them, and the dashed "rubber band" from the last vertex to the
//      crosshair are all rendered as declarative <Source>/<Layer> pairs,
//      so React re-adds them automatically after a basemap switch.
//
// The clever bit: on entry we give the camera bottom padding equal to 16%
// of the screen. MapLibre then treats the point 42% from the top as the
// camera's "center", which is exactly where the crosshair overlay sits.
// After that, map.getCenter() IS the crosshair position, and easeTo() on
// a vertex parks it right under the crosshair. One trick, zero offset math.

import { useEffect, useMemo } from "react";
import { useMap, Source, Layer } from "@vis.gl/react-maplibre";
import type {
  Map as MaplibreMap,
  MapMouseEvent,
  ExpressionSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { useAppStore } from "@/store/appStore";

// How close (in screen pixels) the crosshair must get to the first vertex
// before we offer to close the shape. 24px is roughly half a fingertip.
const SNAP_PX = 24;

// Fraction of the screen height used as bottom camera padding. This is
// what lifts the camera center to ~42% from the top: (100% - 16%) / 2 = 42%.
const BOTTOM_PAD_FRACTION = 0.16;

/** Read the map camera and mirror it into the store (center, zoom, snap). */
function syncCameraToStore(map: MaplibreMap) {
  const s = useAppStore.getState();
  const c = map.getCenter();
  s.setReticleCenter({ lat: c.lat, lon: c.lng });
  s.setReticleZoom(map.getZoom());

  // Snap-to-close check: compare SCREEN distance (via map.project) between
  // the crosshair and vertex #1. Screen pixels, not meters, because "close
  // enough to tap" is a screen concept that should not change with zoom.
  let near = false;
  if (s.reticleVertices.length >= 3 && s.selectedVertexIndex === null) {
    const first = s.reticleVertices[0];
    const a = map.project([first.lon, first.lat]);
    const b = map.project([c.lng, c.lat]);
    near = Math.hypot(a.x - b.x, a.y - b.y) <= SNAP_PX;
  }
  if (near !== s.snapToFirst) s.setSnapToFirst(near);
}

export function ReticleLayers() {
  const { current: mapRef } = useMap();
  const active = useAppStore((s) => s.reticleActive);
  const vertices = useAppStore((s) => s.reticleVertices);
  const center = useAppStore((s) => s.reticleCenter);
  const snap = useAppStore((s) => s.snapToFirst);
  const selected = useAppStore((s) => s.selectedVertexIndex);

  // ---- Camera watcher + vertex tap handler, alive only in reticle mode ----
  useEffect(() => {
    if (!mapRef || !active) return;
    const map = mapRef.getMap() as unknown as MaplibreMap;

    // Push the camera center up under the crosshair (see file comment).
    const padBottom = Math.round(
      map.getContainer().clientHeight * BOTTOM_PAD_FRACTION,
    );
    map.easeTo({
      padding: { top: 0, bottom: padBottom, left: 0, right: 0 },
      duration: 250,
    });

    const onMove = () => syncCameraToStore(map);
    map.on("move", onMove);
    syncCameraToStore(map); // seed immediately, before the first pan

    // Tap on a vertex dot selects it for editing. We query the invisible
    // oversized "hit" circles (44px) so fingertips do not need pixel aim.
    const onClick = (e: MapMouseEvent) => {
      let hits: ReturnType<typeof map.queryRenderedFeatures> = [];
      try {
        hits = map.queryRenderedFeatures(e.point, { layers: ["reticle-hit"] });
      } catch {
        return; // layer not on the map yet (zero vertices); nothing to do
      }
      if (hits.length === 0) return;
      const idx = hits[0].properties?.index;
      if (typeof idx === "number") {
        useAppStore.getState().setSelectedVertexIndex(idx);
      }
    };
    map.on("click", onClick);

    return () => {
      map.off("move", onMove);
      map.off("click", onClick);
      // Give the camera its normal center back when leaving draw mode.
      try {
        map.easeTo({
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 250,
        });
      } catch {
        // Map already tearing down; nothing to restore.
      }
    };
  }, [mapRef, active]);

  // ---- Re-check the snap state when vertices change WITHOUT the map
  // moving (e.g. right after Add Point or Undo, the camera stays put). ----
  useEffect(() => {
    if (!mapRef || !active) return;
    syncCameraToStore(mapRef.getMap() as unknown as MaplibreMap);
  }, [mapRef, active, vertices, selected]);

  // ---- When a vertex is selected, glide it under the crosshair.
  // easeTo (a smooth slide) rather than flyTo (a dramatic zoom-out-and-in):
  // the vertex is nearby, so a short slide reads better. ----
  useEffect(() => {
    if (!mapRef || !active || selected === null) return;
    const v = useAppStore.getState().reticleVertices[selected];
    if (!v) return;
    const map = mapRef.getMap() as unknown as MaplibreMap;
    // Camera padding is already set, so "center" means "under the crosshair".
    map.easeTo({ center: [v.lon, v.lat], duration: 350 });
  }, [mapRef, active, selected]);

  // ---- GeoJSON for the three visual pieces (memoized so the map is only
  // poked when the underlying data actually changes) ----

  // Every placed corner as a point, tagged with its index for tap lookup.
  const vertexFC = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: vertices.map((v, i) => ({
        type: "Feature",
        properties: { index: i },
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      })),
    }),
    [vertices],
  );

  // The dashed line running through the placed corners.
  const segmentsFeature = useMemo<Feature<LineString> | null>(() => {
    if (vertices.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: vertices.map((v) => [v.lon, v.lat]),
      },
    };
  }, [vertices]);

  // The live "rubber band": last vertex to the crosshair. Hidden while a
  // vertex is selected for editing (the crosshair means "move here" then,
  // not "next corner").
  const rubberFeature = useMemo<Feature<LineString> | null>(() => {
    if (vertices.length < 1 || !center || selected !== null) return null;
    const last = vertices[vertices.length - 1];
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [last.lon, last.lat],
          [center.lon, center.lat],
        ],
      },
    };
  }, [vertices, center, selected]);

  // ---- Data-driven circle sizing ----
  // MapLibre "expressions" are little JSON programs evaluated per feature.
  // This one says: vertex #0 balloons to 20px (radius 10) while snapping,
  // the selected vertex grows slightly, everyone else is a 14px dot
  // (radius 7). Paint changes animate over ~300ms by default, which gives
  // the balloon its pulse for free.
  const dotRadius = [
    "case",
    ["==", ["get", "index"], 0],
    snap ? 10 : 7,
    ["==", ["get", "index"], selected ?? -1],
    9,
    7,
  ] as unknown as ExpressionSpecification;

  const dotColor = [
    "case",
    ["==", ["get", "index"], selected ?? -1],
    "#34d399",
    "#10b981",
  ] as unknown as ExpressionSpecification;

  if (!active) return null;

  return (
    <>
      {segmentsFeature && (
        <Source id="reticle-segments" type="geojson" data={segmentsFeature}>
          <Layer
            id="reticle-segments-line"
            type="line"
            paint={{
              "line-color": "#34d399",
              "line-width": 2,
              "line-dasharray": [2, 1.5],
            }}
          />
        </Source>
      )}

      {rubberFeature && (
        <Source id="reticle-rubber" type="geojson" data={rubberFeature}>
          <Layer
            id="reticle-rubber-line"
            type="line"
            paint={{
              "line-color": "#34d399",
              "line-width": 2,
              "line-opacity": 0.7,
              "line-dasharray": [1, 1.6],
            }}
          />
        </Source>
      )}

      {vertices.length > 0 && (
        <Source id="reticle-vertices" type="geojson" data={vertexFC}>
          {/* The visible dots: emerald with a white ring */}
          <Layer
            id="reticle-dots"
            type="circle"
            paint={{
              "circle-radius": dotRadius,
              "circle-color": dotColor,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
          {/* Invisible 44px tap targets on top (opacity is a hair above
              zero so the layer still registers in hit testing) */}
          <Layer
            id="reticle-hit"
            type="circle"
            paint={{
              "circle-radius": 22,
              "circle-color": "#000000",
              "circle-opacity": 0.001,
            }}
          />
        </Source>
      )}
    </>
  );
}
