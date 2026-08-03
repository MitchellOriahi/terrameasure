// lib/geo.ts
// Small geometry helpers that run in the browser.
//
// The backend does the heavy terrain math, but two numbers are pure 2D
// geometry of the shape the user drew, so we compute them right here:
//   area      (how big is the outline)
//   perimeter (how long is the fence line around it)
//
// The math: at any latitude, one degree of latitude is ~111,320 meters,
// and one degree of longitude is 111,320 * cos(latitude) meters (the
// east-west lines squeeze together toward the poles). We convert each
// vertex from degrees to local meters, then use the classic "shoelace"
// formula for area and plain distances for the perimeter. For parcels
// up to a few kilometers across this flat-earth approximation is well
// inside our error bounds.

export interface LatLon {
  lat: number;
  lon: number;
}

const M_PER_DEG_LAT = 111_320;

/** Convert lat/lon vertices to x/y meters around the polygon's center. */
function toLocalMeters(vertices: LatLon[]): { x: number; y: number }[] {
  const centerLat =
    vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return vertices.map((v) => ({
    x: v.lon * mPerDegLon,
    y: v.lat * M_PER_DEG_LAT,
  }));
}

/** Polygon area in square meters (shoelace formula). Always positive. */
export function polygonAreaM2(vertices: LatLon[]): number {
  if (vertices.length < 3) return 0;
  const pts = toLocalMeters(vertices);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length]; // wraps back to the first point
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Total edge length around the polygon, in meters. */
export function polygonPerimeterM(vertices: LatLon[]): number {
  if (vertices.length < 2) return 0;
  const pts = toLocalMeters(vertices);
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Straight-line distance between two lat/lon points, in meters. */
export function distanceM(a: LatLon, b: LatLon): number {
  // Same flat-earth trick as above: convert both points to local meters
  // and measure with the Pythagorean theorem. Plenty accurate at parcel
  // scale, which is all the live drawing readout needs.
  const [pa, pb] = toLocalMeters([a, b]);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** Length of an OPEN polyline (does not loop back to the start). */
export function pathLengthM(vertices: LatLon[]): number {
  // Used while drawing: "how far have I walked so far", before the shape
  // is closed. polygonPerimeterM wraps around; this one does not.
  if (vertices.length < 2) return 0;
  const pts = toLocalMeters(vertices);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

// ------------------------------------------------------------------
// Pinning a survey image overlay onto the map
// ------------------------------------------------------------------

/** The four [lon, lat] corners a MapLibre image source wants, in order:
    top-left, top-right, bottom-right, bottom-left. */
export type ImageCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * The backend describes its DEM footprint as a center point plus a width
 * and height in meters. MapLibre wants four corner coordinates instead,
 * so this converts one to the other (same flat-earth degree math as the
 * area helpers above). Used to drape the slope/contour PNGs on the map.
 */
export function demImageCorners(dem: {
  dem_center_lat: number;
  dem_center_lon: number;
  dem_width_m: number;
  dem_height_m: number;
}): ImageCorners {
  const mPerDegLon =
    M_PER_DEG_LAT * Math.cos((dem.dem_center_lat * Math.PI) / 180);
  const halfW = dem.dem_width_m / 2 / mPerDegLon;
  const halfH = dem.dem_height_m / 2 / M_PER_DEG_LAT;
  const lat = dem.dem_center_lat;
  const lon = dem.dem_center_lon;
  return [
    [lon - halfW, lat + halfH],
    [lon + halfW, lat + halfH],
    [lon + halfW, lat - halfH],
    [lon - halfW, lat - halfH],
  ];
}

// ------------------------------------------------------------------
// Friendly number formatting for the results panel
// ------------------------------------------------------------------

/** 1234567.8 -> "1,234,568" (no decimals) or with the given decimals. */
export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Square meters -> a readable string, switching to acres for big sites. */
export function fmtArea(m2: number): { value: string; unit: string } {
  const acres = m2 / 4046.86;
  if (acres >= 0.5) return { value: fmt(acres, 2), unit: "acres" };
  return { value: fmt(m2), unit: "m²" };
}

/** Meters -> "382 m" or "1.24 km" style. */
export function fmtLength(m: number): { value: string; unit: string } {
  if (m >= 1000) return { value: fmt(m / 1000, 2), unit: "km" };
  return { value: fmt(m), unit: "m" };
}
