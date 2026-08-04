"""
api/server.py: TerraMeasure v0.4
===================================
Services:
  GET  /survey             : TerraScan: map-click → elevation → measurements
  POST /survey/polygon     : TerraScan: drawn polygon → masked elevation → measurements
  POST /photo-survey       : TerraPhoto: uploaded photos → GPS → measurements
  GET  /parcel             : County parcel lookup (owner, APN, acreage, ...)
  POST /context            : Wetlands / water / flood checks for a polygon
  GET  /geocode            : Address / place-name search proxy (Nominatim)
  GET  /health             : Liveness check

New in v0.4 (the "water-aware" release):
  • context          : wetlands, waterbodies, and FEMA flood zones for the
                        surveyed area, from free federal ArcGIS services
  • score            : server-computed site score with GO/CAUTION/NO-GO
                        verdict and an itemized breakdown; open water now
                        craters the score instead of boosting it
  • earthwork_cost   : rough low/high grading cost range
  • dem_source_note  : when USGS fails and we fall back to Open-Elevation,
                        we now SAY SO instead of silently swallowing it
  • disclaimer       : the uncertified-survey disclaimer on every response

Every survey response now includes:
  • dem_grid + min/max height      → Three.js 3D terrain
  • satellite_texture_b64          → Satellite image draped over 3D terrain
  • buildable_area_pct             → % of site with slope < 8°
  • dominant_aspect_deg            → Which direction the land faces
  • elevation_profile              → Diagonal cross-section for profile chart
  • slope + contour map PNGs

Run:
    venv\\Scripts\\python.exe -m uvicorn api.server:app --reload --port 8000
"""

import base64
import math
import os
from typing import Optional, List

import numpy as np
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import requests as http_requests

from fetchers.dem_source import OpenElevationFetcher
from fetchers.photo_fetcher import PhotoFetcher
from fetchers import context_layers
from fetchers.parcel_fetcher import get_parcel as fetch_parcel
from engine import measurements as M
from engine import scoring
# Shareable report endpoints live in their own module (api/reports.py)
# and plug in below via an APIRouter, FastAPI's way of splitting an app
# across files without changing how anything is served.
from api.reports import router as reports_router


# ---------------------------------------------------------------------------
app = FastAPI(title="TerraMeasure API", version="0.4.0")

