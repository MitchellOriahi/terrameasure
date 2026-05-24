"""
engine/measurements.py
=======================
THE measurement engine. This is the most important file in the project.

It does NOT know or care where the data came from (free-tier public download,
or premium-tier photo reconstruction). It just takes numbers and does math.

Two kinds of input show up here:
  1. A list of (x, y) points  -> for flat measurements like area & distance.
  2. A DEM (a 2D grid of heights) -> for 3D measurements like slope & volume.

Everything is in METERS. Convert to other units only at the very end, for display.

Beginner note: we lean on two well-tested libraries so we don't reinvent geometry:
  - shapely : polygons, areas, distances, perimeters
  - numpy   : fast math on big grids of numbers (the DEM)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
from shapely.geometry import Polygon, LineString
import matplotlib
matplotlib.use("Agg")   # non-interactive backend — works without a display
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors


# ---------------------------------------------------------------------------
# A small container to carry a measurement AND how confident we are in it.
# The whole product's credibility lives in this idea: never return a bare
# number. Always return the number + an error estimate + what units it's in.
# ---------------------------------------------------------------------------
@dataclass
class Measurement:
    value: float        # the measured quantity, e.g. 1234.5
    unit: str           # e.g. "m^2", "m", "degrees", "m^3"
    error: float        # plus/minus estimate in the same unit (best guess)
    note: str = ""      # human-readable caveat, e.g. data source / resolution

    def __str__(self) -> str:
        return f"{self.value:,.2f} +/- {self.error:,.2f} {self.unit}  ({self.note})"


# ===========================================================================
# PART 1 — FLAT MEASUREMENTS (just need a list of points, no heights)
# ===========================================================================

def polygon_area(points: list[tuple[float, float]],
                 point_error: float = 0.0) -> Measurement:
    """
    Area of a shape drawn as a ring of (x, y) points, in square meters.

    'points' is like [(0,0), (10,0), (10,5), (0,5)] — corners going around.
    shapely handles the actual area math (the "shoelace formula") for us.

    'point_error' is how uncertain each corner's position is, in meters.
    We use it to roughly estimate how wrong the area could be.
    """
    poly = Polygon(points)
    area = poly.area

    # Rough error model: if every corner could be off by 'point_error' meters,
    # the area uncertainty scales with the perimeter. This is an approximation,
    # not gospel — but an honest approximation beats a fake-precise number.
    perimeter = poly.length
    area_error = perimeter * point_error

    return Measurement(
        value=area,
        unit="m^2",
        error=area_error,
        note=f"from {len(points)} boundary points, +/-{point_error}m each",
    )


def perimeter(points: list[tuple[float, float]],
              point_error: float = 0.0) -> Measurement:
    """Total length around the edge of a shape, in meters."""
    poly = Polygon(points)
    per = poly.length

    # Each edge connects two corners; uncertainty adds up along the edges.
    n_edges = len(points)
    per_error = math.sqrt(n_edges) * point_error * 2

    return Measurement(
        value=per,
        unit="m",
        error=per_error,
        note=f"perimeter of {len(points)}-point boundary",
    )


def distance(p1: tuple[float, float],
             p2: tuple[float, float],
             point_error: float = 0.0) -> Measurement:
    """Straight-line distance between two points, in meters."""
    line = LineString([p1, p2])
    dist = line.length

    # If each endpoint is uncertain by point_error, the distance uncertainty
    # is roughly the two combined (added "in quadrature" — standard for errors).
    dist_error = math.sqrt(2) * point_error

    return Measurement(
        value=dist,
        unit="m",
        error=dist_error,
        note="straight-line distance",
    )


# ===========================================================================
# PART 2 — 3D MEASUREMENTS (need a DEM: a grid of heights)
# ===========================================================================
#
# A DEM here is a numpy 2D array of heights in meters, plus 'cell_size':
# how many meters wide each grid cell is on the ground. A cell_size of 1.0
# means each number covers a 1m x 1m patch of ground.
# ===========================================================================

def slope_map(dem: np.ndarray, cell_size: float) -> np.ndarray:
    """
    Returns a grid the same shape as the DEM, where each cell is the ground
    slope at that spot, in DEGREES (0 = flat, 90 = vertical cliff).

    How it works: slope = how fast height changes as you move. numpy.gradient
    gives us the change in height per cell in the x and y directions; we combine
    them and convert the ratio into an angle.
    """
    # rise-over-run in each direction. dz_dy is rows, dz_dx is columns.
    dz_dy, dz_dx = np.gradient(dem, cell_size)

    # total steepness = length of the (dx, dy) slope vector
    rise_over_run = np.sqrt(dz_dx ** 2 + dz_dy ** 2)

    # arctan turns the ratio into an angle; convert radians -> degrees
    slope_degrees = np.degrees(np.arctan(rise_over_run))
    return slope_degrees


def average_slope(dem: np.ndarray, cell_size: float,
                  vertical_error: float = 0.15) -> Measurement:
    """Average slope across the whole DEM, in degrees."""
    slopes = slope_map(dem, cell_size)
    avg = float(np.nanmean(slopes))

    # If heights are uncertain by 'vertical_error' meters, slope is fuzzier on
    # small cells. Rough estimate of the resulting slope error in degrees.
    slope_err = math.degrees(math.atan(vertical_error / cell_size))

    return Measurement(
        value=avg,
        unit="degrees",
        error=slope_err,
        note=f"mean slope, cell size {cell_size}m",
    )


def volume_to_grade(dem: np.ndarray, cell_size: float,
                    target_height: float,
                    vertical_error: float = 0.15) -> dict[str, Measurement]:
    """
    THE money function for construction & mining: cut/fill volume.

    Given the current ground (the DEM) and a target flat height you want to
    grade the site to, how much dirt must be removed (CUT) and added (FILL)?

    For each cell: height difference x cell area = a little volume.
      - ground higher than target -> must CUT (remove dirt)
      - ground lower than target  -> must FILL (add dirt)
    Sum them up separately.
    """
    cell_area = cell_size * cell_size
    valid = ~np.isnan(dem)
    diff = np.where(valid, dem - target_height, 0.0)

    cut  = float(np.sum(diff[(diff > 0) & valid]) * cell_area)
    fill = float(-np.sum(diff[(diff < 0) & valid]) * cell_area)
    net  = cut - fill

    n_cells = int(np.sum(valid)) or dem.size
    vol_error = vertical_error * cell_area * math.sqrt(n_cells)

    return {
        "cut": Measurement(cut, "m^3", vol_error, "dirt to remove"),
        "fill": Measurement(fill, "m^3", vol_error, "dirt to add"),
        "net": Measurement(net, "m^3", vol_error * math.sqrt(2),
                           "net (positive = export)"),
    }


def elevation_profile(dem: np.ndarray, cell_size: float,
                      start_rc: tuple[int, int],
                      end_rc: tuple[int, int],
                      samples: int = 100) -> list[tuple[float, float]]:
    """
    Heights along a straight line across the DEM — like slicing the ground
    with a knife and looking at the cut face. Great for road/pipeline planning.

    start_rc and end_rc are (row, col) positions in the grid.
    Returns a list of (distance_along_line_in_meters, height_in_meters).
    """
    r0, c0 = start_rc
    r1, c1 = end_rc

    profile = []
    for i in range(samples):
        t = i / (samples - 1)                   # fraction from 0.0 to 1.0
        r = int(round(r0 + (r1 - r0) * t))      # interpolate row
        c = int(round(c0 + (c1 - c0) * t))      # interpolate col
        height = float(dem[r, c])

        # how far along the line we are, in meters
        cells_traveled = math.hypot((r - r0), (c - c0))
        dist_m = cells_traveled * cell_size

        profile.append((dist_m, height))

    return profile


# ===========================================================================
# PART 3 — VISUAL OUTPUTS (contour lines and a colored slope map)
# ===========================================================================
#
# These functions take a DEM and produce images that surveyors, engineers,
# and clients can immediately understand — no numbers needed.
# ===========================================================================

@dataclass
class ContourResult:
    """
    The output of contours(): a set of elevation lines at regular intervals.

    Each "line" in 'lines' is a list of (x_meters, y_meters) points tracing
    one contour. The matching entry in 'levels' tells you what height that
    line represents.
    """
    levels: list[float]                        # one height per contour line
    lines: list[list[tuple[float, float]]]     # one path per contour line
    interval: float                            # height spacing used, in meters
    note: str = ""


def contours(dem: np.ndarray, cell_size: float,
             interval: float | None = None) -> ContourResult:
    """
    Compute contour lines for a DEM — the classic topo-map result.

    What is a contour line?
      It's a line connecting all points at the same height. On a topo map,
      closely spaced lines mean steep terrain; wide spacing means gentle slope.

    How matplotlib does it:
      matplotlib's `contour()` function finds these lines automatically using
      a "marching squares" algorithm — it walks across the grid and traces
      wherever the height crosses each target level.

    Parameters:
      dem        — 2D height grid in meters
      cell_size  — meters per grid cell
      interval   — how many meters between contour lines (auto if None)
    """

    # If no interval is given, pick one based on the total height range.
    # A 5m interval on a 50m hill gives 10 lines — readable, not cluttered.
    if interval is None:
        height_range = float(dem.max() - dem.min())
        if height_range < 5:
            interval = 0.5
        elif height_range < 50:
            interval = 5.0
        else:
            interval = 10.0

    z_min = float(dem.min())
    z_max = float(dem.max())

    # Build the list of heights we want lines at (e.g. 100, 105, 110, ...).
    levels = list(np.arange(
        math.ceil(z_min / interval) * interval,
        z_max,
        interval,
    ))
    if not levels:
        levels = [float(z_min + (z_max - z_min) / 2)]

    # Build x, y coordinate grids matching the DEM — matplotlib needs them.
    rows, cols = dem.shape
    x = np.arange(cols) * cell_size   # x axis in meters
    y = np.arange(rows) * cell_size   # y axis in meters

    # Use matplotlib contour to trace the lines. We immediately extract the
    # path data and throw away the figure — we just want the numbers.
    fig, ax = plt.subplots()
    cs = ax.contour(x, y, dem, levels=levels)

    extracted: list[list[tuple[float, float]]] = []
    used_levels: list[float] = []

    # cs.allsegs is a list[list[ndarray]] — outer index = level, inner = segments.
    # Each segment array has shape (N, 2): columns are [x, y].
    for level, segments in zip(cs.levels, cs.allsegs):
        for seg in segments:
            pts = [(float(seg[i, 0]), float(seg[i, 1])) for i in range(len(seg))]
            if len(pts) >= 2:
                extracted.append(pts)
                used_levels.append(float(level))

    plt.close(fig)   # free memory — never leave figures open

    return ContourResult(
        levels=used_levels,
        lines=extracted,
        interval=interval,
        note=f"{len(extracted)} contour lines at {interval}m interval",
    )


def render_images(dem: np.ndarray, cell_size: float,
                  contour_interval: float | None = None) -> dict[str, bytes]:
    """
    Produce two PNG images as raw bytes, ready to serve over HTTP or save to disk.

    Image 1 — "slope_map":
      Every pixel is colored by how steep that patch of ground is.
        green  = flat   (< 5°)
        yellow = gentle (5–15°)
        orange = steep  (15–30°)
        red    = very steep / cliff (> 30°)

      This is immediately useful for a contractor deciding where roads can go.

    Image 2 — "contour_map":
      Classic topo-map look: elevation lines on a grey hillshade background.
      The hillshade (light from northwest) gives 3D depth. Surveyors and clients
      can read this at a glance.

    Returns a dict: {"slope_map": <png bytes>, "contour_map": <png bytes>}
    """
    rows, cols = dem.shape
    x = np.arange(cols) * cell_size
    y = np.arange(rows) * cell_size

    # --- Image 1: slope color map ---
    slopes = slope_map(dem, cell_size)

    # Custom color scale: green→yellow→orange→red at 0°/5°/15°/30°/90°
    slope_cmap = mcolors.LinearSegmentedColormap.from_list(
        "terrain_slope",
        [(0.0, "#2ecc71"),   # 0°   flat → green
         (0.06, "#f1c40f"),  # ~5°  gentle → yellow
         (0.17, "#e67e22"),  # ~15° steep → orange
         (0.33, "#e74c3c"),  # ~30° very steep → red
         (1.0, "#7f0000")],  # 90°  cliff → dark red
        N=256,
    )

    fig, ax = plt.subplots(figsize=(8, 8), dpi=100)
    img = ax.imshow(slopes, cmap=slope_cmap, vmin=0, vmax=45,
                    extent=[0, cols * cell_size, 0, rows * cell_size],
                    origin="upper")
    plt.colorbar(img, ax=ax, label="Slope (degrees)")
    ax.set_title("Slope Map")
    ax.set_xlabel("East (m)")
    ax.set_ylabel("North (m)")
    slope_png = _fig_to_bytes(fig)
    plt.close(fig)

    # --- Image 2: contour map over hillshade ---
    # Hillshade: simulate sunlight from northwest to give 3D depth.
    # azimuth=315° (northwest), altitude=45°.
    from matplotlib.colors import LightSource
    ls = LightSource(azdeg=315, altdeg=45)
    hillshade = ls.hillshade(dem, vert_exag=1.0, dx=cell_size, dy=cell_size)

    c_result = contours(dem, cell_size, interval=contour_interval)

    fig, ax = plt.subplots(figsize=(8, 8), dpi=100)
    ax.imshow(hillshade, cmap="gray", extent=[0, cols * cell_size, 0, rows * cell_size],
              origin="upper", alpha=0.6)

    # Draw the contour lines on top of the hillshade.
    for level, line in zip(c_result.levels, c_result.lines):
        xs = [p[0] for p in line]
        ys = [p[1] for p in line]
        ax.plot(xs, ys, color="#1a5276", linewidth=0.7, alpha=0.85)

    ax.set_title(f"Contour Map  ({c_result.interval}m interval)")
    ax.set_xlabel("East (m)")
    ax.set_ylabel("North (m)")
    contour_png = _fig_to_bytes(fig)
    plt.close(fig)

    return {"slope_map": slope_png, "contour_map": contour_png}


def buildable_area_pct(dem: np.ndarray, cell_size: float,
                       max_slope_deg: float = 8.0) -> float:
    """
    Percentage of the survey area where slope is gentle enough to build on.

    Industry rule of thumb: slopes below 8° are generally buildable without
    major grading. 8–15° needs careful engineering. Above 15° is steep.

    Returns a float 0–100.
    """
    slopes = slope_map(dem, cell_size)
    valid = ~np.isnan(dem)
    total = int(np.sum(valid))
    if total == 0:
        return 0.0
    buildable = int(np.sum((slopes < max_slope_deg) & valid))
    return round(buildable / total * 100, 1)


def dominant_aspect(dem: np.ndarray, cell_size: float) -> float:
    """
    The average compass direction the terrain faces, in degrees (0=N, 90=E, …).

    Useful for solar-panel orientation and drainage assessment.
    """
    dz_dy, dz_dx = np.gradient(np.where(np.isnan(dem), 0.0, dem), cell_size)
    # arctan2 gives mathematical angle; we convert to compass bearing
    aspect_rad = np.arctan2(-dz_dy, dz_dx)
    aspect_deg = (90.0 - np.degrees(aspect_rad)) % 360.0
    valid = ~np.isnan(dem)
    return float(np.mean(aspect_deg[valid])) if valid.any() else 0.0


def mask_dem_to_polygon(
    dem: np.ndarray,
    cell_size: float,
    center_lat: float,
    center_lon: float,
    polygon_latlons: list[tuple[float, float]],
) -> np.ndarray:
    """
    Set DEM cells that fall OUTSIDE the given lat/lon polygon to NaN so that
    all measurements only reflect the drawn area, not the rectangular bounding box.

    How the coordinate mapping works:
      Each DEM cell (row r, col c) sits at a position in metres relative to
      the centre of the grid. Row 0 is the northernmost edge; col 0 is the
      westernmost edge. We convert the polygon's lat/lon vertices to the same
      local metre system and use Shapely to test containment.
    """
    import math
    from shapely.geometry import Polygon as SPoly
    from shapely import contains_xy

    rows, cols = dem.shape
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(center_lat))

    # Polygon vertices → local metres (east = +x, north = +y)
    poly_xy = [
        ((lon - center_lon) * m_per_deg_lon,
         (lat - center_lat) * m_per_deg_lat)
        for lat, lon in polygon_latlons
    ]
    poly = SPoly(poly_xy)

    # Build grids of x (east) and y (north) coordinates for every cell centre
    col_x = (np.arange(cols) - cols / 2 + 0.5) * cell_size          # shape (cols,)
    row_y = (rows / 2 - np.arange(rows) - 0.5) * cell_size           # shape (rows,)
    X = np.tile(col_x, (rows, 1))                                      # (rows, cols)
    Y = np.repeat(row_y[:, np.newaxis], cols, axis=1)                  # (rows, cols)

    inside = contains_xy(poly, X.ravel(), Y.ravel()).reshape(rows, cols)

    masked = dem.astype(float).copy()
    masked[~inside] = np.nan
    return masked


def _fig_to_bytes(fig) -> bytes:
    """Convert a matplotlib figure to PNG bytes without touching the filesystem."""
    import io
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.read()


# ===========================================================================
# Quick self-test so you can run this file directly and see it work.
# Run:  python engine/measurements.py
# ===========================================================================
if __name__ == "__main__":
    print("=== FLAT MEASUREMENTS ===")
    # A simple 10m x 5m rectangle
    rect = [(0, 0), (10, 0), (10, 5), (0, 5)]
    print("Area:     ", polygon_area(rect, point_error=0.1))
    print("Perimeter:", perimeter(rect, point_error=0.1))
    print("Diagonal: ", distance((0, 0), (10, 5), point_error=0.1))

    print("\n=== 3D MEASUREMENTS ===")
    # A fake DEM: a gentle 20x20 hill, cells are 1 meter each.
    yy, xx = np.mgrid[0:20, 0:20]
    fake_dem = 100 + 0.3 * xx + 0.1 * yy        # heights from ~100m up
    print("Avg slope:", average_slope(fake_dem, cell_size=1.0))

    vols = volume_to_grade(fake_dem, cell_size=1.0, target_height=103.0)
    for name, m in vols.items():
        print(f"  {name:5}: {m}")
