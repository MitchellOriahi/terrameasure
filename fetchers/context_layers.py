"""
fetchers/context_layers.py
==========================
"Context" layers: what is ON and AROUND the land, not just its shape.

Why this file exists:
  Our elevation pipeline only sees ground heights. Open water is perfectly
  flat, so a lake scored as "100% buildable, excellent site". Embarrassing.
  The fix is to ask the government databases that actually KNOW where water,
  wetlands, and flood zones are, and feed those answers into the score.

Where the answers come from (all free, no API key):
  - Wetlands:    USFWS National Wetlands Inventory (NWI)
  - Water:       USGS 3D Hydrography Program (3DHP) waterbody polygons
  - Flood zones: FEMA National Flood Hazard Layer (NFHL)

All three are published as "ArcGIS REST" services. That is a standard web API
for geographic data: you POST a shape (our survey polygon) to a `/query` URL
and it returns every feature (wetland, lake, flood zone, ...) that touches
your shape, as JSON. One shared helper, `arcgis_query`, does that POST; the
three `check_*` functions just point it at different servers and tidy up the
answers.

The honesty rule applies here too: if a government server is down, we return
status "unavailable" with the reason. We NEVER silently pretend the land is
clear just because we could not check.

Every function takes the polygon as a list of [lat, lon] pairs, the same
order the rest of the project uses.
"""

from __future__ import annotations

import json
import math

import requests
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.ops import unary_union

# How many meters one degree of latitude covers (roughly constant worldwide).
M_PER_DEG_LAT = 111_320.0

# Short timeout: these are extra context checks, not the main survey.
# Better to say "unavailable" quickly than hang the whole response.
DEFAULT_TIMEOUT = 15

# ---------------------------------------------------------------------------
# The three federal endpoints. Each one is the `/query` URL of a specific
# layer inside a bigger map service.
# ---------------------------------------------------------------------------

# USFWS National Wetlands Inventory, layer 0 = the wetland polygons.
# Note: this server prefixes every field name with "Wetlands." (verified by
# querying the layer metadata). Asking for plain "WETLAND_TYPE" silently
# returns nothing, which is exactly the kind of quiet failure we must avoid.
WETLANDS_URL = (
    "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/"
    "Wetlands/MapServer/0/query"
)

# USGS 3DHP, layer 60 = "Waterbody" polygons (lakes, ponds, reservoirs,
# and the Great Lakes). Layer id verified by listing the service root.
WATER_URL = (
    "https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/"
    "FeatureServer/60/query"
)

# FEMA National Flood Hazard Layer, layer 28 = "Flood Hazard Zones".
FLOOD_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
)

# ---------------------------------------------------------------------------
# Data vintage notes, one per source.
#
# Why static text: the fields we query from these services do not include a
# per-feature effective/collection date, and inventing one would be worse
# than saying nothing. So each check ships an honest GENERAL statement of
# how current that dataset tends to be. If a service ever starts returning
# a real date, prefer that over these.
# ---------------------------------------------------------------------------
NWI_DATA_VINTAGE = (
    "NWI mapping vintage varies by county; much of it is based on imagery "
    "from the 1980s-2010s. Wetland boundaries on the ground may have "
    "changed since mapping.")
WATER_DATA_VINTAGE = (
    "3DHP hydrography is compiled from elevation-derived sources of "
    "varying dates; currency varies by watershed.")
FLOOD_DATA_VINTAGE = (
    "NFHL effective dates vary by FIRM panel; this layer does not report "
    "a per-panel effective date. Check the local FIRM panel for its date.")


