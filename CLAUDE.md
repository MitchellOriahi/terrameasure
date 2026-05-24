# CLAUDE.md — project briefing for Claude Code

> Claude Code reads this file automatically at the start of every session.
> It is the standing context for this project. Keep it updated as things change.

## Who you're working with

The developer is a **beginner** who codes in **Python, C, and Java**, and learns
**gradually** — they understand concepts best when things are explained step by
step, with plain-language comments and one idea at a time. Do not assume prior
knowledge of geospatial work, web servers, or 3D reconstruction. When you write
code, comment it the way the existing files are commented: heavy, friendly,
explaining the "why," not just the "what." When introducing a new library or
concept, briefly say what it is and why it's the right tool before using it.

Match this style. Don't dump 500 lines at once. Build in small, runnable steps
and let them understand each before moving on.

## What this project is

**TerraMeasure** — software-only land surveying/measurement. No physical
equipment. The goal that matters most: **reduce land-surveying labor.** Get
someone 90% of the answer in minutes, free, instead of waiting weeks and paying
thousands for a preliminary assessment.

It is **NOT** a certified-survey replacement. Outputs are *preliminary and
uncertified*. A licensed Professional Land Surveyor (PLS) must seal real
surveys. We make the surveyor faster; we don't replace them. It will **not**
hit the ±2cm survey-grade tolerance — accuracy is capped by source data.

## The core idea everything rests on: the DEM

A **DEM (Digital Elevation Model)** is a 2D grid of numbers; each cell is the
ground height at that spot. Every measurement is just math on that grid:
area = counting cells, slope = how fast heights change, volume = comparing two
grids, contours = connecting equal-height cells. **Get a DEM, then do arithmetic.**

## The architecture (two tiers, ONE engine)

```
   FREE TIER (built)            PREMIUM TIER (Phase 2, not built)
 pick location on map          upload photos / video
        |                              |
 fetch public elevation        reconstruct 3D (Structure-from-Motion)
        |                              |
        +--------------+---------------+
                       v
              SHARED MEASUREMENT ENGINE  (engine/measurements.py)
        (area . distance . slope . volume . contours)
                       v
              results + accuracy report
```

Both tiers return the SAME object: a `DEMResult`. The engine never asks where
the DEM came from. **This is the key design rule — never break this seam.**
Write measurement logic once; both tiers use it.

## Decisions already made (don't relitigate without being asked)

- Free tier = location-based public data. Premium tier = photo-based 3D.
- Build free tier FULLY first, then premium. (Free tier is the easy way to get
  a DEM, so it lets us build and TEST the engine before the hard photo path.)
- v1 is **land-only**. Water/shoreline is later, but keep code water-ready.
- Deep/murky water depth is OUT OF SCOPE — it needs sonar (equipment). Physics,
  not code, is the blocker. Don't try to solve it in software.
- Mixed audience (surveyors, contractors, backyard users): UI defaults simple,
  keeps precise numbers + error bounds available for pros.

## What's built and TESTED (green baseline)

- `engine/measurements.py` — area, perimeter, distance, slope, volume_to_grade
  (cut/fill), elevation_profile. Every result is a `Measurement` carrying an
  error estimate. **6/6 tests pass.**
- `fetchers/dem_source.py` — `DEMFetcher` interface + `OpenElevationFetcher`
  (free, global, ~5m error). `PhotoFetcher` is a stub for Phase 2. All return
  `DEMResult`. Verified against real Colorado terrain.
- `demo.py` — full free-tier pipeline end to end. Keep this GREEN.
- `tests/test_measurements.py` — correctness checks against hand-verifiable
  shapes (3-4-5 triangle, flat ground = 0 slope, cut==fill at mean height).

## Build order (Phase 1 = finish free tier, in this order)

1. USGS 3DEP fetcher (1m US data via `rasterio` + GeoTIFF). Big accuracy jump.
   Keep Open-Elevation as global fallback. Same `DEMResult` out.
2. `contours()` in the engine (matplotlib). Classic topo-map output.
3. PNG output: colored slope map + contour image.
4. `api/server.py` with FastAPI: one endpoint, lat/lon + size in, JSON out.
5. `web/index.html` with Leaflet: click/draw on a map, calls the API.

Phase 2 = fill in `PhotoFetcher` using Structure-from-Motion (COLMAP). Same
`DEMResult`, so engine + API don't change. Don't start until free tier is solid.

Phase 3+ = water/shoreline, accounts + billing (free vs premium split),
accuracy validation against known sites (publish the error numbers — this is
what earns surveyor trust).

## Two unbreakable rules

1. **Keep `demo.py` green.** If a change breaks it, fix that first.
2. **Never return a bare number.** Every measurement carries its error estimate.
   That honesty IS the credibility of a surveying tool.

## Known weak spot (be honest about it)

The error formulas in `measurements.py` are reasonable approximations, NOT
rigorous survey-grade error propagation. Fine for now; flag it as a known
choice, not a hidden gap. A geodesy advisor would eventually tighten this.

## How to run

```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python demo.py                 # should print measurements from real terrain
python tests/test_measurements.py   # should print 6/6 passed
```