# POST /reports and GET /reports/{slug}: turn a survey into a share link.
app.include_router(reports_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Gzip: survey responses carry a DEM grid plus several base64 PNGs, easily
# a few megabytes of very compressible JSON. Gzip typically shrinks it 5-10x,
# which matters a lot on hotel wifi at a job site.
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------
class MeasurementOut(BaseModel):
    value: float
    unit: str
    error: float
    note: str


class SurveyResponse(BaseModel):
    source: str
    vertical_error_m: float
    grid_shape: list[int]
    cell_size_m: float
    min_height: float
    max_height: float
    dem_grid: list[list[float]]
    avg_slope: MeasurementOut
    cut_volume: MeasurementOut
    fill_volume: MeasurementOut
    elevation_profile: list[list[float]]
    buildable_area_pct: float
    dominant_aspect_deg: float
    slope_map_png_b64: str
    contour_map_png_b64: str
    # Clean versions: no axes/colorbar/labels, transparent background.
    # The map overlay uses these so the image aligns exactly with the drawn area.
    slope_map_clean_b64: str = ""
    contour_map_clean_b64: str = ""
    # Real satellite image of the survey area, draped over the 3D terrain
    # to make it look like Google Earth instead of a blurry slope map.
    satellite_texture_b64: str = ""
    # Actual DEM geographic bounds, the client uses these for pixel-perfect
    # overlay alignment (slope map, contour map etc. must be placed exactly here).
    dem_center_lat: float = 0.0
    dem_center_lon: float = 0.0
    dem_width_m: float = 0.0
    dem_height_m: float = 0.0
    # Average ground height, used by the frontend agriculture panel to
    # estimate irrigation potential (flat, low-lying land irrigates easiest).
    avg_height: float = 0.0
    # Extra fields for photo surveys
    photo_count: Optional[int] = None
    gps_found: Optional[bool] = None
    location_note: Optional[str] = None
    # --- New in v0.4 (all optional, so the old frontend keeps working) ---
    # Wetlands / water / flood findings from the federal context layers.
    # If a source was unreachable its entry says status "unavailable":
    # we report "we could not check", never a silent all-clear.
    context: Optional[dict] = None
    # Server-computed site score: value, verdict (go/caution/no-go), label,
    # water-adjusted buildable %, and an itemized breakdown. Together with
    # the measurements above, the response is a self-contained snapshot a
    # client can store to compare predictions against reality later.
    score: Optional[dict] = None
    # Rough low/high grading cost range (the "cost-to-develop" layer).
    earthwork_cost: Optional[dict] = None
    # When the high-accuracy USGS source fails and we fall back to
    # Open-Elevation, this says why. Empty string = no fallback happened.
    dem_source_note: str = ""
    # Always present. The UI displays it everywhere.
    disclaimer: str = scoring.DISCLAIMER


class VertexIn(BaseModel):
    """One polygon corner. Typed so a malformed vertex ({"lat": "x"} or a
    missing key) is a clean 422 from FastAPI instead of a KeyError 500."""
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class PolygonSurveyRequest(BaseModel):
    vertices: list[VertexIn]
    # Same bounds as GET /survey: without them a tiny resolution over a big
    # polygon would ask for a multi-million-cell grid.
    resolution_m: float = Field(10.0, ge=1, le=100)


class ContextRequest(BaseModel):
    vertices: list[VertexIn]


# GET /survey caps each side at 5 km; the polygon route must enforce the
# same ceiling or a continent-sized drawn shape becomes a giant DEM fetch.
# 5750 = the 5 km cap plus the same 15% padding the polygon route applies.
MAX_POLYGON_SPAN_M = 5750.0
# And a floor: a sliver-thin polygon would produce a 0-cell DEM grid and
# crash downstream, so pad tiny shapes up to a few DEM cells across.
MIN_POLYGON_SPAN_M = 30.0


# ---------------------------------------------------------------------------
# Satellite texture helper
# ---------------------------------------------------------------------------
def _fetch_satellite_texture(center_lat: float, center_lon: float,
                              width_m: float, height_m: float,
                              px: int = 2048) -> str:
    """
    Fetch a satellite image from the Esri World Imagery service for the given
    geographic bounding box and return it as a base64-encoded JPEG string.

    This image is draped over the Three.js terrain mesh so the 3D view shows
    real aerial photography rather than a blurry slope-colour approximation.

    Esri World Imagery is publicly accessible, no API key required.
    """
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(center_lat))

    half_h = (height_m / 2) / m_per_deg_lat
    half_w = (width_m  / 2) / m_per_deg_lon

    min_lon = center_lon - half_w
    max_lon = center_lon + half_w
    min_lat = center_lat - half_h
    max_lat = center_lat + half_h

    url = (
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/"
        f"MapServer/export?bbox={min_lon},{min_lat},{max_lon},{max_lat}"
        f"&bboxSR=4326&imageSR=4326&size={px},{px}&format=jpg&f=image"
    )
    try:
        resp = http_requests.get(url, timeout=20)
        if resp.status_code == 200 and resp.content:
            return base64.b64encode(resp.content).decode("utf-8")
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# DEM fetch with an HONEST fallback
# ---------------------------------------------------------------------------
def _fetch_dem(lat: float, lon: float, width_m: float, height_m: float,
               resolution_m: float):
    """
    Try USGS 3DEP first (best accuracy, US only). If that fails, fall back
    to Open-Elevation, and RECORD WHY in a note that goes into the response.

    The old code swallowed the USGS error silently, which is how ocean
    locations quietly ended up on a source that reports water as flat land.
    Returns (dem_result, dem_source_note).
    """
    try:
        from fetchers.usgs_fetcher import USGS3DEPFetcher
        dem_result = USGS3DEPFetcher().get_dem(lat, lon, width_m, height_m,
                                               resolution_m)
        return dem_result, ""
    except Exception as e:
        note = (f"USGS 3DEP unavailable for this location "
                f"({type(e).__name__}: {e}). Fell back to Open-Elevation "
                "(lower accuracy, ~5 m vertical error).")
    dem_result = OpenElevationFetcher().get_dem(lat, lon, width_m, height_m,
                                                resolution_m)
    return dem_result, note


def _rect_polygon(lat: float, lon: float,
                  width_m: float, height_m: float) -> list:
    """The survey rectangle's corners as [[lat, lon], ...] for context checks."""
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    dlat = (height_m / 2) / m_per_deg_lat
    dlon = (width_m / 2) / m_per_deg_lon
    return [[lat - dlat, lon - dlon], [lat - dlat, lon + dlon],
            [lat + dlat, lon + dlon], [lat + dlat, lon - dlon]]


