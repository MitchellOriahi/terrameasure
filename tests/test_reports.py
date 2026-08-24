"""
tests/test_reports.py
=====================
Tests for the share-link report endpoints (api/reports.py).

Everything here runs OFFLINE. We build a tiny FastAPI app containing
just the reports router and drive it with TestClient, FastAPI's
built-in fake browser: requests go straight to the code in-process,
no real network, no real server.

The store is swapped to a fresh MemoryReportStore before every test,
so tests cannot leak state into each other (and cannot touch Supabase
even if the env var happened to be set).

Run:  venv\\Scripts\\python.exe tests/test_reports.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports as R


def _client():
    """
    A fresh app + client + clean slate for each test:
      * brand new in-memory store (nothing left over from other tests)
      * rate-limit counters wiped
    """
    R._store = R.MemoryReportStore()
    R._rate_hits.clear()
    app = FastAPI()
    app.include_router(R.router)
    return TestClient(app)


def _tiny_survey(**extra):
    """A minimal but realistic survey snapshot to post."""
    survey = {
        "source": "USGS 3DEP (test)",
        "vertical_error_m": 0.5,
        "avg_slope": {"value": 3.2, "unit": "deg", "error": 0.4, "note": ""},
        "buildable_area_pct": 91.0,
        "score": {"value": 82, "verdict": "go"},
        # Image fields, to exercise the strip-and-keep rule:
        "satellite_texture_b64": "S" * 5000,       # always stripped
        "slope_map_png_b64": "P" * 3000,           # always stripped
        "slope_map_clean_b64": "A" * 1000,         # kept (small overlay)
        "contour_map_clean_b64": "B" * 1000,       # kept (small overlay)
    }
    survey.update(extra)
    return survey


# ===========================================================================
# The happy path: create, then fetch
# ===========================================================================

def test_create_and_fetch_roundtrip():
    c = _client()
    body = {"survey": _tiny_survey(),
            "parcel": {"apn": "1234-56", "owner": "Test Owner"},
            "vertices": [{"lat": 39.0, "lon": -104.0},
                         {"lat": 39.001, "lon": -104.0},
                         {"lat": 39.001, "lon": -104.001}],
            "title": "My test parcel"}
    r = c.post("/reports", json=body)
    assert r.status_code == 200, r.text
    made = r.json()

    # The response promises exactly these four things. edit_token is the
    # key that lets the creator come back and fix the wording later.
    assert set(made) == {"slug", "url_path", "created_at", "edit_token"}
    assert len(made["slug"]) == 8, made["slug"]
    assert made["url_path"] == f"/r/{made['slug']}"

    # Now fetch it back like an anonymous visitor would.
    r2 = c.get(f"/reports/{made['slug']}")
    assert r2.status_code == 200, r2.text
    got = r2.json()
    assert got["slug"] == made["slug"]
    assert got["title"] == "My test parcel"
    assert got["created_at"] == made["created_at"]
    # The honesty banner must always ride along.
    assert "uncertified" in got["disclaimer"].lower()
    # Parcel and polygon survived the trip.
    assert got["snapshot"]["parcel"]["apn"] == "1234-56"
    assert len(got["snapshot"]["vertices"]) == 3
    # And the numbers did too.
    assert got["snapshot"]["survey"]["avg_slope"]["value"] == 3.2


def test_edit_token_is_never_public_but_lets_the_creator_edit():
    """The words are editable by the creator; the numbers never are."""
    c = _client()
    made = c.post("/reports", json={
        "survey": _tiny_survey(),
        "title": "First name",
        "site": {"name": "First name", "notes": "first notes",
                 "place": {"county": "Jefferson County", "state": "Colorado"}},
    }).json()
    slug = made["slug"]

    # A reader must never see the edit key.
    public = c.get(f"/reports/{slug}").json()
    assert "edit_token" not in public["snapshot"]
    assert public["snapshot"]["site"]["notes"] == "first notes"
    assert public["snapshot"]["site"]["place"]["state"] == "Colorado"

    # A wrong key is refused.
    bad = c.patch(f"/reports/{slug}", json={"edit_token": "not-the-key",
                                            "title": "Hijacked"})
    assert bad.status_code == 403, bad.text

    # The real key rewrites the words...
    ok = c.patch(f"/reports/{slug}", json={
        "edit_token": made["edit_token"],
        "title": "Second name",
        "site": {"name": "Second name", "notes": "walked it, gate on the north side"},
    })
    assert ok.status_code == 200, ok.text

    after = c.get(f"/reports/{slug}").json()
    assert after["title"] == "Second name"
    assert after["snapshot"]["site"]["notes"].startswith("walked it")
    # ...keeps the reverse-geocoded place the editor never sent...
    assert after["snapshot"]["site"]["place"]["state"] == "Colorado"
    # ...and leaves the measurements exactly as measured.
    assert after["snapshot"]["survey"]["avg_slope"]["value"] == 3.2
    assert "edit_token" not in after["snapshot"]


def test_image_rule_strips_big_keeps_clean_overlays():
    c = _client()
    r = c.post("/reports", json={"survey": _tiny_survey()})
    assert r.status_code == 200, r.text
    slug = r.json()["slug"]
    stored = c.get(f"/reports/{slug}").json()["snapshot"]["survey"]

    # The heavyweight images must be gone...
    assert "satellite_texture_b64" not in stored
    assert "slope_map_png_b64" not in stored
    # ...but the two small clean overlays are kept (under the budget).
    assert stored["slope_map_clean_b64"] == "A" * 1000
    assert stored["contour_map_clean_b64"] == "B" * 1000


def test_image_rule_drops_overlays_over_budget():
    c = _client()
    # Make the two overlays together bigger than the 500 KB budget.
    big = R.OVERLAY_BUDGET_BYTES // 2 + 1000
    survey = _tiny_survey(slope_map_clean_b64="A" * big,
                          contour_map_clean_b64="B" * big)
    r = c.post("/reports", json={"survey": survey})
    assert r.status_code == 200, r.text
    slug = r.json()["slug"]
    stored = c.get(f"/reports/{slug}").json()["snapshot"]["survey"]

    # Over budget: the overlays are dropped too, but the numbers remain.
    assert "slope_map_clean_b64" not in stored
    assert "contour_map_clean_b64" not in stored
    assert stored["buildable_area_pct"] == 91.0


# ===========================================================================
# The unhappy paths
# ===========================================================================

def test_unknown_slug_is_a_clean_404():
    c = _client()
    r = c.get("/reports/nope1234")
    assert r.status_code == 404, r.text
    assert "no report found" in r.json()["detail"].lower()


def test_oversize_report_is_rejected():
    c = _client()
    # A survey bigger than the ~2 MB request cap must be turned away
    # with a 413 (the HTTP code for "payload too large").
    survey = _tiny_survey(dem_grid="X" * (R.MAX_REQUEST_BYTES + 1000))
    r = c.post("/reports", json={"survey": survey})
    assert r.status_code == 413, r.text
    assert "too large" in r.json()["detail"].lower()


def test_rate_limit_triggers_with_honest_message():
    c = _client()
    body = {"survey": {"source": "tiny"}}
    # The first RATE_LIMIT_MAX posts from one IP must all succeed...
    for i in range(R.RATE_LIMIT_MAX):
        r = c.post("/reports", json=body)
        assert r.status_code == 200, f"post {i} failed: {r.text}"
    # ...and the very next one must be politely refused.
    r = c.post("/reports", json=body)
    assert r.status_code == 429, r.text
    detail = r.json()["detail"].lower()
    assert "hour" in detail and "free" in detail


def test_shared_report_link_has_a_preview():
    """A shared link must describe itself when pasted somewhere.

    Chat apps and mail clients read Open Graph tags out of the HTML; they
    do not run JavaScript, so a single-page app shows nothing unless the
    server fills those tags in. This checks the server does, and that an
    unknown slug still returns the normal app instead of an error.
    """
    from fastapi.testclient import TestClient
    from api.server import app as real_app

    # This test drives the REAL app (the preview lives in the static
    # serving layer, not in the router), so give it the same clean slate
    # _client() gives the others: fresh store, no rate-limit history.
    R._store = R.MemoryReportStore()
    R._rate_hits.clear()
    c = TestClient(real_app)
    made = c.post("/reports", json={
        "survey": {"source": "USGS 3DEP",
                   "score": {"value": 63, "verdict": "caution",
                             "headline_reason": "Flood zone on part of the site."}},
        "title": "Smith parcel",
        "site": {"name": "Smith parcel",
                 "place": {"county": "Travis County", "state": "Texas"}},
    }).json()

    html = c.get(f"/r/{made['slug']}").text
    assert "Smith parcel" in html, "the site name must be in the page head"
    assert "og:description" in html
    assert "Travis County, Texas" in html, "a reader should see WHERE it is"
    assert "63" in html, "the score belongs in the preview"
    # The edit key must not leak into a public page.
    assert made["edit_token"] not in html

    # An unknown slug is not an error: the app loads and shows its own
    # friendly not-found screen.
    assert c.get("/r/nosuchslug").status_code == 200


def test_server_app_includes_report_routes():
    # Wiring check: the real app in api/server.py must expose both routes.
    from api.server import app as real_app
    paths = {route.path for route in real_app.routes}
    assert "/reports" in paths, paths
    assert "/reports/{slug}" in paths, paths


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed}/{passed + failed} tests passed")
    if failed:
        sys.exit(1)
