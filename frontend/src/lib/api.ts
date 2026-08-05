// lib/api.ts
// Everything about talking to the Python backend lives in this one file:
// the base URL, the TypeScript shapes of what the API returns, and small
// typed functions that TanStack Query calls.

// ------------------------------------------------------------------
// Where is the backend?
// In development, Vite proxies "/api/..." to http://localhost:8000
// (see vite.config.ts), which avoids CORS headaches entirely.
// In production, the FastAPI server that answers the API calls is the
// SAME server that served this page (it hosts frontend/dist at the
// root). So the base is simply "" and every call is a relative URL
// like "/survey/polygon": it works on Render, on localhost, and on any
// future domain without rebuilding. A split deployment (static host +
// separate API) can still override this at build time with VITE_API_URL.
// ------------------------------------------------------------------
export const API_BASE: string = import.meta.env.DEV
  ? "/api"
  : (import.meta.env.VITE_API_URL ?? "");

// ------------------------------------------------------------------
// Response shapes. These mirror the Pydantic models in api/server.py.
// If the backend changes, update these to match.
// ------------------------------------------------------------------

// The project's one unbreakable rule: never a bare number.
// Every measurement carries its error estimate.
export interface MeasurementOut {
  value: number;
  unit: string;
  error: number;
  note: string;
}

// ------------------------------------------------------------------
// New backend extras (score, cost, context, parcel).
// All of these are OPTIONAL on SurveyResponse because the deployed API
// on Render may be an older build that does not send them yet. The UI
// checks for each one and falls back gracefully when it is missing.
// ------------------------------------------------------------------

// One line of the score breakdown: which factor moved the score, by how
// much ("+15", "-22", "0"), and a plain-language reason.
export interface ScoreFactor {
  factor: string;
  effect: string;
  note: string;
}

// The server-computed site score. verdict is lowercase on the wire
// ("go" | "caution" | "no-go"); the UI uppercases it for display.
export interface ScoreOut {
  value: number; // 0 to 100
  verdict: "go" | "caution" | "no-go";
  label: string; // "Excellent" | "Good" | "Fair" | "Challenging"
  buildable_area_pct: number; // water-adjusted, 0 to 100
  breakdown: ScoreFactor[];
  note: string;
}

// Rough grading cost range computed server-side from cut + fill volume.
export interface EarthworkCostOut {
  low_usd: number;
  high_usd: number;
  base_usd: number;
  cut_m3: number;
  fill_m3: number;
  note: string;
}

// Each context source reports "ok" or, honestly, "unavailable".
export type ContextStatus = "ok" | "unavailable";

export interface WetlandsContext {
  status: ContextStatus;
  wetland_types: string[];
  coverage_fraction: number | null; // 0 to 1, share of site in wetlands
  open_water_fraction: number | null; // subset that is open water
  source: string;
  note: string;
}

export interface WaterbodyOut {
  name: string | null;
  feature_type: string | null;
  area_sqkm: number | null;
}

export interface WaterContext {
  status: ContextStatus;
  waterbodies: WaterbodyOut[];
  coverage_fraction: number | null;
  source: string;
  note: string;
}

export interface FloodZoneOut {
  zone: string; // FEMA zone code like "AE" or "X"
  subtype: string | null;
  high_risk: boolean;
}

export interface FloodContext {
  status: ContextStatus;
  zones: FloodZoneOut[];
  in_high_risk_zone: boolean | null;
  high_risk_fraction: number | null;
  source: string;
  note: string;
}

// The bundle of all three checks plus a combined open-water estimate.
export interface SurveyContext {
  wetlands: WetlandsContext;
  water: WaterContext;
  flood: FloodContext;
  open_water_fraction: number | null;
  note: string;
}

export interface SurveyResponse {
  source: string;
  vertical_error_m: number;
  grid_shape: number[];
  cell_size_m: number;
  min_height: number;
  max_height: number;
  avg_height: number;
  dem_grid: number[][];
  avg_slope: MeasurementOut;
  cut_volume: MeasurementOut;
  fill_volume: MeasurementOut;
  // Pairs of [distance_m, height_m] along the site diagonal
  elevation_profile: [number, number][];
  buildable_area_pct: number;
  dominant_aspect_deg: number;
  // The base64 image fields are OPTIONAL because shared-report snapshots
  // strip them server-side (only the two "clean" overlays may survive,
  // and only when they fit the storage budget). A live survey response
  // always includes all five; code that uses one must check it exists.
  slope_map_png_b64?: string;
  contour_map_png_b64?: string;
  slope_map_clean_b64?: string;
  contour_map_clean_b64?: string;
  satellite_texture_b64?: string;
  // Geographic footprint of the DEM, used to pin image overlays on the map
  dem_center_lat: number;
  dem_center_lon: number;
  dem_width_m: number;
  dem_height_m: number;