def _fetch_context(polygon_latlon: list) -> Optional[dict]:
    """
    Run the wetlands/water/flood checks, never letting them break the survey.
    check_context already degrades gracefully per source; this catches
    anything truly unexpected (a bug, not a network blip).
    """
    try:
        return context_layers.check_context(polygon_latlon)
    except Exception as e:
        return {
            "wetlands": {"status": "unavailable"},
            "water": {"status": "unavailable"},
            "flood": {"status": "unavailable"},
            "open_water_fraction": None,
            "note": f"Context checks failed unexpectedly "
                    f"({type(e).__name__}: {e}). Findings unknown, not clear.",
        }


# ---------------------------------------------------------------------------
# Shared survey logic
# ---------------------------------------------------------------------------
def run_survey(dem_result, context: Optional[dict] = None,
               dem_source_note: str = "") -> SurveyResponse:
    dem = dem_result.heights

    # Replace NaN with mean for functions that don't support NaN
    dem_clean = np.where(np.isnan(dem), float(np.nanmean(dem)) if np.any(~np.isnan(dem)) else 0, dem)

    avg   = M.average_slope(dem, dem_result.cell_size,
                            vertical_error=dem_result.vertical_error)
    target = float(np.nanmean(dem))
    vols  = M.volume_to_grade(dem, dem_result.cell_size,
                              target_height=target,
                              vertical_error=dem_result.vertical_error)

    rows, cols = dem_clean.shape
    profile_raw = M.elevation_profile(
        dem_clean, dem_result.cell_size,
        start_rc=(0, 0), end_rc=(rows - 1, cols - 1),
        samples=min(100, rows * cols),
    )
    elevation_profile = [[round(d, 1), round(h, 1)] for d, h in profile_raw]

    build_pct  = M.buildable_area_pct(dem, dem_result.cell_size)
    aspect_deg = M.dominant_aspect(dem, dem_result.cell_size)

    # Images use the clean DEM (NaN filled) so matplotlib doesn't crash
    images = M.render_images(dem_clean, dem_result.cell_size)

    # Satellite texture, real aerial photography of the area
    sat_b64 = ""
    if dem_result.center_lat != 0.0:
        sat_b64 = _fetch_satellite_texture(
            dem_result.center_lat, dem_result.center_lon,
            dem_result.width_m or dem_result.cell_size * cols,
            dem_result.height_m or dem_result.cell_size * rows,
        )

    def to_b64(b): return base64.b64encode(b).decode("utf-8")
    def mout(m):   return MeasurementOut(value=m.value, unit=m.unit,
                                         error=m.error, note=m.note)

    # Return the DEM with NaN replaced by the mean so JSON serialises cleanly
    dem_for_json = dem_clean.tolist()

    # Server-side score: the terrain numbers plus whatever the context
    # layers found. If context is None the score honestly says it is
    # terrain-only. This is the water-aware fix: a lake can no longer
    # score "excellent" just for being flat.
    score = scoring.site_score(
        dem_result,
        measurements={"avg_slope_deg": avg.value,
                      "buildable_area_pct": build_pct},
        context=context,
    )

    # Rough grading cost range (the "cost-to-develop" layer).
    cost = scoring.earthwork_cost(vols["cut"].value, vols["fill"].value)

    return SurveyResponse(
        context=context,
        score=score,
        earthwork_cost=cost,
        dem_source_note=dem_source_note,
        source=dem_result.source,
        vertical_error_m=dem_result.vertical_error,
        grid_shape=list(dem_clean.shape),
        cell_size_m=dem_result.cell_size,
        min_height=float(np.nanmin(dem)),
        max_height=float(np.nanmax(dem)),
        avg_height=float(np.nanmean(dem)),
        dem_grid=dem_for_json,
        avg_slope=mout(avg),
        cut_volume=mout(vols["cut"]),
        fill_volume=mout(vols["fill"]),
        elevation_profile=elevation_profile,
        buildable_area_pct=build_pct,
        dominant_aspect_deg=aspect_deg,
        slope_map_png_b64=to_b64(images["slope_map"]),
        contour_map_png_b64=to_b64(images["contour_map"]),
        slope_map_clean_b64=to_b64(images["slope_map_clean"]),
        contour_map_clean_b64=to_b64(images["contour_map_clean"]),
        satellite_texture_b64=sat_b64,
        # Geographic bounds of the DEM, the client uses these to pin image
        # overlays (slope map, contour map) exactly over the right spot on the map.
        dem_center_lat=dem_result.center_lat,
        dem_center_lon=dem_result.center_lon,
        dem_width_m=dem_result.width_m or (dem_result.cell_size * cols),
        dem_height_m=dem_result.height_m or (dem_result.cell_size * rows),
    )


