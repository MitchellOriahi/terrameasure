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