  // ---- New optional fields (older deployed APIs omit these) ----
  // Server-computed score and verdict; preferred over the client-side
  // heuristic in lib/verdict.ts whenever present.
  score?: ScoreOut;
  // Server-computed earthwork cost range.
  earthwork_cost?: EarthworkCostOut;
  // Wetlands / water / flood findings for the surveyed polygon.
  context?: SurveyContext | null;
  // Set when the primary DEM source failed and a fallback was used.
  dem_source_note?: string;
  // The uncertified-survey disclaimer, verbatim from the backend.
  disclaimer?: string;
}

// ------------------------------------------------------------------
// Parcel lookup: GET /parcel?lat=&lon= returns "whose land is this".
// status tells the honest story: "ok" (found one), "no_coverage" (we
// have no data for that county yet), or "unavailable" (county server
// did not answer).
// ------------------------------------------------------------------
export interface ParcelResponse {
  status: "ok" | "no_coverage" | "unavailable";
  parcel_id: string | null;
  owner: string | null;
  address: string | null;
  acreage: number | null;
  land_use: string | null;
  zoning: string | null;
  assessed_value: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  // GeoJSON Polygon of the parcel outline ([lon, lat] rings), or null
  boundary: { type: "Polygon"; coordinates: number[][][] } | null;
  source: string | null;
  county: string | null;
  note: string;
  disclaimer?: string;
}

// One result row from the backend's /geocode proxy (Nominatim format)
export interface GeocodeResult {
  place_id: number;
  display_name: string;
  lat: string; // Nominatim returns coordinates as strings
  lon: string;
  type: string;
  boundingbox?: [string, string, string, string];
}

// ------------------------------------------------------------------
// Shareable reports: POST a survey snapshot, get back a short slug;
// anyone can GET that slug later with no login. Mirrors api/reports.py.
// ------------------------------------------------------------------

// What POST /reports answers with.
export interface ReportCreateResponse {
  slug: string;
  url_path: string; // "/r/{slug}", ready to append to the site origin
  created_at: string; // ISO timestamp
}

// What GET /reports/{slug} answers with. The snapshot is exactly what
// we posted, except the server stripped the heavy base64 images (the
// two clean overlays may survive when they fit the storage budget).
export interface ReportResponse {
  slug: string;
  title: string | null;
  snapshot: {
    survey: SurveyResponse;
    parcel?: ParcelResponse | null;
    vertices?: { lat: number; lon: number }[] | null;
  };
  created_at: string;
  disclaimer: string;
}

// ------------------------------------------------------------------
// Small fetch wrapper: throws a readable Error on any non-200 response
// so the UI can show a human message instead of silently failing.
// ApiError additionally carries the HTTP status, so pages that care
// (like the report page telling 404 apart from a server hiccup) can
// check it without parsing message text.
// ------------------------------------------------------------------
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    // fetch() itself only throws when the network is down or the server
    // is unreachable (common during backend cold starts).
    throw new Error(
      "Could not reach the survey engine. Check your connection, or the free-tier server may still be waking up.",
    );
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Body was not JSON; keep the generic message.
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

// ------------------------------------------------------------------
// The two calls the app makes today
// ------------------------------------------------------------------

/** Run a survey on a drawn polygon. Vertices are {lat, lon} pairs. */
export function surveyPolygon(
  vertices: { lat: number; lon: number }[],
  resolutionM = 10,
): Promise<SurveyResponse> {
  return request<SurveyResponse>("/survey/polygon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vertices, resolution_m: resolutionM }),
  });
}

/** Address / place search (backend proxies to OpenStreetMap Nominatim). */
export function geocode(q: string): Promise<GeocodeResult[]> {
  return request<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(q)}`);
}

/** Look up the tax parcel under a tapped point (pilot counties only). */
export function fetchParcel(lat: number, lon: number): Promise<ParcelResponse> {
  return request<ParcelResponse>(`/parcel?lat=${lat}&lon=${lon}`);
}

/**
 * Turn the current survey into a public share link.
 *
 * Before posting we drop the three heavy base64 images (satellite photo
 * and the two decorated maps). The server strips them anyway, so sending
 * them would only risk tripping its 2 MB request limit. The two CLEAN
 * overlays stay in: the server keeps those when they fit its budget,
 * and the report page drapes them over its map.
 */
export function createReport(input: {
  survey: SurveyResponse;
  parcel?: ParcelResponse | null;
  vertices?: { lat: number; lon: number }[] | null;
  title?: string;
}): Promise<ReportCreateResponse> {
  const slimSurvey: Record<string, unknown> = { ...input.survey };
  delete slimSurvey.slope_map_png_b64;
  delete slimSurvey.contour_map_png_b64;
  delete slimSurvey.satellite_texture_b64;

  return request<ReportCreateResponse>("/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      survey: slimSurvey,
      parcel: input.parcel ?? null,
      vertices: input.vertices ?? null,
      title: input.title ?? null,
    }),
  });
}

/** Fetch a shared report by its slug. Public, no login. 404s throw ApiError. */
export function fetchReport(slug: string): Promise<ReportResponse> {
  return request<ReportResponse>(`/reports/${encodeURIComponent(slug)}`);
}
