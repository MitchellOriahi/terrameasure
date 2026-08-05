// lib/site3d.ts
// Entering and leaving "Site 3D" mode: the tilted, slowly-orbiting 3D
// view of the area the user just surveyed.
//
// Why this is a plain module and not a hook: the enter/exit moves are a
// short imperative CHOREOGRAPHY on the raw MapLibre map (save camera,
// switch basemap, wait for tiles, tilt). Hooks are for reacting to
// state; this is a sequence of steps, so plain functions fit better.
// The store (appStore.ts) holds the flags the UI reads; this file does
// the map work.
//
// THE ONE DANGER TO REMEMBER (see lib/mapCamera.ts for the full story):
// MapLibre v6 renders a BLACK SCREEN if an ANIMATED camera move
// (easeTo/flyTo) runs while 3D terrain is on. Every camera move in this
// file is therefore an INSTANT jumpTo, and the proven-good order from
// the TopBar 3D toggle is reused: enable terrain while the map is not
// animating, wait for the map to go "idle" (terrain tiles loaded), then
// tilt with a single instant jump.

import { useAppStore } from "@/store/appStore";
import type { Basemap, Site3dDrape } from "@/store/appStore";
import type { SurveyResponse } from "@/lib/api";

// The minimal map surface we need. Both the raw MapLibre map and the
// MapRef wrapper from @vis.gl/react-maplibre satisfy this (the wrapper
// exposes getMap() to reach the raw map underneath).
type RawMap = {
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getBearing: () => number;
  getPitch: () => number;
  jumpTo: (opts: object) => unknown;
  easeTo: (opts: object) => unknown;
  flyTo: (opts: object) => unknown;
  cameraForBounds: (
    bounds: [[number, number], [number, number]],
    opts?: object,
  ) => { center?: unknown; zoom?: number } | undefined;
  once: (event: string, cb: () => void) => unknown;
  off: (event: string, cb: () => void) => unknown;
  // Method (not arrow-property) syntax on purpose: TypeScript checks
  // methods bivariantly, which lets the real MapLibre Map (whose setSky
  // takes a full SkySpecification) satisfy this loose shape.
  setSky?(sky: unknown): unknown;
};
type MapHandle = { getMap?: () => RawMap } | RawMap | null | undefined;

function rawMap(map: MapHandle): RawMap | null {
  if (!map) return null;
  const wrapper = map as { getMap?: () => RawMap };
  return wrapper.getMap ? wrapper.getMap() : (map as RawMap);
}

// ------------------------------------------------------------------
// Geometry: where on Earth the survey's DEM sits
// ------------------------------------------------------------------

export type Corners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * The four corner coordinates of the survey's DEM footprint, in the
 * order a MapLibre image source wants them: top-left, top-right,
 * bottom-right, bottom-left. The backend reports the DEM as a center
 * point plus a size in meters; this converts meters to degrees (a
 * degree of longitude shrinks with latitude, hence the cosine).
 * Returns null when the survey has no usable footprint.
 */
export function demCorners(survey: SurveyResponse | null): Corners | null {
  if (
    !survey ||
    typeof survey.dem_center_lat !== "number" ||
    typeof survey.dem_center_lon !== "number" ||
    !survey.dem_width_m ||
    !survey.dem_height_m
  ) {
    return null;
  }
  const mPerDegLat = 111_320;
  const mPerDegLon =
    111_320 * Math.cos((survey.dem_center_lat * Math.PI) / 180);
  const halfW = survey.dem_width_m / 2 / mPerDegLon;
  const halfH = survey.dem_height_m / 2 / mPerDegLat;
  const { dem_center_lat: lat, dem_center_lon: lon } = survey;
  return [
    [lon - halfW, lat + halfH],
    [lon + halfW, lat + halfH],
    [lon + halfW, lat - halfH],
    [lon - halfW, lat - halfH],
  ];
}

/** Can this survey be shown in 3D at all? (Needs a DEM footprint.) */
export function site3dAvailable(survey: SurveyResponse | null): boolean {
  return demCorners(survey) !== null;
}

/** Best starting drape for a survey: the sharp live satellite basemap. */
function defaultDrape(): Site3dDrape {
  return "satellite";
}

