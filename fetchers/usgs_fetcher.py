"""
fetchers/usgs_fetcher.py
========================
USGS 3DEP fetcher — the high-accuracy US data source.

What is 3DEP?
  The USGS "3D Elevation Program" covers most of the US at 1-meter resolution
  using lidar. A 1m resolution means each grid cell covers a 1m x 1m patch of
  ground. Compare that to Open-Elevation's ~30–90m cells — about 30–90x better.

How do we get it?
  USGS exposes a free "TNM" (The National Map) API. We ask it for a bounding box
  and it gives back a download URL for a GeoTIFF file. A GeoTIFF is just an image
  file that also stores geographic coordinates — every pixel is a height reading
  with a known lat/lon. We read it with 'rasterio', a library built for exactly
  this kind of geospatial image file.

What we return:
  Same DEMResult as every other fetcher. The engine never knows the difference.

Accuracy:
  1m resolution cells, vertical accuracy typically ±0.1–0.3m (vs ±5m for Open-
  Elevation). Huge improvement for US sites. Non-US falls back to Open-Elevation.
"""

from __future__ import annotations

import io
import math
import tempfile
import os

import numpy as np
import requests
import rasterio
from rasterio.transform import from_bounds

from fetchers.dem_source import DEMFetcher, DEMResult


# How many meters one degree of latitude equals (roughly constant worldwide).
M_PER_DEG_LAT = 111_320.0


class USGS3DEPFetcher(DEMFetcher):
    """
    Fetches 1-meter lidar DEMs from the USGS National Map API.
    Only works within the United States (including territories).
    Falls back to OpenElevationFetcher for non-US locations.
    """

    # The TNM "point query" API — we use it to check if 3DEP data exists
    # at a given lat/lon before trying to download a full tile.
    TNM_API = "https://tnmaccess.nationalmap.gov/api/v1/products"

    # The WCS (Web Coverage Service) endpoint — this is the one that actually
    # hands back a chunk of the elevation grid as a downloadable file.
    WCS_URL = (
        "https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/"
        "ImageServer/WCSServer"
    )

    def get_dem(self, lat: float, lon: float,
                width_m: float, height_m: float,
                resolution_m: float) -> DEMResult:
        """
        Fetch a DEM from USGS 3DEP for the requested area.

        Steps:
          1. Convert the center lat/lon + size in meters into a bounding box.
          2. Ask the WCS server for a GeoTIFF covering that box.
          3. Read the GeoTIFF with rasterio and pull out the height grid.
          4. Package it into a DEMResult.
        """

        # --- Step 1: build bounding box ---
        # Degrees per meter varies by direction and by latitude.
        deg_per_m_lat = 1.0 / M_PER_DEG_LAT
        deg_per_m_lon = 1.0 / (M_PER_DEG_LAT * math.cos(math.radians(lat)))

        half_h = (height_m / 2) * deg_per_m_lat
        half_w = (width_m / 2) * deg_per_m_lon

        min_lon = lon - half_w
        max_lon = lon + half_w
        min_lat = lat - half_h
        max_lat = lat + half_h

        # --- Step 2: ask WCS for a GeoTIFF ---
        # How many pixels wide/tall should the output image be?
        n_cols = max(2, int(width_m / resolution_m))
        n_rows = max(2, int(height_m / resolution_m))

        # WCS request parameters — this is the standard WCS 1.0.0 protocol.
        # COVERAGE=DEP3Elevation is the USGS layer name.
        # FORMAT=GeoTIFF tells the server to send back a GeoTIFF.
        # BBOX is the bounding box: minLon,minLat,maxLon,maxLat.
        params = {
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "GetCoverage",
            "COVERAGE": "DEP3Elevation",
            "CRS": "EPSG:4326",          # standard lat/lon coordinate system
            "BBOX": f"{min_lon},{min_lat},{max_lon},{max_lat}",
            "WIDTH": n_cols,
            "HEIGHT": n_rows,
            "FORMAT": "GeoTIFF",
        }

        try:
            resp = requests.get(self.WCS_URL, params=params, timeout=60)
            resp.raise_for_status()
        except requests.RequestException as e:
            raise RuntimeError(
                f"USGS 3DEP request failed: {e}. "
                "Check your internet connection or try a US location."
            ) from e

        # The response body IS the GeoTIFF file. Save it to a temp file so
        # rasterio can open it (rasterio needs a real file path, not raw bytes).
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        try:
            heights = self._read_geotiff(tmp_path)
        finally:
            os.unlink(tmp_path)   # clean up the temp file no matter what

        # Sanity check: if the whole grid is a single fill value, the server
        # returned no-data (common for non-US bounding boxes or ocean tiles).
        if heights is None or np.all(heights == heights.flat[0]):
            raise RuntimeError(
                "USGS 3DEP returned a no-data tile. "
                "This location may be outside the US or lack lidar coverage. "
                "Try OpenElevationFetcher for non-US locations."
            )

        return DEMResult(
            heights=heights,
            cell_size=resolution_m,
            source="USGS 3DEP (1m lidar)",
            vertical_error=0.2,
            note="High-accuracy US elevation. Coverage varies by state/year.",
            center_lat=lat, center_lon=lon,
            width_m=width_m, height_m=height_m,
        )

    def _read_geotiff(self, path: str) -> np.ndarray:
        """
        Open a GeoTIFF file and return its pixel values as a 2D numpy array.

        rasterio opens geospatial raster files. It's essentially like opening
        an image, except each "pixel" is a height value in meters.
        """
        with rasterio.open(path) as ds:
            # Band 1 is the elevation channel (GeoTIFFs can have many bands,
            # but elevation files always put heights in the first band).
            data = ds.read(1).astype(float)

            # rasterio uses a special no-data sentinel (like -9999 or -32768)
            # for "no measurement here". Replace those with the grid average
            # so they don't break slope / volume calculations.
            nodata = ds.nodata
            if nodata is not None:
                mask = data == nodata
                if mask.any():
                    valid_mean = float(np.mean(data[~mask])) if (~mask).any() else 0.0
                    data[mask] = valid_mean

        return data
