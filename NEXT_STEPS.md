# NEXT STEPS — your roadmap in Claude Code

You have a working free-tier pipeline already. Here's how to grow it,
in the order that keeps you learning gradually and never stuck.

## First: get it running on your own machine

```bash
cd terrameasure
python -m venv venv              # make an isolated environment
source venv/bin/activate         # (on Windows: venv\Scripts\activate)
pip install -r requirements.txt
python demo.py                   # should print measurements from real terrain
```

If `demo.py` prints numbers, everything works. That's your green baseline.

---

## What's already built and working

- `engine/measurements.py` — area, perimeter, distance, slope, volume,
  elevation profile. Every result carries an error estimate. **Tested.**
- `fetchers/dem_source.py` — pulls a real elevation grid for any lat/lon
  from a free public API. **Tested against real Colorado terrain.**
- `demo.py` — ties them together end to end. **Tested.**

---

## Phase 1 — finish the free tier (do these next, in order)

Each of these is a good "ask Claude Code to help me with..." task:

1. **Better US data.** Swap Open-Elevation for USGS 3DEP (1-meter data in
   much of the US). This needs the `rasterio` library to read GeoTIFF files.
   Big accuracy jump. Keep Open-Elevation as the global fallback.

2. **Contour lines.** Add a `contours()` function to the engine using
   matplotlib's contour feature. This is the classic "topo map" look.

3. **Draw a picture.** Make a function that saves a colored slope map and
   contour image as a PNG, so results aren't just numbers.

4. **A tiny web API.** Add `api/server.py` with FastAPI: one endpoint that
   takes a lat/lon + size and returns the measurements as JSON.

5. **A map in the browser.** A simple `web/index.html` using Leaflet where
   you click a point or draw a box, and it calls your API.

After step 5 you have a clickable free-tier product. That's the founder demo.

---

## Phase 2 — the premium tier (later, harder)

The seam is already there: `fetchers/dem_source.py` has a `PhotoFetcher`
class waiting to be filled in. Filling it means turning uploaded photos into
a DEM using **Structure-from-Motion** (the COLMAP tool is the standard).
It returns the same `DEMResult`, so the engine and API DON'T CHANGE.

Don't start this until the free tier is solid. It's the hardest part.

---

## Phase 3 and beyond

- Water / shoreline detection (land-only for now, but the code won't fight you)
- User accounts + billing (the free vs premium split)
- Accuracy validation: measure a few known sites, compare to ground truth,
  publish the error numbers. This is what makes surveyors trust it.

---

## Two rules to keep the project healthy

1. **Keep `demo.py` green.** If a change breaks it, fix that before moving on.
2. **Never return a bare number.** Every measurement keeps its error estimate.
   That honesty is the entire credibility of a surveying tool.