// ------------------------------------------------------------------
// What we remember on entry so exit can put everything back
// ------------------------------------------------------------------

interface SavedState {
  center: [number, number];
  zoom: number;
  bearing: number;
  basemap: Basemap;
  resultsOpen: boolean;
}

let saved: SavedState | null = null;

// While Site 3D is active we temporarily replace the map's easeTo and
// flyTo with jumpTo. Why so drastic: other components (the search box,
// the TopBar 3D toggle) sometimes call animated moves assuming terrain
// is off, and one animated move with terrain on means a black screen.
// Instant jumps are always safe, so redirecting is a pure guard rail.
let patchedMap: RawMap | null = null;
let origEaseTo: RawMap["easeTo"] | null = null;
let origFlyTo: RawMap["flyTo"] | null = null;

function patchAnimatedMoves(map: RawMap): void {
  if (patchedMap) return; // already guarding
  patchedMap = map;
  origEaseTo = map.easeTo;
  origFlyTo = map.flyTo;
  const jumpInstead = (opts: object) => {
    // Strip the animation-only options; jumpTo ignores the rest anyway.
    const o = { ...(opts as Record<string, unknown>) };
    delete o.duration;
    delete o.essential;
    delete o.curve;
    delete o.speed;
    return map.jumpTo(o);
  };
  map.easeTo = jumpInstead;
  map.flyTo = jumpInstead;
}

function unpatchAnimatedMoves(): void {
  if (patchedMap && origEaseTo && origFlyTo) {
    patchedMap.easeTo = origEaseTo;
    patchedMap.flyTo = origFlyTo;
  }
  patchedMap = null;
  origEaseTo = null;
  origFlyTo = null;
}

