"""
fetchers/dem_source.py
======================
A DEM has to come from SOMEWHERE. This file defines a common shape that every
source must follow, so the rest of the program never has to care which source
it is. This is the seam where the free tier and premium tier plug in.

  - FREE tier:    OpenElevationFetcher / USGSFetcher  (download public data)
  - PREMIUM tier: PhotoFetcher (later)                (reconstruct from photos)

Both will return the exact same thing: a DEMResult. The measurement engine
eats a DEMResult and never asks where it came from.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import requests


@dataclass
class DEMResult:
    """Everything the engine needs to measure, regardless of source."""
    heights: np.ndarray   # 2D grid of ground heights in meters
    cell_size: float      # meters per grid cell on the ground
    source: str           # where it came from, e.g. "USGS 3DEP 1m"
    vertical_error: float # typical height error of this source, in meters
    note: str = ""        # date of data, coverage caveats, etc.
    # Geographic location — used by the API to fetch satellite textures and
    # to compute bounding boxes for polygon masking.
    center_lat: float = 0.0
    center_lon: float = 0.0
    width_m: float = 0.0
    height_m: float = 0.0


# ---------------------------------------------------------------------------
# The "interface": any fetcher must provide get_dem(...). Python doesn't force
# this, but treating it as a contract keeps the free/premium tiers swappable.
# ---------------------------------------------------------------------------
class DEMFetcher:
    def get_dem(self, lat: float, lon: float,
                width_m: float, height_m: float,
                resolution_m: float) -> DEMResult:
        raise NotImplementedError("Each source implements this differently.")


# ---------------------------------------------------------------------------
# FREE TIER, simplest possible real source: Open-Elevation.
# It's a free public API that returns ground height for lat/lon points.
# We ask it for a grid of points and assemble them into a DEM.
#
# This is the EASIEST real source to start with — no API key, no auth.
# It is lower quality than USGS 3DEP, but it works ANYWHERE on Earth and is
# perfect for getting the whole pipeline running end-to-end first.
# Swap in USGS 3DEP later for far better US accuracy.
# ---------------------------------------------------------------------------
class OpenElevationFetcher(DEMFetcher):
    API = "https://api.open-elevation.com/api/v1/lookup"

    def get_dem(self, lat, lon, width_m, height_m, resolution_m) -> DEMResult:
        # Roughly how many degrees of lat/lon correspond to our cell size.
        # 1 degree latitude ~= 111,320 meters. Longitude shrinks toward poles,
        # so we scale it by cos(latitude).
        m_per_deg_lat = 111_320.0
        m_per_deg_lon = 111_320.0 * np.cos(np.radians(lat))

        n_cols = max(2, int(width_m / resolution_m))
        n_rows = max(2, int(height_m / resolution_m))

        # Build the grid of lat/lon points we want heights for.
        lat_step = resolution_m / m_per_deg_lat
        lon_step = resolution_m / m_per_deg_lon

        locations = []
        for r in range(n_rows):
            for c in range(n_cols):
                plat = lat + (r - n_rows / 2) * lat_step
                plon = lon + (c - n_cols / 2) * lon_step
                locations.append({"latitude": plat, "longitude": plon})

        # Ask the API for all those heights in one POST request.
        resp = requests.post(self.API, json={"locations": locations}, timeout=60)
        resp.raise_for_status()
        results = resp.json()["results"]

        # Reshape the flat list of heights back into a 2D grid.
        heights = np.array([pt["elevation"] for pt in results], dtype=float)
        heights = heights.reshape(n_rows, n_cols)

        return DEMResult(
            heights=heights,
            cell_size=resolution_m,
            source="Open-Elevation (free, global)",
            vertical_error=5.0,
            note="Low-res free source. Use USGS 3DEP for US survey work.",
            center_lat=lat, center_lon=lon,
            width_m=width_m, height_m=height_m,
        )


# ---------------------------------------------------------------------------
# PLACEHOLDER for the premium tier so the shape is obvious now. Building the
# real Structure-from-Motion pipeline is Phase 2 — but note it returns the
# SAME DEMResult, so the engine and API never change.
# ---------------------------------------------------------------------------
class PhotoFetcher(DEMFetcher):
    def get_dem(self, lat, lon, width_m, height_m, resolution_m) -> DEMResult:
        raise NotImplementedError(
            "Premium tier (Phase 2): reconstruct a DEM from uploaded photos "
            "using Structure-from-Motion, then return a DEMResult here."
        )


if __name__ == "__main__":
    # Quick live test against a real location: a spot in the Rocky Mountains
    # where terrain clearly varies, so we can see real elevation change.
    print("Fetching a small real DEM (needs internet)...")
    fetcher = OpenElevationFetcher()
    dem = fetcher.get_dem(lat=39.7392, lon=-105.5,
                          width_m=200, height_m=200, resolution_m=50)
    print(f"Source: {dem.source}")
    print(f"Grid shape: {dem.heights.shape}, cell size {dem.cell_size}m")
    print(f"Height range: {dem.heights.min():.1f}m to {dem.heights.max():.1f}m")
    print(f"Stated vertical error: +/-{dem.vertical_error}m")