# ---------------------------------------------------------------------------
# The shared helper: one function that knows how to talk ArcGIS REST.
# ---------------------------------------------------------------------------
def arcgis_query(url: str,
                 polygon_latlon: list | None = None,
                 out_fields: str = "*",
                 return_geometry: bool = True,
                 where: str | None = None,
                 timeout: int = DEFAULT_TIMEOUT) -> dict:
    """
    POST a query to an ArcGIS REST `/query` endpoint and return the features.

    Parameters:
      url             the layer's /query URL
      polygon_latlon  our survey area as [[lat, lon], ...]; if given, we ask
                      the server for every feature that INTERSECTS it
      out_fields      which attribute columns to return ("*" = all)
      return_geometry whether to ask for the feature shapes too (needed when
                      we want to compute how MUCH of our site is covered)
      where           optional SQL-ish filter instead of / alongside geometry

    Returns a dict that is safe to inspect without try/except:
      {"ok": True,  "features": [...]}                on success
      {"ok": False, "features": [], "error": "..."}   on any failure

    "features" entries look like {"attributes": {...}, "geometry": {...}}.
    Geometry (when requested) comes back in lat/lon (we ask for outSR=4326),
    as {"rings": [[[lon, lat], ...], ...]} for polygons.
    """
    params: dict = {
        "outFields": out_fields,
        "returnGeometry": "true" if return_geometry else "false",
        "outSR": 4326,          # answer in plain lat/lon, please
        "f": "json",            # esri-flavored JSON (most compatible format)
    }
    if where:
        params["where"] = where
    if polygon_latlon is not None:
        # ArcGIS wants polygon "rings" as [[lon, lat], ...] with the first
        # point repeated at the end to close the loop. Note the flip: our
        # project passes [lat, lon], esri wants [x, y] = [lon, lat].
        ring = [[lon, lat] for lat, lon in polygon_latlon]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        params.update({
            "geometry": json.dumps({"rings": [ring],
                                    "spatialReference": {"wkid": 4326}}),
            "geometryType": "esriGeometryPolygon",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
        })

    try:
        resp = requests.post(url, data=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        # Network down, server down, bad JSON: all end up here.
        return {"ok": False, "features": [], "error": f"{type(e).__name__}: {e}"}

    # ArcGIS reports its own errors INSIDE a 200 response, so check for that.
    if isinstance(data, dict) and "error" in data:
        return {"ok": False, "features": [],
                "error": f"server error: {data['error']}"}

    return {"ok": True, "features": data.get("features", [])}


# ---------------------------------------------------------------------------
# Geometry helpers: turn shapes into "what fraction of my site is covered?"
# ---------------------------------------------------------------------------
def _polygon_to_local_meters(polygon_latlon: list) -> ShapelyPolygon:
    """
    Convert a [lat, lon] polygon into a shapely polygon measured in METERS.

    Why: shapely does not know about the round Earth. If we hand it raw
    degrees, areas come out in "square degrees", which are meaningless.
    So we flatten a small patch of Earth onto a local flat grid:
    1 degree of latitude is ~111,320 m; 1 degree of longitude shrinks by
    cos(latitude). Over a survey-sized area this is accurate to well under 1%.
    """
    ref_lat = sum(p[0] for p in polygon_latlon) / len(polygon_latlon)
    ref_lon = sum(p[1] for p in polygon_latlon) / len(polygon_latlon)
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(ref_lat))
    pts = [((lon - ref_lon) * m_per_deg_lon, (lat - ref_lat) * M_PER_DEG_LAT)
           for lat, lon in polygon_latlon]
    poly = ShapelyPolygon(pts)
    # buffer(0) is the standard shapely trick to repair self-intersections.
    return poly if poly.is_valid else poly.buffer(0)


def _esri_rings_to_local_meters(geometry: dict,
                                ref_lat: float, ref_lon: float):
    """
    Convert one esri geometry ({"rings": [...]}, in lon/lat) into a shapely
    shape in the SAME local meter grid as _polygon_to_local_meters, so the
    two can be intersected. Returns None if the geometry is unusable.
    """
    rings = (geometry or {}).get("rings") or []
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(ref_lat))
    parts = []
    for ring in rings:
        if len(ring) < 3:
            continue
        pts = [((lon - ref_lon) * m_per_deg_lon,
                (lat - ref_lat) * M_PER_DEG_LAT) for lon, lat in ring]
        p = ShapelyPolygon(pts)
        if not p.is_valid:
            p = p.buffer(0)
        if not p.is_empty:
            parts.append(p)
    if not parts:
        return None
    # Union the rings. Esri "rings" can include holes; unioning the filled
    # rings slightly OVERSTATES coverage, which for a hazard check is the
    # safe direction to err (we would rather over-warn than under-warn).
    return unary_union(parts)