// The pending "tilt when ready" listener, so exit can cancel it if the
// user leaves 3D before the terrain even finished loading.
let pendingIdle: (() => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMap: RawMap | null = null;

function cancelPendingTilt(): void {
  if (pendingMap && pendingIdle) pendingMap.off("idle", pendingIdle);
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingIdle = null;
  pendingTimer = null;
  pendingMap = null;
}

// ------------------------------------------------------------------
// Enter
// ------------------------------------------------------------------

/**
 * Switch the main map into Site 3D mode.
 *
 * The steps, in the black-screen-safe order proven by the TopBar toggle:
 *  1. Remember the current 2D camera and basemap (exit restores them).
 *  2. Flip the store: site3d on (which declaratively enables terrain in
 *     MapView), satellite basemap, results panel closed.
 *  3. Instantly jump the still-flat camera to frame the surveyed area.
 *  4. When the map reports "idle" (style + terrain tiles all loaded),
 *     tilt to pitch 60 with one instant jump and start the slow orbit.
 */
export function enterSite3d(map: MapHandle, survey: SurveyResponse): void {
  const raw = rawMap(map);
  const store = useAppStore.getState();
  const corners = demCorners(survey);
  if (!raw || !corners) {
    // Guard rail: no map or no DEM footprint means no 3D. Say so and
    // leave the app exactly as it was; never enter a broken mode.
    store.setToast("3D view is not available for this survey");
    setTimeout(() => useAppStore.getState().setToast(null), 3500);
    return;
  }

  try {
    // 1. Remember where the user was, so Exit is a true round trip.
    const c = raw.getCenter();
    saved = {
      center: [c.lng, c.lat],
      zoom: raw.getZoom(),
      bearing: raw.getBearing(),
      basemap: store.basemap,
      resultsOpen: store.resultsOpen,
    };

    // Guard rail: while in 3D, animated moves from anywhere become jumps.
    patchAnimatedMoves(raw);

    // 2. One store update flips everything at once. Satellite imagery is
    //    what makes a 3D site look real, so we switch to it (and switch
    //    back on exit). terrain3d (the global TopBar toggle) goes off so
    //    Site 3D is the single owner of the terrain while it runs.
    useAppStore.setState({
      site3d: true,
      basemap: "satellite",
      terrain3d: false,
      resultsOpen: false,
      layersPanelOpen: false,
      site3dOrbiting: false, // orbit starts only after the tilt lands
      site3dDrape: defaultDrape(),
    });

    // 3. Frame the site while still flat. cameraForBounds answers "what
    //    center and zoom shows this rectangle with this padding". The
    //    bottom padding leaves room for the floating control card.
    const topLeft = corners[0];
    const bottomRight = corners[2];
    const bounds: [[number, number], [number, number]] = [
      [topLeft[0], bottomRight[1]], // southwest corner
      [bottomRight[0], topLeft[1]], // northeast corner
    ];
    const phone = window.matchMedia("(max-width: 768px)").matches;
    const cam = raw.cameraForBounds(bounds, {
      padding: phone
        ? { top: 90, bottom: 250, left: 36, right: 36 }
        : { top: 110, bottom: 160, left: 120, right: 120 },
      maxZoom: 17,
    });
    raw.jumpTo({
      ...(cam?.center ? { center: cam.center } : {}),
      ...(typeof cam?.zoom === "number" ? { zoom: cam.zoom } : {}),
      bearing: 0,
      pitch: 0, // stay flat until the terrain is truly ready
    });

    // 4. Tilt only once the map has finished ALL pending work (the new
    //    basemap style and the elevation tiles). "idle" is exactly that
    //    signal. A timeout backstop tilts anyway after 8 seconds so a
    //    stalled tile server can never leave us stuck flat forever.
    let done = false;
    const tilt = () => {
      if (done) return;
      done = true;
      cancelPendingTilt();
      // Still in 3D mode? The user may have hit Exit during loading.
      if (!useAppStore.getState().site3d) return;
      // A deep-night sky for the space above the horizon. Purely
      // cosmetic, but without it that space renders as raw black and
      // reads like a bug. Wrapped in try/catch because the 3D mode must
      // still work even if the sky API misbehaves.
      try {
        raw.setSky?.({
          "sky-color": "#0b1420",
          "horizon-color": "#28343d",
          "fog-color": "#10171d",
          "sky-horizon-blend": 0.8,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0.9,
        });
      } catch {
        // Sky is a nice-to-have; ignore any failure.
      }
      raw.jumpTo({ pitch: 60 }); // instant jump: always safe
      useAppStore.getState().setSite3dOrbiting(true);
    };
    pendingMap = raw;
    pendingIdle = tilt;
    pendingTimer = setTimeout(tilt, 8000);
    raw.once("idle", tilt);
  } catch {
    // Anything unexpected: bail out cleanly rather than strand the user
    // in a half-entered mode.
    exitSite3d(map);
    useAppStore.getState().setToast("3D view failed to start");
    setTimeout(() => useAppStore.getState().setToast(null), 3500);
  }
}

// ------------------------------------------------------------------
// Exit
// ------------------------------------------------------------------

/**
 * Leave Site 3D mode and put everything back: terrain off, prior
 * basemap, prior camera (level, straight-down 2D), results panel
 * reopened if it was open before. Safe to call at any moment, even
 * mid-entry; it always lands the app in a clean 2D state.
 */
export function exitSite3d(map: MapHandle): void {
  const raw = rawMap(map);
  cancelPendingTilt();
  unpatchAnimatedMoves();

  const store = useAppStore.getState();
  useAppStore.setState({
    site3d: false, // MapView drops the terrain on this render
    site3dOrbiting: false,
    basemap: saved?.basemap ?? store.basemap,
    // Reopen the results only if they were open before AND the survey
    // still exists (it may have been cleared while in 3D).
    resultsOpen: saved ? saved.resultsOpen && store.survey !== null : false,
  });

  if (raw) {
    // Remove the night sky the tilt step added (cosmetic, best-effort).
    try {
      raw.setSky?.(undefined);
    } catch {
      // Ignore; the basemap switch below replaces the style anyway.
    }
  }
  if (raw && saved) {
    // One instant jump home. Pitch goes to 0 (we are back in 2D; the
    // terrain is gone, so a tilted camera would just look broken).
    raw.jumpTo({
      center: saved.center,
      zoom: saved.zoom,
      bearing: saved.bearing,
      pitch: 0,
    });
  }
  saved = null;
}
