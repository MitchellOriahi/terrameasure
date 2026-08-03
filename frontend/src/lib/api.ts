// lib/api.ts
// Everything about talking to the Python backend lives in this one file:
// the base URL, the TypeScript shapes of what the API returns, and small
// typed functions that TanStack Query calls.

// ------------------------------------------------------------------
// Where is the backend?
// In development, Vite proxies "/api/..." to http://localhost:8000
// (see vite.config.ts), which avoids CORS headaches entirely.
// In production, we talk straight to the deployed API. The URL can be
// overridden at build time with the VITE_API_URL environment variable.
// ------------------------------------------------------------------
export const API_BASE: string = import.meta.env.DEV
  ? "/api"
  : (import.meta.env.VITE_API_URL ?? "https://terrameasurev2.onrender.com");

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
  slope_map_png_b64: string;
  contour_map_png_b64: string;
  slope_map_clean_b64: string;
  contour_map_clean_b64: string;
  satellite_texture_b64: string;
  // Geographic footprint of the DEM, used to pin image overlays on the map
  dem_center_lat: number;
  dem_center_lon: number;
  dem_width_m: number;
  dem_height_m: number;
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
// Small fetch wrapper: throws a readable Error on any non-200 response
// so the UI can show a human message instead of silently failing.
// ------------------------------------------------------------------
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
    throw new Error(detail);
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
