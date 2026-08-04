// lib/news.ts
// Data layer for the TerraIntel news page (/news).
//
// Two live sources, both plain JSON APIs the browser can call directly
// (no CORS proxy needed):
//
//   1. ReliefWeb (UN OCHA)  : disaster and relief reports worldwide.
//      NOTE: ReliefWeb moved to /v2 and now requires a REGISTERED
//      appname. Until TerraMeasure registers one (free, see
//      https://apidoc.reliefweb.int/parameters#appname) this source
//      returns 403 and the page shows its honest "unavailable" state.
//   2. USGS earthquakes     : significant quakes worldwide, or, when a
//      location filter is set, all M2.5+ quakes inside that area's
//      bounding box (via the USGS FDSNWS event API).
//
// The old TerraIntel page also pulled USGS/USDA/NASA RSS feeds, but only
// through a third-party CORS proxy (allorigins.win). Proxies like that
// die without warning, so those feeds are intentionally dropped here.

import { geocode } from "@/lib/api";

// ------------------------------------------------------------------
// The location filter, persisted under the SAME localStorage key the
// old app used, so both apps (and the profile location sync) agree.
// ------------------------------------------------------------------

export interface NewsLocation {
  country: string; // e.g. "United States", "" means no filter
  state: string; // e.g. "Texas", optional refinement
  city: string; // e.g. "Austin", optional refinement
}

const STORAGE_KEY = "terrameasure_news_location";

export const EMPTY_LOCATION: NewsLocation = { country: "", state: "", city: "" };

/** Read the saved location filter, or the empty filter if none saved. */
export function loadNewsLocation(): NewsLocation {
  // try/catch because localStorage can throw in some private-browsing modes
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LOCATION;
    const parsed = JSON.parse(raw) as Partial<NewsLocation>;
    return {
      country: parsed.country ?? "",
      state: parsed.state ?? "",
      city: parsed.city ?? "",
    };
  } catch {
    return EMPTY_LOCATION;
  }
}

/** Save (or clear) the location filter. An all-empty filter removes the key. */
export function saveNewsLocation(loc: NewsLocation): void {
  try {
    if (!loc.country && !loc.state && !loc.city) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    }
  } catch {
    // Storage unavailable: the filter still works for this session.
  }
}

/** "Austin, Texas, United States" style label, or "" when no filter. */
export function locationLabel(loc: NewsLocation): string {
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
}

// ------------------------------------------------------------------
// ISO-3 country codes ReliefWeb can filter by (ported from the old
// page). Countries not listed here just get global ReliefWeb results.
// ------------------------------------------------------------------
export const COUNTRY_ISO3: Record<string, string> = {
  "United States": "USA",
  "United Kingdom": "GBR",
  Canada: "CAN",
  Australia: "AUS",
  India: "IND",
  Brazil: "BRA",
  Germany: "DEU",
  France: "FRA",
  Japan: "JPN",
  China: "CHN",
  Mexico: "MEX",
  Nigeria: "NGA",
  Kenya: "KEN",
  "South Africa": "ZAF",
  Philippines: "PHL",
  Indonesia: "IDN",
  Pakistan: "PAK",
  Bangladesh: "BGD",
  Ethiopia: "ETH",
  Egypt: "EGY",
  Tanzania: "TZA",
  Uganda: "UGA",
  Ghana: "GHA",
  Mozambique: "MOZ",
  Zimbabwe: "ZWE",
  Zambia: "ZMB",
};

