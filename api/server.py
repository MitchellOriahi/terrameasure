"""
api/server.py  — TerraMeasure v0.3
===================================
Services:
  GET  /survey              — TerraScan: map-click → elevation → measurements
  POST /survey/polygon      — TerraScan: drawn polygon → masked elevation → measurements
  POST /photo-survey        — TerraPhoto: uploaded photos → GPS → measurements
  GET  /geocode             — Address / place-name search proxy (Nominatim)
  GET  /health              — Liveness check

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
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests as http_requests

from fetchers.dem_source import OpenElevationFetcher
from fetchers.photo_fetcher import PhotoFetcher
from engine import measurements as M


# ---------------------------------------------------------------------------
app = FastAPI(title="TerraMeasure API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


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
    # Real satellite image of the survey area — draped over the 3D terrain
    # to make it look like Google Earth instead of a blurry slope map.
    satellite_texture_b64: str = ""
    # Actual DEM geographic bounds — the client uses these for pixel-perfect
    # overlay alignment (slope map, contour map etc. must be placed exactly here).
    dem_center_lat: float = 0.0
    dem_center_lon: float = 0.0
    dem_width_m: float = 0.0
    dem_height_m: float = 0.0
    # Average ground height — used by the frontend agriculture panel to
    # estimate irrigation potential (flat, low-lying land irrigates easiest).
    avg_height: float = 0.0
    # Extra fields for photo surveys
    photo_count: Optional[int] = None
    gps_found: Optional[bool] = None
    location_note: Optional[str] = None


class PolygonSurveyRequest(BaseModel):
    vertices: list[dict]      # [{lat: float, lon: float}, ...]
    resolution_m: float = 10.0


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

    Esri World Imagery is publicly accessible — no API key required.
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
# Shared survey logic
# ---------------------------------------------------------------------------
def run_survey(dem_result) -> SurveyResponse:
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

    # Satellite texture — real aerial photography of the area
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

    return SurveyResponse(
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
        # Geographic bounds of the DEM — the client uses these to pin image
        # overlays (slope map, contour map) exactly over the right spot on the map.
        dem_center_lat=dem_result.center_lat,
        dem_center_lon=dem_result.center_lon,
        dem_width_m=dem_result.width_m or (dem_result.cell_size * cols),
        dem_height_m=dem_result.height_m or (dem_result.cell_size * rows),
    )


# ---------------------------------------------------------------------------
# TerraScan — map-click survey (rectangle)
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
    try:
        from fetchers.usgs_fetcher import USGS3DEPFetcher
        dem_result = USGS3DEPFetcher().get_dem(lat, lon, width_m, height_m, resolution_m)
    except Exception:
        dem_result = OpenElevationFetcher().get_dem(lat, lon, width_m, height_m, resolution_m)

    try:
        return run_survey(dem_result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# TerraScan — drawn polygon survey
# ---------------------------------------------------------------------------
@app.post("/survey/polygon", response_model=SurveyResponse)
def survey_polygon(req: PolygonSurveyRequest):
    """
    TerraScan polygon mode: the user draws a custom shape on the map.

    Steps:
      1. Compute bounding box from polygon vertices.
      2. Fetch DEM for that bounding box (with 15% padding so edges don't clip).
      3. Mask the DEM to the polygon — cells outside are set to NaN.
      4. Run all measurements only on cells inside the polygon.
    """
    if len(req.vertices) < 3:
        raise HTTPException(status_code=400,
                            detail="Polygon needs at least 3 vertices.")

    lats = [v["lat"] for v in req.vertices]
    lons = [v["lon"] for v in req.vertices]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(center_lat))
    width_m  = (max_lon - min_lon) * m_per_deg_lon * 1.15   # 15% padding
    height_m = (max_lat - min_lat) * m_per_deg_lat * 1.15

    try:
        from fetchers.usgs_fetcher import USGS3DEPFetcher
        dem_result = USGS3DEPFetcher().get_dem(
            center_lat, center_lon, width_m, height_m, req.resolution_m)
    except Exception:
        dem_result = OpenElevationFetcher().get_dem(
            center_lat, center_lon, width_m, height_m, req.resolution_m)

    # Mask DEM to the drawn polygon shape
    poly_coords = [(v["lat"], v["lon"]) for v in req.vertices]
    dem_result.heights = M.mask_dem_to_polygon(
        dem_result.heights, dem_result.cell_size,
        center_lat, center_lon, poly_coords,
    )

    try:
        return run_survey(dem_result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# TerraPhoto — photo upload survey
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
    try:
        resp = run_survey(dem_result)
        resp.photo_count = len(files)
        resp.gps_found   = loc["gps_found"]
        resp.location_note = loc["note"]
        return resp
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    return {"status": "ok", "version": "0.3.0"}

@app.get("/")
def root():
    return RedirectResponse(url="/web/index.html")

_web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
app.mount("/web", StaticFiles(directory=_web_dir), name="web")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=True)
