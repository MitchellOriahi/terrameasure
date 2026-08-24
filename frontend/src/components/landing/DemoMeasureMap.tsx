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
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
        <div className="compact-attrib relative h-[300px] w-full sm:h-[380px]">
          {mounted ? (
            <Map
              initialViewState={{
                longitude: START_CENTER.lon,
                latitude: START_CENTER.lat,
                zoom: 14.6,
              }}
              mapStyle={SATELLITE_STYLE}
              attributionControl={{ compact: true }}
              // Page scroll wins by default on touch. Without this, a
              // thumb swiping down the landing page that happens to land
              // on this 380px-tall map pans the map instead of scrolling
              // the page, and the visitor thinks the page is stuck. With
              // it, one finger scrolls the page and two fingers move the
              // map, the same rule Google Maps embeds use, and MapLibre
              // shows the "use two fingers" hint itself.
              cooperativeGestures
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

              {/* One draggable handle per corner. 36px of visible dot
                  with an invisible 44px pad around it: big enough for a
                  thumb, small enough not to hide the ground it sits on.
                  (The comment here used to claim 28px was "past the 44px
                  guideline", which it plainly is not.) */}
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
                    className="flex h-11 w-11 cursor-grab items-center justify-center active:cursor-grabbing"
                    style={{ touchAction: "none" }}
                  >
                    <span className="block h-9 w-9 rounded-full border-2 border-white bg-accent shadow-lg" />
                  </div>
                </Marker>
              ))}
            </Map>
          ) : (
            // Placeholder before the map mounts: same size, no jump.
            <div className="flex h-full w-full items-center justify-center bg-surface-2 text-xs text-muted">
              Loading the live map
            </div>
          )}
          {/* Live readout, pinned over the map so the numbers move with
              the shape in one glance. It lives INSIDE the map box, which
              is the thing it is positioned against; as a sibling it
              would drift the moment the card grew a footer. */}
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-line bg-background/85 px-3 py-2 backdrop-blur-sm">
            <div className="font-display text-[10px] uppercase tracking-[0.16em] text-muted">
              Live measurement
            </div>
            <div className="num text-2xl font-semibold leading-tight text-foreground">
              {fmt(acres, 2)}{" "}
              <span className="font-sans text-xs font-normal text-muted">
                acres
              </span>
            </div>
            <div className="num text-[11px] text-muted">
              {fmt(perimM * FT_PER_M, 0)} ft around
            </div>
          </div>

          {/* The instruction, until the visitor works it out themselves */}
          {!touched && (
            <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white/90">
              <Move size={12} />
              Drag a green corner
            </div>
          )}
        </div>

        {/* ---- The card's own footer ----
           This used to be a button floating BELOW the card with the
           caption crammed in beside it, so the most important control on
           the page looked like it had fallen out of the box it belongs
           to. It is now part of the card: one bar across the bottom,
           inside the same border, with the caption underneath where it
           has room to be a sentence instead of a squeeze. */}
        <div className="border-t border-line bg-surface/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-foreground">
              Like the look of it?
            </p>
            <button
              type="button"
              onClick={runRealSurvey}
              className="group inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-5 font-display text-sm font-semibold text-black transition-colors hover:bg-accent-bright"
            >
              Survey this shape
              <ArrowRight
                size={15}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Acreage and perimeter here are pure geometry, computed in your
            browser. Slope, water, flood risk and earthwork cost need the
            elevation engine, which is what that button runs.
          </p>
        </div>
      </div>
    </div>
  );
}
