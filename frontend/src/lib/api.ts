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
  // ---- Newer backends only; check before using ----
  // One-sentence headline: the single biggest constraint on the site,
  // shown right under the verdict word.
  headline_reason?: string;
  // What the score does NOT cover (zoning, septic, access, ...), for the
  // scope strip under the verdict banner.
  not_checked?: string[];
}

// The cost of grading just a building pad (newer backends). Shaped like
// the main cost range: a low/high USD bracket plus a note about the
// assumptions (pad size, placement).
export interface PadCostOut {
  low_usd: number;
  high_usd: number;
  base_usd?: number;
  pad_area_m2?: number;
  note?: string;
}

// Rough grading cost range computed server-side from cut + fill volume.
export interface EarthworkCostOut {
  low_usd: number;
  high_usd: number;
  base_usd: number;
  cut_m3: number;
  fill_m3: number;
  note: string;
  // ---- Newer backends only; check before using ----
  // Volume that balances on site, and the leftover to import/export.
  balanced_m3?: number;
  net_m3?: number;
  // What the main range actually covers ("theoretical full-site balance").
  scope?: string;
  // Pad-based costing (the realistic headline number); when present the
  // UI shows it FIRST and demotes the full-site figure.
  pad_cost?: PadCostOut;
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
  // Newer backends: when the source data was published or last updated
  // (e.g. "NWI data effective 2019"). Shown next to the source name;
  // when absent we show nothing rather than invent a date.
  data_vintage?: string;
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
  // Newer backends: source publication/effective info (see WetlandsContext).
  data_vintage?: string;
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
  // Newer backends: FEMA map effective date info (see WetlandsContext).
  data_vintage?: string;
}

// The bundle of all three checks plus a combined open-water estimate.
export interface SurveyContext {
  wetlands: WetlandsContext;
  water: WaterContext;
  flood: FloodContext;
  open_water_fraction: number | null;
  note: string;
  // Newer backends: one general "how current is this data" line, used
  // as the fallback when a source has no data_vintage of its own.
  data_currency_note?: string;
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
  // Newer backends: elevation data collection vintage (e.g. lidar year).
  dem_data_vintage?: string;
  // Newer backends: the "balance grade", the single elevation where cut
  // and fill cancel out (no dirt trucked in or out). The note explains
  // this in plain language and the UI shows it verbatim.
  balance_grade?: { elevation_m: number; note?: string };
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

// ------------------------------------------------------------------
// Reverse geocoding: "what place is this point in?"
// The backend asks OpenStreetMap and hands back only the fields a land
// report needs. Every one can be null: plenty of land sits outside any
// named town, and we would rather show nothing than invent a place.
// ------------------------------------------------------------------
export interface PlaceInfo {
  place: string | null; // nearest town, city or neighbourhood
  county: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
  display_name: string | null; // the full one-line address
  label: string; // "Golden, Jefferson County, Colorado"
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

// The human-written part of a report: what the site is called, the
// notes the author typed, and the place we looked up. Everything here is
// editable by the person who created the report; the measurements never
// are.
export interface ReportSite {
  name?: string;
  notes?: string;
  place?: {
    place?: string;
    county?: string;
    state?: string;
    country?: string;
    label?: string;
  };
}

// What POST /reports answers with.
export interface ReportCreateResponse {
  slug: string;
  url_path: string; // "/r/{slug}", ready to append to the site origin
  created_at: string; // ISO timestamp
  // The key that proves this browser made the report, so it can edit the
  // wording later. Kept on the device, never shown to readers.
  edit_token?: string;
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
    // Written by the report's author (older reports have none).
    site?: ReportSite | null;
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

// How long any one call may hang before we give up and say so.
//
// Why a cap at all: without one, a request that never answers leaves a
// spinner on screen forever, and "forever" is the single worst thing an
// app can show. The backend's own worst case is bounded (it waits about
// 35 seconds on USGS, then about 45 on the fallback, then answers with
// an honest 503), so a ceiling comfortably above that turns a hung
// network into a readable message instead of a dead screen.
const DEFAULT_TIMEOUT_MS = 60_000;
const SURVEY_TIMEOUT_MS = 180_000; // cold start plus both elevation tries

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  // AbortSignal.timeout is the browser's own "cancel this after N ms".
  // Older browsers may not have it, hence the guard: there, the request
  // simply behaves as it always did.
  const signal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal });
  } catch (e) {
    // Two different failures land here. A timeout deserves its own
    // sentence, because "check your connection" is wrong and unhelpful
    // when the connection is fine and the far end is simply stuck.
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(
        `The survey engine did not answer within ${Math.round(
          timeoutMs / 1000,
        )} seconds. The public elevation service it depends on may be down. Your boundary is safe: try again in a minute.`,
      );
    }
    // fetch() otherwise only throws when the network is down or the
    // server is unreachable (common during backend cold starts).
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
  return request<SurveyResponse>(
    "/survey/polygon",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertices, resolution_m: resolutionM }),
    },
    SURVEY_TIMEOUT_MS,
  );
}

/** Address / place search (backend proxies to OpenStreetMap Nominatim). */
export function geocode(q: string): Promise<GeocodeResult[]> {
  return request<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(q)}`);
}

/** Name the place a point sits in (county and state for the report).
    Short leash: this runs in the background after results are already on
    screen, so a slow answer must never linger. */
export function reverseGeocode(lat: number, lon: number): Promise<PlaceInfo> {
  return request<PlaceInfo>(`/reverse?lat=${lat}&lon=${lon}`, undefined, 20_000);
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
  site?: ReportSite | null;
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
      site: input.site ?? null,
    }),
  });
}

/** Fetch a shared report by its slug. Public, no login. 404s throw ApiError. */
export function fetchReport(slug: string): Promise<ReportResponse> {
  return request<ReportResponse>(`/reports/${encodeURIComponent(slug)}`);
}

/**
 * Rewrite the WORDS of a report you created: its title, the site name
 * and your notes. Needs the edit token this browser was handed when the
 * report was made. The measurements are not editable by anyone, ever.
 */
export function updateReport(
  slug: string,
  editToken: string,
  input: { title?: string | null; site?: ReportSite | null },
): Promise<{ slug: string; title: string | null; site: ReportSite }> {
  return request(`/reports/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edit_token: editToken,
      title: input.title ?? null,
      site: input.site ?? null,
    }),
  });
}