def coverage_fraction(polygon_latlon: list, features: list) -> float | None:
    """
    What fraction (0.0 to 1.0) of our site polygon is covered by the given
    features? This is the number the score cares about: "the site touches a
    lake" matters far less than "the site is 90% lake".

    Returns None if no feature had usable geometry (coverage unknown).
    """
    site = _polygon_to_local_meters(polygon_latlon)
    if site.is_empty or site.area == 0:
        return None
    ref_lat = sum(p[0] for p in polygon_latlon) / len(polygon_latlon)
    ref_lon = sum(p[1] for p in polygon_latlon) / len(polygon_latlon)

    shapes = []
    for f in features:
        shape = _esri_rings_to_local_meters(f.get("geometry"), ref_lat, ref_lon)
        if shape is not None and not shape.is_empty:
            shapes.append(shape)
    if not shapes:
        return None

    covered = unary_union(shapes).intersection(site)
    frac = covered.area / site.area
    return max(0.0, min(1.0, frac))


# ---------------------------------------------------------------------------
# The three public checks. Each returns a plain dict with a "status" key:
#   "ok"          -> we asked, and this is the answer (possibly "all clear")
#   "unavailable" -> we could NOT ask; treat as unknown, never as clear
# ---------------------------------------------------------------------------

# NWI wetland types that are open water rather than vegetated wetland.
# "Lake" is literally how NWI labels the Great Lakes and large lakes.
OPEN_WATER_WETLAND_TYPES = {
    "Lake",
    "Estuarine and Marine Deepwater",
    "Freshwater Pond",
    "Riverine",
}


def check_wetlands(polygon_latlon: list) -> dict:
    """
    Ask the USFWS National Wetlands Inventory what wetlands touch our site.

    Returns:
      {
        "status": "ok" | "unavailable",
        "wetland_types": ["Freshwater Forested/Shrub Wetland", ...],
        "features": [{"type": ..., "code": ..., "acres": ...}, ...],
        "coverage_fraction": 0.0-1.0 or None,   # how much of the site
        "open_water_fraction": 0.0-1.0 or None, # subset that is open water
        "source": ..., "note": ...
      }
    """
    result = arcgis_query(
        WETLANDS_URL,
        polygon_latlon,
        # Field names on this server are prefixed with "Wetlands." (verified).
        out_fields="Wetlands.WETLAND_TYPE,Wetlands.ATTRIBUTE,Wetlands.ACRES",
        return_geometry=True,
    )
    if not result["ok"]:
        return {
            "status": "unavailable",
            "wetland_types": [], "features": [],
            "coverage_fraction": None, "open_water_fraction": None,
            "source": "USFWS National Wetlands Inventory",
            "data_vintage": NWI_DATA_VINTAGE,
            "note": f"Could not check wetlands: {result['error']}. "
                    "Treat as unknown, not as clear.",
        }

    feats = result["features"]
    cleaned = []
    for f in feats:
        a = f.get("attributes", {})
        cleaned.append({
            "type": a.get("Wetlands.WETLAND_TYPE"),
            "code": a.get("Wetlands.ATTRIBUTE"),
            "acres": a.get("Wetlands.ACRES"),
        })
    types = sorted({c["type"] for c in cleaned if c["type"]})

    frac = coverage_fraction(polygon_latlon, feats) if feats else 0.0
    # Split out the open-water portion (a lake is not a marsh; the score
    # treats them differently).
    water_feats = [f for f in feats
                   if f.get("attributes", {}).get("Wetlands.WETLAND_TYPE")
                   in OPEN_WATER_WETLAND_TYPES]
    water_frac = (coverage_fraction(polygon_latlon, water_feats)
                  if water_feats else 0.0)

    return {
        "status": "ok",
        "wetland_types": types,
        "features": cleaned,
        "coverage_fraction": frac,
        "open_water_fraction": water_frac,
        "source": "USFWS National Wetlands Inventory",
        "data_vintage": NWI_DATA_VINTAGE,
        "note": (f"{len(cleaned)} wetland polygon(s) intersect the site"
                 if cleaned else "No mapped wetlands intersect the site"),
    }


