"""
tests/test_measurements.py
==========================
Tests prove the math is right. For a SURVEYING tool, this matters more than
usual — wrong numbers are the whole risk. We test against shapes whose answers
we can work out by hand.

Run:  python -m pytest tests/ -v
(or just: python tests/test_measurements.py)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from engine import measurements as M


def test_rectangle_area_is_exact():
    # A 10 x 5 rectangle must be exactly 50 square meters.
    rect = [(0, 0), (10, 0), (10, 5), (0, 5)]
    result = M.polygon_area(rect)
    assert abs(result.value - 50.0) < 0.001, f"got {result.value}"


def test_rectangle_perimeter_is_exact():
    # Perimeter of 10 x 5 rectangle = 2*(10+5) = 30 meters.
    rect = [(0, 0), (10, 0), (10, 5), (0, 5)]
    result = M.perimeter(rect)
    assert abs(result.value - 30.0) < 0.001, f"got {result.value}"


def test_distance_uses_pythagoras():
    # Distance from (0,0) to (3,4) is the classic 3-4-5 triangle = 5.
    result = M.distance((0, 0), (3, 4))
    assert abs(result.value - 5.0) < 0.001, f"got {result.value}"


def test_flat_ground_has_zero_slope():
    # A perfectly flat DEM (all the same height) must have 0 slope everywhere.
    flat = np.full((10, 10), 100.0)
    result = M.average_slope(flat, cell_size=1.0)
    assert abs(result.value - 0.0) < 0.001, f"got {result.value}"


def test_volume_balances_at_average_height():
    # If you grade a site to its own average height, cut should equal fill.
    yy, xx = np.mgrid[0:10, 0:10]
    dem = 100 + xx.astype(float)        # a simple ramp
    target = float(dem.mean())
    vols = M.volume_to_grade(dem, cell_size=1.0, target_height=target)
    assert abs(vols["cut"].value - vols["fill"].value) < 1.0, "cut should ~= fill"


def test_volume_error_is_honest_on_large_sites():
    # CEO punchlist: the old bound treated per-cell error as independent,
    # so a big site claimed an absurd sub-1% cut/fill bound. DEM error is
    # spatially correlated (a whole lidar pass shares one calibration), so
    # the bound must now include a systematic term that scales with site
    # area, landing at a DOUBLE-DIGIT percentage of volume here.
    #
    # Site: 200x200 cells at 10 m = 2 km x 2 km = 4,000,000 m2.
    # Heights: a gentle east-west ramp from 0 to 2 m. Graded to its mean
    # (1 m), cut ~= fill ~= 1,005,000 m3 (mean |deviation| ~0.5 m x half
    # the area x 2 halves... easier by hand: (2/199) * 5000 * 200 rows
    # * 100 m2/cell = 1,005,025 m3).
    #
    # Error with vertical_error = 0.2 m:
    #   random     = 0.2 * 100 * sqrt(40000)      =      4,000 m3
    #   systematic = 4,000,000 * 0.2 * 0.6        =    480,000 m3
    #   total      = sqrt(4000^2 + 480000^2)      ~=   480,017 m3
    # That is ~48% of the volume. The OLD model would have claimed 4,000,
    # i.e. 0.4%: exactly the fake precision this test forbids.
    yy, xx = np.mgrid[0:200, 0:200]
    dem = xx.astype(float) * (2.0 / 199.0)
    target = float(dem.mean())
    vols = M.volume_to_grade(dem, cell_size=10.0, target_height=target,
                             vertical_error=0.2)
    cut = vols["cut"]
    ratio = cut.error / cut.value
    assert cut.value > 900_000, f"sanity: cut volume was {cut.value}"
    # Double-digit percentage, not sub-1%:
    assert ratio >= 0.10, f"error bound {ratio:.1%} is dishonestly small"
    # ...but still a bound, not a shrug:
    assert ratio <= 0.60, f"error bound {ratio:.1%} is uselessly large"
    # And the note must admit the correlated-bias model.
    assert "correlated" in cut.note.lower(), cut.note


def test_every_measurement_carries_an_error():
    # The core promise: no bare numbers. Everything has an error estimate.
    rect = [(0, 0), (10, 0), (10, 5), (0, 5)]
    result = M.polygon_area(rect, point_error=0.1)
    assert hasattr(result, "error")
    assert result.unit == "m^2"


if __name__ == "__main__":
    # Run all the test_ functions and report.
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
    print(f"\n{passed}/{len(tests)} tests passed")
