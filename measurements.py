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

import numpy as np
from shapely.geometry import Polygon, LineString


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
    avg = float(np.mean(slopes))

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
    cell_area = cell_size * cell_size          # m^2 covered by one cell
    diff = dem - target_height                  # +ve = above target, -ve = below

    cut = float(np.sum(diff[diff > 0]) * cell_area)        # dirt to remove
    fill = float(-np.sum(diff[diff < 0]) * cell_area)      # dirt to add (flip sign)
    net = cut - fill                                       # +ve = net export

    # Error: every cell's height is uncertain by vertical_error. Over N cells
    # the volume error grows with sqrt(N) (random errors partly cancel out).
    n_cells = dem.size
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