# ---------------------------------------------------------------------------
# TerraScan, map-click survey (rectangle)
# ---------------------------------------------------------------------------
@app.get("/survey", response_model=SurveyResponse)
def survey(
    lat: float = Query(...),
    lon: float = Query(...),
    width_m:  float = Query(300.0, gt=10, le=5000),
    height_m: float = Query(300.0, gt=10, le=5000),
    resolution_m: float = Query(10.0, ge=1, le=100),
):
    """TerraScan free tier: fetch elevation for any lat/lon rectangle and run measurements."""
    dem_result, dem_note = _fetch_dem(lat, lon, width_m, height_m, resolution_m)

    # Ask the federal layers what is on this land (water, wetlands, flood).
    context = _fetch_context(_rect_polygon(lat, lon, width_m, height_m))

    try:
        return run_survey(dem_result, context=context, dem_source_note=dem_note)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# TerraScan, drawn polygon survey
# ---------------------------------------------------------------------------
@app.post("/survey/polygon", response_model=SurveyResponse)
def survey_polygon(req: PolygonSurveyRequest):
    """
    TerraScan polygon mode: the user draws a custom shape on the map.

    Steps:
      1. Compute bounding box from polygon vertices.
      2. Fetch DEM for that bounding box (with 15% padding so edges don't clip).
      3. Mask the DEM to the polygon, cells outside are set to NaN.
      4. Run all measurements only on cells inside the polygon.
    """
    if len(req.vertices) < 3:
        raise HTTPException(status_code=400,
                            detail="Polygon needs at least 3 vertices.")

    lats = [v.lat for v in req.vertices]
    lons = [v.lon for v in req.vertices]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(center_lat))
    width_m  = (max_lon - min_lon) * m_per_deg_lon * 1.15   # 15% padding
    height_m = (max_lat - min_lat) * m_per_deg_lat * 1.15

    # Enforce the same size ceiling as GET /survey (see MAX_POLYGON_SPAN_M).
    if width_m > MAX_POLYGON_SPAN_M or height_m > MAX_POLYGON_SPAN_M:
        raise HTTPException(
            status_code=400,
            detail=(f"Survey area too large: about "
                    f"{max(width_m, height_m) / 1000:.1f} km across. "
                    "The free tier supports areas up to about 5 km across; "
                    "draw a smaller shape."))
    # Pad sliver-thin shapes up to a few DEM cells so the grid is never empty.
    width_m = max(width_m, MIN_POLYGON_SPAN_M)
    height_m = max(height_m, MIN_POLYGON_SPAN_M)

    dem_result, dem_note = _fetch_dem(
        center_lat, center_lon, width_m, height_m, req.resolution_m)

    # Mask DEM to the drawn polygon shape
    poly_coords = [(v.lat, v.lon) for v in req.vertices]
    dem_result.heights = M.mask_dem_to_polygon(
        dem_result.heights, dem_result.cell_size,
        center_lat, center_lon, poly_coords,
    )

    # Context checks use the ACTUAL drawn polygon, not the bounding box,
    # so a shoreline parcel is judged on the shape the user drew.
    context = _fetch_context([[v.lat, v.lon] for v in req.vertices])

    try:
        return run_survey(dem_result, context=context, dem_source_note=dem_note)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# TerraPhoto, photo upload survey
