// lib/mapCamera.ts
// One safety rule for every programmatic camera move in this app:
//
//   NEVER run an ANIMATED camera move while 3D terrain is on.
//
// Why: MapLibre v6 has a rendering bug where animated camera moves
// (easeTo / flyTo) with terrain enabled leave the whole map black.
// We proved this with isolation tests during QA: with terrain on,
// hand-dragging the map and INSTANT jumps render perfectly, while any
// animated move goes black (both maplibre-gl 6.0 and 6.1, real Chrome
// and headless alike). Until the upstream bug is fixed, the safe rule
// is simple: animate on flat maps, jump instantly when terrain is up.
//
// Use safeEaseTo / safeFlyTo instead of calling map.easeTo / map.flyTo
// directly anywhere terrain COULD be on.

// The helpers accept either the raw MapLibre map or the MapRef wrapper
// that @vis.gl/react-maplibre gives us (both have the same methods;
// MapRef also has getMap() to reach the raw map underneath).
type CameraCapable = {
  getMap?: () => CameraCapable;
  getTerrain?: () => unknown;
  jumpTo: (opts: object) => unknown;
  easeTo: (opts: object) => unknown;
  flyTo: (opts: object) => unknown;
};

/** The subset of camera options our app actually uses. */
export type CameraMove = {
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  padding?: { top: number; bottom: number; left: number; right: number };
  duration?: number;
  essential?: boolean;
};

/** Is 3D terrain currently active on this map? */
function terrainOn(map: CameraCapable): boolean {
  try {
    // MapRef proxies getTerrain, but reaching the raw map is safest.
    const raw = map.getMap ? map.getMap() : map;
    return Boolean(raw.getTerrain?.());
  } catch {
    return false; // map still starting up; treat as flat
  }
}

/** Drop the animation-only fields so jumpTo gets a clean options bag. */
function withoutAnimation(opts: CameraMove): object {
  const { duration: _duration, essential: _essential, ...rest } = opts;
  return rest;
}

/** Smooth slide on a flat map; instant jump when terrain is on. */
export function safeEaseTo(
  map: CameraCapable | null | undefined,
  opts: CameraMove,
): void {
  if (!map) return;
  if (terrainOn(map)) map.jumpTo(withoutAnimation(opts));
  else map.easeTo(opts);
}

/** Cinematic flight on a flat map; instant jump when terrain is on. */
export function safeFlyTo(
  map: CameraCapable | null | undefined,
  opts: CameraMove,
): void {
  if (!map) return;
  if (terrainOn(map)) map.jumpTo(withoutAnimation(opts));
  else map.flyTo(opts);
}
