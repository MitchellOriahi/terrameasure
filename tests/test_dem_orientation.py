"""
test_dem_orientation.py
Does every DEM we build put NORTH in row 0?

Why this test exists (the bug it locks the door on):
Everything downstream of a fetcher assumes the height grid is stored the
way a map image is: the FIRST row is the northernmost strip of ground,
the LAST row is the southernmost. The polygon mask in
engine/measurements.py does the lat/lon math that way, the slope and
contour PNGs are drawn that way, and the frontend pins those PNGs to the
map with the north-west corner first.

Open-Elevation had it backwards: it asked for the southern row first, so
every survey from that source was silently mirrored north to south. On a
symmetric square nobody notices. On an L-shaped or river-front parcel it
means the mask keeps the WRONG HALF of the ground, so the score, the
slope and the cost all describe land the user did not draw.

How we test it without the internet: Open-Elevation is a single HTTP POST
whose reply is a list of {"elevation": ...} in the same order as the
points we asked for. So we swap requests.post for a fake that answers
with each point's own LATITUDE as its "elevation". Then a height grid
that decreases as you walk down the rows proves row 0 is the farthest
north. No network, no API key, instant.

Run it directly:  python tests/test_dem_orientation.py
"""

import sys
import os
import types

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fetchers import dem_source  # noqa: E402


class _FakeResponse:
    """The two things the fetcher uses from a requests response."""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _fake_post(url, json=None, timeout=None):
    """Answer every requested point with its own latitude as the height."""
    locations = json["locations"]
    return _FakeResponse(
        {"results": [{"elevation": p["latitude"]} for p in locations]}
    )


def test_open_elevation_row_zero_is_north():
    """Row 0 must hold the HIGHEST latitude (the northernmost ground)."""
    original_post = dem_source.requests.post
    dem_source.requests.post = _fake_post
    try:
        dem = dem_source.OpenElevationFetcher().get_dem(
            lat=39.75, lon=-105.2, width_m=300, height_m=300, resolution_m=50
        )
    finally:
        dem_source.requests.post = original_post

    heights = dem.heights
    rows = heights.shape[0]
    assert rows >= 3, "need a few rows for this test to mean anything"

    # Each "height" IS the latitude of that cell, so the first row must be
    # north of the last one.
    north_row = float(np.mean(heights[0]))
    south_row = float(np.mean(heights[-1]))
    assert north_row > south_row, (
        f"row 0 latitude {north_row:.5f} should be NORTH of the last row "
        f"{south_row:.5f}; the grid is stored upside down"
    )

    # And the drop should be steady all the way down, not just at the ends.
    row_means = [float(np.mean(r)) for r in heights]
    assert all(a > b for a, b in zip(row_means, row_means[1:])), (
        "latitude must decrease monotonically from row 0 downward"
    )


def test_mask_keeps_the_northern_half_when_asked():
    """The polygon mask must agree with that row order.

    We draw a polygon covering only the NORTHERN half of a grid and check
    that the surviving (non-NaN) cells really are in the top rows.
    """
    from engine import measurements as M

    rows = cols = 20
    cell = 10.0  # metres
    center_lat, center_lon = 39.75, -105.2
    dem = np.ones((rows, cols), dtype=float)

    # Half the grid is 100 m tall, so the northern half spans from the
    # centre latitude up to +100 m. A little inset (5 m) keeps the
    # boundary cells out of the "is it exactly on the line" grey area.
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * np.cos(np.radians(center_lat))
    north = center_lat + 95.0 / m_per_deg_lat
    south = center_lat + 5.0 / m_per_deg_lat
    west = center_lon - 95.0 / m_per_deg_lon
    east = center_lon + 95.0 / m_per_deg_lon

    masked = M.mask_dem_to_polygon(
        dem, cell, center_lat, center_lon,
        [(north, west), (north, east), (south, east), (south, west)],
    )

    kept_rows = np.where(~np.isnan(masked).all(axis=1))[0]
    assert len(kept_rows) > 0, "the mask threw away the whole grid"
    assert kept_rows.max() < rows / 2, (
        f"northern polygon kept rows {kept_rows.min()}..{kept_rows.max()}; "
        "those should all be in the TOP half of the grid"
    )


if __name__ == "__main__":
    tests = [
        test_open_elevation_row_zero_is_north,
        test_mask_keeps_the_northern_half_when_asked,
    ]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(tests)} passed")
    sys.exit(0 if passed == len(tests) else 1)