// The full country dropdown list, ported from the old page's <select>.
export const COUNTRY_LIST: string[] = [
  "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bangladesh", "Belarus", "Belgium",
  "Belize", "Benin", "Bolivia", "Bosnia", "Botswana", "Brazil", "Bulgaria",
  "Burkina Faso", "Cambodia", "Cameroon", "Canada", "Chad", "Chile", "China",
  "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba", "Czech Republic",
  "Denmark", "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Ethiopia", "Finland", "France", "Germany", "Ghana", "Greece", "Guatemala",
  "Haiti", "Honduras", "Hungary", "India", "Indonesia", "Iran", "Iraq",
  "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
  "Kenya", "Kuwait", "Laos", "Lebanon", "Liberia", "Libya", "Madagascar",
  "Malawi", "Malaysia", "Mali", "Mexico", "Moldova", "Morocco", "Mozambique",
  "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
  "Nigeria", "Norway", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Romania", "Russia", "Rwanda", "Saudi Arabia",
  "Senegal", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Spain",
  "Sri Lanka", "Sudan", "Sweden", "Switzerland", "Syria", "Tanzania",
  "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela",
  "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

// ------------------------------------------------------------------
// The one shape both sources normalize into. Every item MUST carry a
// real source link (same "no claim without citation" rule as the old
// page): items without one are dropped during parsing.
// ------------------------------------------------------------------
export interface NewsItem {
  id: string; // stable key for React lists
  title: string;
  link: string; // direct URL to the original story or event page
  summary: string; // short plain-text blurb (may be "")
  timeMs: number; // when it happened / was published, in epoch ms
  source: "ReliefWeb" | "USGS";
}

/** "5m ago" / "2h ago" / "3d ago" style label from an epoch-ms time. */
export function relativeTime(timeMs: number): string {
  const diffSec = (Date.now() - timeMs) / 1000;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(timeMs).toLocaleDateString();
}

// Strip HTML tags from ReliefWeb report bodies (they arrive as markup).
// DOMParser, NOT element.innerHTML: assigning third-party HTML to a real
// element (even a detached one) still loads images and can run onerror
// handlers, which is an XSS door. DOMParser parses inertly: nothing loads,
// nothing executes.
function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Feed items become <a href> links, so only plain web URLs are allowed
// through ("javascript:" and friends never get to be a citation).
function isSafeLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Small helper: fetch a URL with a timeout and parse JSON, throwing a
// readable Error on any failure so the UI can show a human message.
async function fetchJson<T>(url: string, sourceName: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error(`${sourceName} did not respond`);
  }
  if (!res.ok) throw new Error(`${sourceName} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------
// Source 1: ReliefWeb disaster and relief reports
// ------------------------------------------------------------------

// Only the fields we ask the API to include (fields[include][]=...).
interface ReliefWebReport {
  id: string | number;
  fields: {
    title?: string;
    url?: string;
    body?: string;
    date?: { created?: string }; // ISO timestamp string
  };
}

// The disaster types we care about, same as the old page:
// FL = flood, TC = tropical cyclone, EQ = earthquake.
const RELIEFWEB_TYPES = ["FL", "TC", "EQ"];

/**
 * Build the ReliefWeb query URL. With a known country we ask for
 * AND(country=iso3, OR(flood, cyclone, quake)); otherwise just the
 * OR of disaster types, worldwide.
 */
function buildReliefWebUrl(loc: NewsLocation): string {
  const base = "https://api.reliefweb.int/v2/reports?appname=terrameasure";
  const tail =
    "&sort[]=date:desc&limit=20" +
    "&fields[include][]=title&fields[include][]=date" +
    "&fields[include][]=url&fields[include][]=body";

  const iso3 = loc.country ? COUNTRY_ISO3[loc.country] : undefined;

  if (iso3) {
    // Nested filter: country AND (type FL OR TC OR EQ)
    let url = base + "&filter[operator]=AND";
    url += "&filter[conditions][0][field]=country.iso3";
    url += `&filter[conditions][0][value][]=${iso3}`;
    url += "&filter[conditions][1][operator]=OR";
    RELIEFWEB_TYPES.forEach((t, i) => {
      url += `&filter[conditions][1][conditions][${i}][field]=disaster_type.id`;
      url += `&filter[conditions][1][conditions][${i}][value][]=${t}`;
    });
    return url + tail;
  }

  // No (recognized) country: global results, OR of disaster types
  let url = base + "&filter[operator]=OR";
  RELIEFWEB_TYPES.forEach((t, i) => {
    url += `&filter[conditions][${i}][field]=disaster_type.id`;
    url += `&filter[conditions][${i}][value][]=${t}`;
  });
  return url + tail;
}

/** Fetch ReliefWeb disaster/relief reports, newest first. */
export async function fetchReliefWebNews(
  loc: NewsLocation,
): Promise<NewsItem[]> {
  const json = await fetchJson<{ data?: ReliefWebReport[] }>(
    buildReliefWebUrl(loc),
    "ReliefWeb",
  );
  return (json.data ?? [])
    .map((item): NewsItem | null => {
      const f = item.fields;
      if (!f.url || !isSafeLink(f.url)) return null; // no citation, no card
      return {
        id: `rw-${item.id}`,
        title: f.title ?? "Untitled report",
        link: f.url,
        summary: f.body ? stripHtml(f.body).slice(0, 260) : "",
        timeMs: f.date?.created ? Date.parse(f.date.created) : 0,
        source: "ReliefWeb",
      };
    })
    .filter((item): item is NewsItem => item !== null);
}

// ------------------------------------------------------------------
// Source 2: USGS earthquakes
// ------------------------------------------------------------------

// The slice of a USGS GeoJSON feature we actually read.
interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number; // epoch ms
    url: string | null;
    title: string | null;
    tsunami: number; // 0 or 1
  };
  geometry?: { coordinates?: number[] }; // [lon, lat, depth_km]
}

// Worldwide "significant" quakes over the past 30 days (no filter case).
const USGS_SIGNIFICANT_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson";

/**
 * Fetch earthquakes. When a location filter is set we first geocode it
 * through OUR backend's /geocode proxy (which forwards to Nominatim and
 * adds proper headers), take the bounding box, and query the USGS
 * FDSNWS event API for M2.5+ quakes inside it. If geocoding fails or
 * finds nothing, we quietly fall back to the global significant feed.
 */
export async function fetchEarthquakeNews(
  loc: NewsLocation,
): Promise<NewsItem[]> {
  let url = USGS_SIGNIFICANT_URL;

  const query = [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
  if (query) {
    try {
      const results = await geocode(query);
      const bbox = results[0]?.boundingbox; // [minlat, maxlat, minlon, maxlon]
      if (bbox) {
        url =
          "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
          `&minlatitude=${bbox[0]}&maxlatitude=${bbox[1]}` +
          `&minlongitude=${bbox[2]}&maxlongitude=${bbox[3]}` +
          "&minmagnitude=2.5&limit=20&orderby=time";
      }
    } catch {
      // Geocoding hiccup: fall back to the global feed silently.
    }
  }

  const json = await fetchJson<{ features?: UsgsFeature[] }>(url, "USGS");
  return (json.features ?? [])
    .slice(0, 20)
    .map((f): NewsItem | null => {
      const p = f.properties;
      if (!p.url || !isSafeLink(p.url)) return null; // no citation, no card
      const depth = f.geometry?.coordinates?.[2];
      const bits = [
        p.place ?? "",
        depth != null ? `Depth ${depth} km` : "",
        p.tsunami ? "Tsunami alert: YES" : "",
      ].filter(Boolean);
      return {
        id: `eq-${f.id}`,
        title: p.title ?? `M${p.mag ?? "?"} earthquake`,
        link: p.url,
        summary: bits.join(". "),
        timeMs: p.time,
        source: "USGS",
      };
    })
    .filter((item): item is NewsItem => item !== null);
}