# ---------------------------------------------------------------------------
@app.post("/photo-survey", response_model=SurveyResponse)
async def photo_survey(
    files: List[UploadFile] = File(...),
    resolution_m: float = Query(10.0, ge=1, le=100),
    width_m:  Optional[float] = Query(None),
    height_m: Optional[float] = Query(None),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    raw_list = [await f.read() for f in files]
    pf = PhotoFetcher()
    loc = pf.extract_location(raw_list)

    if not loc["gps_found"]:
        raise HTTPException(status_code=422,
            detail="No GPS data found. Use smartphone photos or TerraScan.")

    dem_result = pf.get_dem(
        lat=loc["lat"], lon=loc["lon"],
        width_m=width_m or loc["width_m"],
        height_m=height_m or loc["height_m"],
        resolution_m=resolution_m,
    )
    # Photo surveys have a GPS location too, so they get the same context
    # checks as a map-click survey of the same area.
    context = _fetch_context(_rect_polygon(
        loc["lat"], loc["lon"],
        width_m or loc["width_m"], height_m or loc["height_m"]))

    try:
        resp = run_survey(dem_result, context=context)
        resp.photo_count = len(files)
        resp.gps_found   = loc["gps_found"]
        resp.location_note = loc["note"]
        return resp
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Parcel lookup, "whose land is this?"
# ---------------------------------------------------------------------------
@app.get("/parcel")
def parcel(lat: float = Query(...), lon: float = Query(...)):
    """
    Look up the tax parcel at a point: id (APN/PIN/folio), owner, acreage,
    zoning, assessed value, and the boundary polygon, where the county
    publishes them. Pilot coverage is five counties; elsewhere the response
    honestly says "no_coverage" (see fetchers/parcel_fetcher.py for the
    pilot-vs-Regrid plan).
    """
    try:
        result = fetch_parcel(lat, lon)
    except Exception as e:
        # The fetcher already handles per-county failures; this catches
        # anything truly unexpected so the endpoint never 500s silently.
        raise HTTPException(status_code=502,
                            detail=f"Parcel lookup failed: {e}")
    result["disclaimer"] = scoring.DISCLAIMER
    return result


# ---------------------------------------------------------------------------
# Context checks, wetlands / water / flood for an arbitrary polygon
# ---------------------------------------------------------------------------
@app.post("/context")
def context_check(req: ContextRequest):
    """
    Run the wetlands, waterbody, and flood-zone checks for a polygon without
    doing a full survey. The frontend can use this for a fast pre-check
    before the user commits to a survey.
    """
    if len(req.vertices) < 3:
        raise HTTPException(status_code=400,
                            detail="Polygon needs at least 3 vertices.")
    polygon = [[v.lat, v.lon] for v in req.vertices]
    result = _fetch_context(polygon)
    result["disclaimer"] = scoring.DISCLAIMER
    return result


# ---------------------------------------------------------------------------
# Geocoding proxy
# ---------------------------------------------------------------------------
@app.get("/geocode")
def geocode(q: str = Query(...)):
    try:
        r = http_requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 5, "addressdetails": 1},
            headers={"User-Agent": "TerraMeasure/0.3"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Health + root redirect + static files
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "version": "0.4.0"}

# ---------------------------------------------------------------------------
# Static serving: the NEW React app (frontend/dist) is the product now.
#
# How this works, in plain terms:
#   * frontend/dist is what "npm run build" produces: one index.html plus
#     hashed asset files. It is committed to the repo so Render (a Python
#     host with no Node.js) can serve it without building it.
#   * A single-page app does its own routing in the browser, so EVERY page
#     URL (/, /news, /profile, /r/abc123...) must be answered with the same
#     index.html; React then looks at the URL and renders the right page.
#     That is what the catch-all route at the bottom does.
#   * The old vanilla app stays reachable at /web/ during the transition.
# ---------------------------------------------------------------------------

_root_dir = os.path.dirname(os.path.dirname(__file__))
_web_dir = os.path.join(_root_dir, "web")
_dist_dir = os.path.join(_root_dir, "frontend", "dist")

app.mount("/web", StaticFiles(directory=_web_dir), name="web")

if os.path.isdir(_dist_dir):
    # Hashed JS/CSS bundles live under /assets, so mount that folder directly.
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_dist_dir, "assets")),
        name="assets",
    )

    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        # Serve real files from dist when they exist (icons, manifest,
        # service worker); everything else falls back to index.html so the
        # React router can handle the URL. API routes are unaffected: they
        # are registered above, and FastAPI matches them first.
        candidate = os.path.normpath(os.path.join(_dist_dir, full_path))
        # Safety: never serve anything outside the dist folder.
        if candidate.startswith(_dist_dir) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_dist_dir, "index.html"))
else:
    # Local dev without a built frontend: keep the old behavior.
    @app.get("/")
    def root():
        return RedirectResponse(url="/web/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=True)
