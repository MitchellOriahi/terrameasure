"""
scripts/make_sample_site.py
Build the landing page's sample terrain from REAL elevation data.

Why this script exists: the front page shows a 3D model of actual
ground. Fetching that live would mean every visitor waits on the survey
engine before the page finishes, so instead we run one real survey HERE,
at build time, and bake the result into a small TypeScript file the
frontend imports. Real data, zero load time, and it is honest: the page
says exactly which piece of Colorado it is showing.

Run it (from the project root, with the venv active):

    venv\\Scripts\\python.exe scripts\\make_sample_site.py

It writes frontend/src/data/sampleSite.ts. Re-run it whenever you want a
different sample site; nothing else depends on the values.
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import measurements as M          # noqa: E402
from fetchers.dem_source import OpenElevationFetcher  # noqa: E402
from fetchers.usgs_fetcher import USGS3DEPFetcher     # noqa: E402

# The sample site: foothills west of Golden, Colorado. Real relief, good
# lidar coverage, and a shape that is clearly hand-drawn rather than a
# rectangle, so the trimmed model shows off the outline trimming.
VERTICES = [
    (39.7480, -105.2320),
    (39.7480, -105.2270),
    (39.7448, -105.2262),
    (39.7440, -105.2310),
]

# How fine the stored grid is. 40 cells a side is plenty for a small
# canvas model and keeps the generated file around 25 KB.
TARGET_CELLS_PER_SIDE = 40

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "src", "data", "sampleSite.ts",
)


def main() -> int:
    lats = [v[0] for v in VERTICES]
    lons = [v[1] for v in VERTICES]
    center_lat = sum(lats) / len(lats)
    center_lon = sum(lons) / len(lons)

    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * np.cos(np.radians(center_lat))
    width_m = (max(lons) - min(lons)) * m_per_deg_lon
    height_m = (max(lats) - min(lats)) * m_per_deg_lat
    resolution = max(width_m, height_m) / TARGET_CELLS_PER_SIDE

    print(f"Site: {width_m:.0f} m x {height_m:.0f} m at "
          f"{center_lat:.5f}, {center_lon:.5f}, {resolution:.1f} m cells")

    # Best data first, free global fallback second: exactly what the API
    # does, so the sample is representative of a real survey.
    try:
        dem = USGS3DEPFetcher().get_dem(center_lat, center_lon,
                                        width_m, height_m, resolution)
        print(f"Source: {dem.source}")
    except Exception as e:  # noqa: BLE001
        print(f"USGS failed ({e}); falling back to Open-Elevation")
        dem = OpenElevationFetcher().get_dem(center_lat, center_lon,
                                             width_m, height_m, resolution)
        print(f"Source: {dem.source}")

    # Trim to the drawn outline, the same way a real survey does.
    heights = M.mask_dem_to_polygon(dem.heights, dem.cell_size,
                                    center_lat, center_lon, VERTICES)

    # The stored grid keeps NaN as the mean, exactly like the API's JSON,
    # because the frontend re-trims to the outline itself.
    mean = float(np.nanmean(heights))
    clean = np.where(np.isnan(heights), mean, heights)
    grid = [[round(float(v), 1) for v in row] for row in clean]

    ts = f'''// data/sampleSite.ts
// GENERATED FILE, do not hand-edit. Rebuild it with:
//     venv\\\\Scripts\\\\python.exe scripts\\\\make_sample_site.py
//
// A real elevation grid for a real place: foothills west of Golden,
// Colorado, fetched from {dem.source} and trimmed to the outline below.
// The landing page renders this as its 3D site model, so the first
// terrain a visitor spins is genuine ground rather than a decoration.
//
// Heights are metres above sea level, rounded to 0.1 m. Row 0 is the
// northernmost row (the project's convention everywhere).

import type {{ TerrainSource }} from "@/lib/terrainMesh";
import type {{ LatLon }} from "@/lib/geo";

/** The drawn boundary, so the model is trimmed to a real shape. */
export const SAMPLE_SITE_VERTICES: LatLon[] = [
{chr(10).join(f"  {{ lat: {lat}, lon: {lon} }}," for lat, lon in VERTICES)}
];

/** Where the sample came from, for the caption. */
export const SAMPLE_SITE_SOURCE = {json.dumps(dem.source)};

export const SAMPLE_SITE: TerrainSource = {{
  cell_size_m: {round(dem.cell_size, 2)},
  dem_center_lat: {round(center_lat, 6)},
  dem_center_lon: {round(center_lon, 6)},
  dem_grid: {json.dumps(grid)},
}};
'''

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(ts)

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Wrote {OUT_PATH} ({size_kb:.1f} KB), grid {clean.shape}, "
          f"heights {np.nanmin(heights):.1f} to {np.nanmax(heights):.1f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