def check_water(polygon_latlon: list) -> dict:
    """
    Ask USGS 3DHP which mapped waterbodies (lakes, ponds, Great Lakes,
    reservoirs) touch our site.

    Returns:
      {
        "status": "ok" | "unavailable",
        "waterbodies": [{"name": ..., "feature_type": ..., "area_sqkm": ...}],
        "coverage_fraction": 0.0-1.0 or None,
        "source": ..., "note": ...
      }
    """
    result = arcgis_query(
        WATER_URL,
        polygon_latlon,
        out_fields="gnisidlabel,featuretypelabel,areasqkm",
        return_geometry=True,
    )
    if not result["ok"]:
        return {
            "status": "unavailable",
            "waterbodies": [], "coverage_fraction": None,
            "source": "USGS 3D Hydrography Program (waterbodies)",
            "data_vintage": WATER_DATA_VINTAGE,
            "note": f"Could not check waterbodies: {result['error']}. "
                    "Treat as unknown, not as clear.",
        }

    feats = result["features"]
    bodies = []
    for f in feats:
        a = f.get("attributes", {})
        bodies.append({
            "name": a.get("gnisidlabel"),
            "feature_type": a.get("featuretypelabel"),
            "area_sqkm": a.get("areasqkm"),
        })

    frac = coverage_fraction(polygon_latlon, feats) if feats else 0.0

    return {
        "status": "ok",
        "waterbodies": bodies,
        "coverage_fraction": frac,
        "source": "USGS 3D Hydrography Program (waterbodies)",
        "data_vintage": WATER_DATA_VINTAGE,
        "note": (f"{len(bodies)} waterbody(ies) intersect the site"
                 if bodies else "No mapped waterbodies intersect the site"),
    }


# FEMA zone letters that mean "high risk" (the 1%-annual-chance floodplain,
# also called the Special Flood Hazard Area, SFHA). Lenders require flood
# insurance inside these. V zones add wave action on top.
HIGH_RISK_FLOOD_ZONES = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE"}


def check_flood(polygon_latlon: list) -> dict:
    """
    Ask FEMA's National Flood Hazard Layer which flood zones cover our site.

    Zone cheat sheet:
      A / AE / AH / AO  high risk (1% chance of flooding in any given year)
      V / VE            high risk coastal, with wave action
      X                 lower risk ("0.2 PCT" subtype = moderate, else minimal)

    Returns:
      {
        "status": "ok" | "unavailable",
        "zones": [{"zone": "AE", "subtype": ..., "high_risk": True}, ...],
        "in_high_risk_zone": bool,
        "high_risk_fraction": 0.0-1.0 or None,
        "source": ..., "note": ...
      }
    """
    result = arcgis_query(
        FLOOD_URL,
        polygon_latlon,
        out_fields="FLD_ZONE,ZONE_SUBTY,SFHA_TF",
        return_geometry=True,
    )
    if not result["ok"]:
        return {
            "status": "unavailable",
            "zones": [], "in_high_risk_zone": None, "high_risk_fraction": None,
            "source": "FEMA National Flood Hazard Layer",
            "data_vintage": FLOOD_DATA_VINTAGE,
            "note": f"Could not check flood zones: {result['error']}. "
                    "Treat as unknown, not as clear.",
        }

    feats = result["features"]
    zones = []
    seen = set()
    for f in feats:
        a = f.get("attributes", {})
        zone = a.get("FLD_ZONE")
        # Normalize the subtype before deduping: FEMA panels sometimes
        # return "" and sometimes null for "no subtype", and without this
        # the same zone showed up twice ("X, AE (high risk), X, AE ...").
        subtype = a.get("ZONE_SUBTY") or None
        if isinstance(subtype, str):
            subtype = subtype.strip() or None
        # SFHA_TF is FEMA's own "is this the high-risk floodplain?" flag.
        high = (a.get("SFHA_TF") == "T") or (zone in HIGH_RISK_FLOOD_ZONES)
        key = (zone, subtype)
        if key not in seen:
            seen.add(key)
            zones.append({"zone": zone, "subtype": subtype, "high_risk": high})

    # High-risk zones first (they are the ones a buyer must see), then
    # alphabetically so the order is stable between runs.
    zones.sort(key=lambda z: (not z["high_risk"], z["zone"] or "",
                              z["subtype"] or ""))

    high_feats = [f for f in feats
                  if f.get("attributes", {}).get("SFHA_TF") == "T"
                  or f.get("attributes", {}).get("FLD_ZONE")
                  in HIGH_RISK_FLOOD_ZONES]
    in_high = len(high_feats) > 0
    high_frac = (coverage_fraction(polygon_latlon, high_feats)
                 if high_feats else 0.0)

    return {
        "status": "ok",
        "zones": zones,
        "in_high_risk_zone": in_high,
        "high_risk_fraction": high_frac,
        "source": "FEMA National Flood Hazard Layer",
        "data_vintage": FLOOD_DATA_VINTAGE,
        "note": (f"Site intersects flood zone(s): "
                 + ", ".join(sorted({z['zone'] for z in zones if z['zone']}))
                 if zones else "No mapped flood zones intersect the site "
                               "(note: some areas are simply unmapped)"),
    }


