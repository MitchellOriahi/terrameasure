"""
tests/test_context.py
=====================
Tests for the water-aware pieces: context layers, scoring, and parcels.

Almost everything here runs OFFLINE, using synthetic geometry and fake
service responses, so the suite stays green on a plane. The handful of
live-network checks only run when you opt in:

Run offline (default):    python tests/test_context.py
Run with live checks:     set TERRA_LIVE_TESTS=1 first (Windows:
                          $env:TERRA_LIVE_TESTS='1' in PowerShell)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

from fetchers import context_layers as C
from fetchers.parcel_fetcher import CountyArcGISParcelSource
from engine import scoring


# A tiny stand-in for DEMResult: scoring only needs .heights.
class FakeDEM:
    def __init__(self, heights):
        self.heights = heights


def _square_latlon(lat=39.0, lon=-104.0, half_m=500):
    """A square polygon around a point, as [[lat, lon], ...]."""
    dlat = half_m / C.M_PER_DEG_LAT
    dlon = half_m / (C.M_PER_DEG_LAT * 0.777)  # cos(39 deg) ~ 0.777
    return [[lat - dlat, lon - dlon], [lat - dlat, lon + dlon],
            [lat + dlat, lon + dlon], [lat + dlat, lon - dlon]]


# ===========================================================================
# Geometry math (pure, offline)
# ===========================================================================

def test_coverage_fraction_half_overlap():
    # Site: a 1000m square. Feature: a polygon covering its western half.
    # The coverage fraction must come out ~0.5.
    site = _square_latlon()
    lats = [p[0] for p in site]
    lons = [p[1] for p in site]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    mid_lon = (min_lon + max_lon) / 2
    # esri geometry rings are [lon, lat] order
    half_ring = [[min_lon, min_lat], [mid_lon, min_lat],
                 [mid_lon, max_lat], [min_lon, max_lat], [min_lon, min_lat]]
    features = [{"attributes": {}, "geometry": {"rings": [half_ring]}}]
    frac = C.coverage_fraction(site, features)
    assert frac is not None and abs(frac - 0.5) < 0.02, f"got {frac}"


def test_coverage_fraction_no_geometry_is_unknown():
    # Features without usable geometry -> None (unknown), never a fake 0.
    site = _square_latlon()
    features = [{"attributes": {"FLD_ZONE": "AE"}, "geometry": {}}]
    assert C.coverage_fraction(site, features) is None


def test_arcgis_query_network_failure_is_honest():
    # Nothing listens on this port, so the request fails instantly.
    # The helper must say ok=False with a reason, never crash or fake data.
    result = C.arcgis_query("http://127.0.0.1:9/query",
                            _square_latlon(), timeout=1)
    assert result["ok"] is False
    assert result["features"] == []
    assert result["error"]


def test_check_functions_survive_dead_server(monkeypatch=None):
    # Point every check at a dead server: each must return "unavailable"
    # with a warning note, not crash and not report "all clear".
    real_urls = (C.WETLANDS_URL, C.WATER_URL, C.FLOOD_URL)
    dead = "http://127.0.0.1:9/query"
    C.WETLANDS_URL = C.WATER_URL = C.FLOOD_URL = dead
    try:
        poly = _square_latlon()
        for check in (C.check_wetlands, C.check_water, C.check_flood):
            r = check(poly)
            assert r["status"] == "unavailable", f"{check.__name__}: {r}"
            assert "unknown" in r["note"].lower()
        wf = C.water_fraction(poly)
        assert wf["status"] == "unavailable" and wf["fraction"] is None
    finally:
        C.WETLANDS_URL, C.WATER_URL, C.FLOOD_URL = real_urls


# ===========================================================================
# Scoring (pure, offline)
# ===========================================================================

def _dry_context():
    """A context dict saying: no water, no wetlands, no flood zone."""
    return {
        "wetlands": {"status": "ok", "coverage_fraction": 0.0,
                     "open_water_fraction": 0.0, "wetland_types": []},
        "water": {"status": "ok", "coverage_fraction": 0.0, "waterbodies": []},
        "flood": {"status": "ok", "in_high_risk_zone": False,
                  "high_risk_fraction": 0.0, "zones": []},
        "open_water_fraction": 0.0,
        "note": "test",
    }


def test_flat_dry_site_scores_go():
    flat = FakeDEM(np.full((20, 20), 100.0))
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0},
                           _dry_context())
    # Hand arithmetic on the recalibrated scale:
    #   baseline 50 + slope<3deg +20 + relief<10m +8
    #   + buildable (100-50)*0.3 = +15   -> 93
    assert s["value"] == 93, s
    assert s["verdict"] == "go", s
    assert s["label"] == "Favorable", s   # new one-word verdict vocabulary
    assert any(b["factor"] == "open water" for b in s["breakdown"])
    # No negative factors on a perfect site, so the headline says so.
    assert "no significant negative" in s["headline_reason"].lower(), s


def test_lake_site_craters_to_no_go():
    # THE bug this release exists to fix: flat open water used to score 100.
    # 90% open water must score at most 10 and be an explicit no-go.
    flat = FakeDEM(np.full((20, 20), 176.0))   # Lake Michigan is flat
    ctx = _dry_context()
    ctx["open_water_fraction"] = 0.9
    ctx["water"]["coverage_fraction"] = 0.9
    s = scoring.site_score(flat, {"avg_slope_deg": 0.0,
                                  "buildable_area_pct": 100.0}, ctx)
    assert s["value"] <= 10, s
    assert s["verdict"] == "no-go", s
    # And the buildable % can no longer claim the lake is buildable.
    assert s["buildable_area_pct"] <= 10.0, s


def test_wetland_site_is_penalized():
    flat = FakeDEM(np.full((20, 20), 3.0))
    ctx = _dry_context()
    ctx["wetlands"]["coverage_fraction"] = 0.7
    dry = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                    "buildable_area_pct": 100.0},
                             _dry_context())
    wet = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                    "buildable_area_pct": 100.0}, ctx)
    # Hand arithmetic: terrain 93 (see the dry test), wetland penalty
    # 6 pts per 10% x 70% = 42 -> 51, then 70% >= 60% no-go line applies
    # the hard cap of 30. So dry = 93 and wet = 30.
    assert dry["value"] == 93, dry
    assert wet["value"] == 30, wet
    assert wet["verdict"] == "no-go"    # 70% wetland is past the no-go line
    assert wet["label"] == "Not recommended", wet


def test_flood_zone_forces_caution():
    flat = FakeDEM(np.full((20, 20), 10.0))
    ctx = _dry_context()
    ctx["flood"] = {"status": "ok", "in_high_risk_zone": True,
                    "high_risk_fraction": 0.8,
                    "zones": [{"zone": "AE", "subtype": None,
                               "high_risk": True}]}
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0}, ctx)
    assert s["verdict"] in ("caution", "no-go"), s
    flood_items = [b for b in s["breakdown"] if b["factor"] == "flood zone"]
    assert flood_items and flood_items[0]["effect"].startswith("-")


def test_wetlands_below_threshold_still_named_in_breakdown():
    # The CEO's contradiction: risk flags said "8% wetland coverage" while
    # the breakdown said "no significant mapped wetlands". One source of
    # truth now: below-threshold coverage is NAMED, with the threshold.
    flat = FakeDEM(np.full((20, 20), 100.0))
    ctx = _dry_context()
    ctx["wetlands"]["coverage_fraction"] = 0.04    # 4%: below the 5% line
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0}, ctx)
    wet_line = [b for b in s["breakdown"] if b["factor"] == "wetlands"][0]
    assert wet_line["effect"] == "0", wet_line
    assert "4%" in wet_line["note"], wet_line
    assert "below" in wet_line["note"].lower(), wet_line
    assert "threshold" in wet_line["note"].lower(), wet_line


def test_wetlands_above_5pct_always_cost_points():
    # Weight-table coherence: 8% wetland coverage must cost points even
    # when part of it overlaps open water (the old veg-only subtraction
    # let 8% wetlands score 0 while 7% open water scored -6).
    flat = FakeDEM(np.full((20, 20), 100.0))
    ctx = _dry_context()
    ctx["wetlands"]["coverage_fraction"] = 0.08
    ctx["open_water_fraction"] = 0.06
    ctx["water"]["coverage_fraction"] = 0.06
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0}, ctx)
    wet_line = [b for b in s["breakdown"] if b["factor"] == "wetlands"][0]
    # 6 pts per 10% x 8% = 4.8 -> rounds to -5.
    assert wet_line["effect"] == "-5", wet_line
    water_line = [b for b in s["breakdown"] if b["factor"] == "open water"][0]
    # 8 pts per 10% x 6% = 4.8 -> rounds to -5. Coherent with wetlands.
    assert water_line["effect"] == "-5", water_line


def test_verdict_vocabulary_and_spread():
    # Bad terrain must actually score BADLY now (the old 72 baseline
    # squeezed everything into 70-90). Hand arithmetic:
    #   50 - 30 (slope > 25 deg) - 20 (relief > 100 m)
    #      - 14 (buildable 5%: round((5-50)*0.3) = -14)  = -14 -> clamps to 0
    steep = FakeDEM(np.array([[0.0, 150.0], [0.0, 150.0]]))
    s = scoring.site_score(steep, {"avg_slope_deg": 30.0,
                                   "buildable_area_pct": 5.0},
                           _dry_context())
    assert s["value"] == 0, s
    assert s["verdict"] == "no-go", s
    assert s["label"] == "Not recommended", s
    # The headline reason is the single worst factor (slope, -30).
    assert "slope" in s["headline_reason"].lower(), s


def test_headline_reason_names_worst_factor():
    # A flood-hit site: the flood line is the biggest negative, so the
    # headline sentence must come from it.
    flat = FakeDEM(np.full((20, 20), 10.0))
    ctx = _dry_context()
    ctx["flood"] = {"status": "ok", "in_high_risk_zone": True,
                    "high_risk_fraction": 0.8,
                    "zones": [{"zone": "AE", "subtype": None,
                               "high_risk": True}]}
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0}, ctx)
    assert "flood" in s["headline_reason"].lower(), s
    # One sentence, headline-sized.
    assert s["headline_reason"].count(".") <= 1, s["headline_reason"]


def test_flood_zones_deduped_and_sorted_high_risk_first():
    # check_flood must collapse duplicate (zone, subtype) pairs, treating
    # "" and null subtypes as the same, and list high-risk zones first.
    # We fake the server response, so this runs offline.
    real = C.arcgis_query

    def fake_query(url, polygon_latlon=None, **kw):
        feats = [
            # Zone X twice: once with subtype "", once with null. Same zone.
            {"attributes": {"FLD_ZONE": "X", "ZONE_SUBTY": "",
                            "SFHA_TF": "F"}, "geometry": {}},
            {"attributes": {"FLD_ZONE": "X", "ZONE_SUBTY": None,
                            "SFHA_TF": "F"}, "geometry": {}},
            # Zone AE twice as well, listed AFTER X on purpose.
            {"attributes": {"FLD_ZONE": "AE", "ZONE_SUBTY": None,
                            "SFHA_TF": "T"}, "geometry": {}},
            {"attributes": {"FLD_ZONE": "AE", "ZONE_SUBTY": "",
                            "SFHA_TF": "T"}, "geometry": {}},
        ]
        return {"ok": True, "features": feats}

    C.arcgis_query = fake_query
    try:
        r = C.check_flood(_square_latlon())
    finally:
        C.arcgis_query = real
    assert r["status"] == "ok", r
    # Two zones survive (deduped), high-risk AE sorted ahead of X.
    assert [z["zone"] for z in r["zones"]] == ["AE", "X"], r["zones"]
    assert r["zones"][0]["high_risk"] is True
    # Every context source now states its data vintage honestly.
    assert "data_vintage" in r and r["data_vintage"], r


def test_context_results_carry_data_vintage_when_unavailable():
    # Even when a source is down, the vintage note rides along so the UI
    # can always show it.
    real_urls = (C.WETLANDS_URL, C.WATER_URL, C.FLOOD_URL)
    dead = "http://127.0.0.1:9/query"
    C.WETLANDS_URL = C.WATER_URL = C.FLOOD_URL = dead
    try:
        poly = _square_latlon()
        for check in (C.check_wetlands, C.check_water, C.check_flood):
            r = check(poly)
            assert "data_vintage" in r and r["data_vintage"], check.__name__
    finally:
        C.WETLANDS_URL, C.WATER_URL, C.FLOOD_URL = real_urls


def test_unavailable_context_is_noted_not_penalized():
    # If we could not check, the score must SAY so, and must not invent
    # penalties for hazards nobody confirmed.
    flat = FakeDEM(np.full((20, 20), 100.0))
    ctx = {
        "wetlands": {"status": "unavailable"},
        "water": {"status": "unavailable"},
        "flood": {"status": "unavailable"},
        "open_water_fraction": None,
        "note": "test",
    }
    s = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                  "buildable_area_pct": 100.0}, ctx)
    notes = " ".join(b["note"].lower() for b in s["breakdown"])
    assert "unavailable" in notes or "unknown" in notes
    # Same score as a terrain-only run: unknown is not a penalty.
    terrain_only = scoring.site_score(flat, {"avg_slope_deg": 1.0,
                                             "buildable_area_pct": 100.0},
                                      None)
    assert s["value"] == terrain_only["value"]


def test_score_has_verdict_label_and_breakdown():
    # The response contract the UI depends on (now including the
    # headline_reason sentence and the not_checked scope strip).
    flat = FakeDEM(np.full((5, 5), 100.0))
    s = scoring.site_score(flat, {"avg_slope_deg": 5.0,
                                  "buildable_area_pct": 80.0}, None)
    assert set(s) >= {"value", "verdict", "label", "breakdown",
                      "buildable_area_pct", "note",
                      "headline_reason", "not_checked"}
    assert s["verdict"] in ("go", "caution", "no-go")
    # Labels are the one-word verdict vocabulary, nothing else.
    assert s["label"] in ("Favorable", "Proceed with conditions",
                          "Not recommended"), s
    assert isinstance(s["headline_reason"], str) and s["headline_reason"]
    # The scope strip: four named things this score does NOT evaluate.
    assert len(s["not_checked"]) == 4, s["not_checked"]
    assert "Zoning and land-use restrictions" in s["not_checked"]
    for item in s["breakdown"]:
        assert set(item) >= {"factor", "effect", "note"}


def test_earthwork_cost_is_a_range_with_caveat():
    c = scoring.earthwork_cost(cut_m3=1000, fill_m3=500)
    # Hand arithmetic for the fixed no-double-count model:
    #   balanced = min(1000, 500) = 500 m3, priced ONCE at $13/m3 = 6500
    #   net imbalance = |1000 - 500| = 500 m3 at $16/m3 haul     = 8000
    #   base = 6500 + 8000 = 14500
    # (The old model charged 1000*18 + 500*14 = 25000, pricing the same
    # balanced dirt twice.)
    assert c["base_usd"] == 14500, c
    assert c["balanced_m3"] == 500 and c["net_m3"] == 500, c
    assert c["scope"] == "theoretical full-site balance", c
    assert c["low_usd"] < c["base_usd"] < c["high_usd"]
    # low/high = 0.75x / 1.6x, i.e. the stated -25%/+60% spread.
    assert c["low_usd"] == round(14500 * 0.75)
    assert c["high_usd"] == round(14500 * 1.6)
    assert "rough" in c["note"].lower()
    assert "-25%/+60%" in c["note"]


def test_earthwork_pad_cost_is_realistic_slice():
    # A 30-acre parcel (~121,406 m2), fully balanced dirt.
    # Pad area = max(2000, 5% of 121406 = 6070.3) = 6070.3 m2.
    # Pad share = 6070.3 / 121406 = exactly 0.05, so the pad base is
    # 5% of the full-site base: 20000*13 = 260000 -> pad 13000.
    c = scoring.earthwork_cost(cut_m3=20000, fill_m3=20000,
                               site_area_m2=121406)
    assert c["base_usd"] == 260000, c
    pad = c["pad_cost"]
    assert pad["base_usd"] == 13000, pad
    assert pad["pad_area_m2"] == 6070, pad
    assert pad["base_usd"] < c["base_usd"]
    # On a tiny site the pad is capped at the site itself:
    # pad_area = min(1500, max(2000, 75)) = 1500 -> pad == full site cost.
    small = scoring.earthwork_cost(cut_m3=100, fill_m3=100,
                                   site_area_m2=1500)
    assert small["pad_cost"]["pad_area_m2"] == 1500, small
    assert small["pad_cost"]["base_usd"] == small["base_usd"], small


def test_buildable_pct_masked_excludes_water():
    # A perfectly flat DEM is 100% "buildable" by slope, but if half the
    # cells are water the masked version must report ~50%.
    dem = np.full((10, 10), 5.0)
    mask = np.zeros((10, 10), dtype=bool)
    mask[:, :5] = True                     # western half is water
    pct = scoring.buildable_area_pct_masked(dem, 1.0, water_mask=mask)
    assert abs(pct - 50.0) < 1.0, pct
    # Scalar-fraction flavor should agree.
    pct2 = scoring.buildable_area_pct_masked(dem, 1.0, water_fraction=0.5)
    assert abs(pct2 - 50.0) < 1.0, pct2


# ===========================================================================
# Parcels (offline paths)
# ===========================================================================

def test_parcel_no_coverage_is_clean():
    # Rural Kansas is in no pilot county: instant, offline, honest answer.
    p = CountyArcGISParcelSource().get_parcel(38.5, -98.5)
    assert p["status"] == "no_coverage"
    assert p["parcel_id"] is None
    assert "note" in p and p["note"]


def test_parcel_dead_server_is_unavailable():
    # A county whose server cannot be reached must yield "unavailable",
    # never a silent empty "ok".
    registry = [{
        "county": "Test County",
        "url": "http://127.0.0.1:9/query",
        "bbox": (0.0, 0.0, 1.0, 1.0),
        "fields": {k: None for k in
                   ("parcel_id", "owner", "address", "acreage", "land_use",
                    "zoning", "assessed_value", "last_sale_price",
                    "last_sale_date")},
        "field_note": "test",
    }]
    p = CountyArcGISParcelSource(registry, timeout=1).get_parcel(0.5, 0.5)
    assert p["status"] == "unavailable", p
    assert "unknown" in p["note"].lower()


# ===========================================================================
# Live-network checks (opt in with TERRA_LIVE_TESTS=1)
# ===========================================================================

LIVE = os.environ.get("TERRA_LIVE_TESTS") == "1"


def test_live_lake_michigan_is_water():
    if not LIVE:
        print("   (skipped: set TERRA_LIVE_TESTS=1 to run live checks)")
        return
    poly = _square_latlon(lat=43.5, lon=-87.2)
    wf = C.water_fraction(poly)
    assert wf["status"] == "ok" and wf["fraction"] > 0.95, wf


def test_live_dry_colorado_is_clear():
    if not LIVE:
        print("   (skipped: set TERRA_LIVE_TESTS=1 to run live checks)")
        return
    poly = _square_latlon(lat=39.05, lon=-104.4)
    wf = C.water_fraction(poly)
    assert wf["status"] == "ok" and wf["fraction"] < 0.05, wf


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
