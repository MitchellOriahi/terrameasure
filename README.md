# TerraMeasure

Software-only land measurement. No equipment required.

---

## What this is (and what it is NOT)

**IS:** A tool that produces *preliminary, uncertified* land measurements — area,
distance, slope, elevation profiles, contour lines, and cut/fill volume — from
data that already exists in the world (free public elevation data) or from
photos a user takes.

**IS NOT:** A replacement for a licensed survey. The numbers here are good enough
for decisions, planning, and first drafts. They are **not** legally sealed
surveys. A licensed Professional Land Surveyor (PLS) must seal real surveys.
We make the surveyor faster; we do not replace them.

---

## The one idea everything rests on: the DEM

A **DEM (Digital Elevation Model)** is just a big grid of numbers. Each cell in
the grid holds the ground height at that spot. Picture a spreadsheet laid over
the landscape — every cell says "here the ground is 142.3 meters above sea level."

Almost every measurement a surveyor cares about is just math on that grid:

| Measurement      | What it really is                                          |
|------------------|------------------------------------------------------------|
| Area             | Count the cells inside a shape, times cell size            |
| Distance         | Geometry between two points                                |
| Slope            | How fast the height changes between neighbor cells          |
| Volume (cut/fill)| Compare two grids, sum the differences                     |
| Contour lines    | Connect every cell at the same height                      |

So the whole product is: **(1) get a DEM, then (2) do arithmetic on it.**

---

## The two tiers, one engine

```
        FREE TIER                    PREMIUM TIER
   pick location on map         upload photos / video
            |                            |
   fetch public elevation       reconstruct 3D model
     (USGS 3DEP, etc.)           (Structure-from-Motion)
            |                            |
            +-------------+--------------+
                          |
                          v
                 SHARED MEASUREMENT ENGINE   <-- engine/
          (area . distance . slope . volume . contours)
                          |
                          v
                 results + accuracy report
```

Both tiers produce a DEM. The measurement engine does not care where the DEM
came from. **Write the measurement code once; both tiers use it.**

---

## Folder layout

```
terrameasure/
  engine/      <- THE measurement math. Tier-independent. Build this first.
  fetchers/    <- gets a DEM from somewhere (free tier = public data)
  api/         <- the web server that ties it together (later)
  web/         <- the map UI in the browser (later)
  tests/       <- prove the measurements are correct
  data/        <- sample elevation files for testing
```

---

## Build order (do them in this order)

1. **Free tier** — location -> public DEM -> measurements.
   This is where the shared engine gets built and proven.
2. **Premium tier** — photos -> reconstructed DEM -> the *same* measurements.
3. **Later** — water/shoreline, billing/accounts, certified-deliverable workflow.

Why this order: the free tier is the easy way to get a DEM, so it lets you
build and TEST the measurement engine against known locations. Once the engine
is trusted, the hard photo path just feeds the same trusted engine.

---

## Honest limits to keep telling the founder

- Accuracy is capped by the public data resolution (often ~1 meter grid in the
  US, coarser elsewhere). This will NOT hit the +/-2cm survey-grade target.
- Coverage is great in the US, patchy globally.
- Deep or murky water depth cannot be measured by software alone — that needs
  sonar, which is equipment. Out of scope.
- Every output must carry an accuracy estimate. That honesty is the product.