def water_fraction(polygon_latlon: list,
                   water_result: dict | None = None,
                   wetlands_result: dict | None = None) -> dict:
    """
    Best single estimate of "what fraction of this site is open water?".

    We have two independent witnesses:
      - USGS 3DHP waterbody polygons (best for lakes and reservoirs)
      - NWI open-water wetland types (also covers ponds, estuaries, ocean)
    We take the LARGER of the two. If one source is down, we use the other.
    If both are down, the honest answer is "unknown".

    You can pass in results you already fetched (so we do not hit the network
    twice); otherwise this function fetches them itself.
    """
    if water_result is None:
        water_result = check_water(polygon_latlon)
    if wetlands_result is None:
        wetlands_result = check_wetlands(polygon_latlon)

    candidates = []
    if water_result["status"] == "ok" and \
            water_result["coverage_fraction"] is not None:
        candidates.append(water_result["coverage_fraction"])
    if wetlands_result["status"] == "ok" and \
            wetlands_result.get("open_water_fraction") is not None:
        candidates.append(wetlands_result["open_water_fraction"])

    if not candidates:
        return {
            "status": "unavailable",
            "fraction": None,
            "note": "Both water sources unavailable; open-water coverage "
                    "unknown. Treat as unknown, not as zero.",
        }
    return {
        "status": "ok",
        "fraction": max(candidates),
        "note": "Larger of USGS 3DHP and NWI open-water coverage estimates.",
    }


def check_context(polygon_latlon: list) -> dict:
    """
    One-stop shop the API uses: run all three checks and bundle the results.

    The bundle shape:
      {
        "wetlands": {...},   # see check_wetlands
        "water":    {...},   # see check_water
        "flood":    {...},   # see check_flood
        "open_water_fraction": float or None,
        "note": short human summary
      }
    """
    wetlands = check_wetlands(polygon_latlon)
    water = check_water(polygon_latlon)
    flood = check_flood(polygon_latlon)
    wf = water_fraction(polygon_latlon, water_result=water,
                        wetlands_result=wetlands)

    unavailable = [name for name, r in
                   [("wetlands", wetlands), ("water", water), ("flood", flood)]
                   if r["status"] != "ok"]
    if unavailable:
        note = ("Some context sources were unavailable: "
                + ", ".join(unavailable)
                + ". Their findings are unknown, not clear.")
    else:
        note = "All context sources responded."

    return {
        "wetlands": wetlands,
        "water": water,
        "flood": flood,
        "open_water_fraction": wf["fraction"],
        "note": note,
    }


# ===========================================================================
# Quick live self-test against four real places with known answers.
# Run:  python fetchers/context_layers.py     (needs internet)
# ===========================================================================
if __name__ == "__main__":
    def square_around(lat, lon, half_m=250):
        dlat = half_m / M_PER_DEG_LAT
        dlon = half_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
        return [[lat - dlat, lon - dlon], [lat - dlat, lon + dlon],
                [lat + dlat, lon + dlon], [lat + dlat, lon - dlon]]

    spots = {
        "Lake Michigan (should be ~100% water)": (43.5, -87.2),
        "Everglades FL (should show wetlands)": (25.9, -80.85),
        "Houston TX floodplain (should show zone AE)": (29.78, -95.68),
        "Dry Colorado plains (should be mostly clear)": (39.05, -104.4),
    }
    for name, (lat, lon) in spots.items():
        print("=" * 64)
        print(name)
        ctx = check_context(square_around(lat, lon))
        w = ctx["wetlands"]; h = ctx["water"]; fl = ctx["flood"]
        print(f"  wetlands [{w['status']}]: {w['wetland_types']} "
              f"coverage={w['coverage_fraction']}")
        print(f"  water    [{h['status']}]: "
              f"{[b['name'] for b in h['waterbodies']]} "
              f"coverage={h['coverage_fraction']}")
        print(f"  flood    [{fl['status']}]: "
              f"{[z['zone'] for z in fl['zones']]} "
              f"high_risk_fraction={fl['high_risk_fraction']}")
        print(f"  open_water_fraction: {ctx['open_water_fraction']}")
