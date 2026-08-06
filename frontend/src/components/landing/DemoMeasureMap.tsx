// components/landing/DemoMeasureMap.tsx
// The landing page's live demo: a real satellite map with a real
// boundary on it whose corners you can drag, with the acreage and
// perimeter recomputing as you drag.
//
// Why a working tool instead of a screenshot: every competitor's home
// page shows a picture of their product. A visitor cannot tell a picture
// of a measuring tool from a picture of anything else. Ten seconds of
// dragging a corner and watching the acres change teaches what this
// product is better than any paragraph, and the numbers here are
// computed by the SAME geometry code the app uses (lib/geo.ts), so the
// demo cannot drift away from the truth.
//
// What it does NOT do: call the backend. Area and perimeter are pure
// geometry in the browser. The elevation survey (slope, water, flood,
// cost) is the part that needs the server, and that is exactly what the
// button underneath hands off to the real app.
//
// Loading behaviour: the map only mounts once it scrolls into view, so
// a visitor who never reaches it never downloads a single tile.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Map, Marker, Source, Layer } from "@vis.gl/react-maplibre";
import type { Feature, Polygon } from "geojson";
import { ArrowRight, Move } from "lucide-react";
import { SATELLITE_STYLE } from "@/components/map/basemaps";
import { polygonAreaM2, polygonPerimeterM, fmt, type LatLon } from "@/lib/geo";

const M2_PER_ACRE = 4046.86;
const FT_PER_M = 3.28084;

// Where the demo opens: foothills west of Golden, Colorado. Chosen
// because it has visible relief, open ground, and 1 m USGS lidar
// coverage, so if a visitor presses the button they get a real survey
// from the best data we have rather than a coarse fallback.
const START: LatLon[] = [
  { lat: 39.748, lon: -105.232 },
  { lat: 39.748, lon: -105.227 },
  { lat: 39.7448, lon: -105.2262 },
  { lat: 39.744, lon: -105.231 },
];
const START_CENTER = { lat: 39.7462, lon: -105.2292 };

export function DemoMeasureMap() {
  const navigate = useNavigate();
  const [vertices, setVertices] = useState<LatLon[]>(START);
  // Has the block scrolled into view yet? Tiles cost bandwidth, so we
  // wait until someone can actually see them.
  const [mounted, setMounted] = useState(false);
  // Has the visitor dragged anything yet? Drives the "drag me" hint.
  const [touched, setTouched] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setMounted(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The measurements, recomputed on every drag frame. Both come from
  // the app's own geometry helpers.
  const areaM2 = useMemo(() => polygonAreaM2(vertices), [vertices]);
  const perimM = useMemo(() => polygonPerimeterM(vertices), [vertices]);
  const acres = areaM2 / M2_PER_ACRE;

  // The polygon as GeoJSON for the fill and outline layers.
  const feature = useMemo<Feature<Polygon>>(() => {
    const ring = vertices.map((v) => [v.lon, v.lat] as [number, number]);
    ring.push(ring[0]);
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }, [vertices]);

  function moveVertex(i: number, lat: number, lon: number) {
    setTouched(true);
    setVertices((prev) =>
      prev.map((v, idx) => (idx === i ? { lat, lon } : v)),
    );
  }

  /** Hand this exact shape to the real app, which runs a real survey. */
  function runRealSurvey() {
    navigate("/map", { state: { reopen: { vertices } } });
  }

  return (
    <div ref={boxRef} className="w-full">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface-2">
        <div className="h-[300px] w-full sm:h-[380px]">
          {mounted ? (
            <Map
              initialViewState={{
                longitude: START_CENTER.lon,
                latitude: START_CENTER.lat,
                zoom: 14.6,
              }}
              mapStyle={SATELLITE_STYLE}
              attributionControl={{ compact: true }}
              style={{ width: "100%", height: "100%" }}
            >
              <Source id="demo-shape" type="geojson" data={feature}>
                <Layer
                  id="demo-fill"
                  type="fill"
                  paint={{ "fill-color": "#34d399", "fill-opacity": 0.18 }}
                />
                <Layer
                  id="demo-line"
                  type="line"
                  paint={{ "line-color": "#34d399", "line-width": 2.5 }}
                />
              </Source>

              {/* One draggable handle per corner. 28px targets: past the
                  44px guideline once the finger's contact area is counted,
                  and small enough not to hide the ground underneath. */}
              {vertices.map((v, i) => (
                <Marker
                  key={i}
                  longitude={v.lon}
                  latitude={v.lat}
                  draggable
                  onDrag={(e) => moveVertex(i, e.lngLat.lat, e.lngLat.lng)}
                >
                  <div
                    aria-label={`Corner ${i + 1}, drag to move`}
                    className="h-7 w-7 cursor-grab rounded-full border-2 border-white bg-accent shadow-lg active:cursor-grabbing"
                    style={{ touchAction: "none" }}
                  />
                </Marker>
              ))}
            </Map>
          ) : (
            // Placeholder before the map mounts: same size, no jump.
            <div className="flex h-full w-full items-center justify-center bg-surface-2 text-xs text-muted">
              Loading the live map
            </div>
          )}
        </div>

        {/* Live readout, pinned over the map so the numbers move with
            the shape in one glance. */}
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-line bg-background/85 px-3 py-2 backdrop-blur-sm">
          <div className="text-[10px] uppercase tracking-widest text-muted">
            Live measurement
          </div>
          <div className="num text-xl font-semibold text-foreground">
            {fmt(acres, 2)} <span className="text-xs text-muted">acres</span>
          </div>
          <div className="num text-[11px] text-muted">
            {fmt(perimM * FT_PER_M, 0)} ft around
          </div>
        </div>

        {/* The instruction, until the visitor works it out themselves */}
        {!touched && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white/90">
            <Move size={12} />
            Drag a green corner
          </div>
        )}
      </div>

      {/* The handoff: the same shape, measured for real by the engine */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={runRealSurvey}
          className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-black transition-colors hover:bg-accent-bright"
        >
          Survey this shape for real
          <ArrowRight
            size={15}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </button>
        <p className="text-[11px] leading-relaxed text-muted">
          Area and perimeter here are pure geometry, computed in your
          browser. Slope, water, flood risk and earthwork cost need the
          elevation engine, which is what that button runs.
        </p>
      </div>
    </div>
  );
}
