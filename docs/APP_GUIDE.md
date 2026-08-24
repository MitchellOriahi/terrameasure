# TerraMeasure: the complete guide

What this app is, what every screen and every button does, where the
numbers come from, how to run it, and what it deliberately refuses to
claim. Written for someone who has never seen the codebase.

Last updated: August 2026.

---

## 1. The one-paragraph version

TerraMeasure answers one question about a piece of land: **is it worth
your time?** You draw a boundary on a map (or tap a parcel where we have
county records), and about a minute later you get a verdict, a score out
of 100, the slope and buildable area, wetland and flood findings from
federal data, a cut-and-fill earthwork cost range in dollars, a 3D model
of the ground, and a link you can send to anyone. It costs nothing and
needs no account.

It is **not a legal survey**. Nothing here can be recorded or sealed. A
licensed Professional Land Surveyor does that. Our job is to tell you
whether hiring one is worth it, and to hand them a head start when it is.

---

## 2. Who it is for

| Person | What they use it for |
| --- | --- |
| Land buyer | Screen twenty listings in an evening instead of driving to three. |
| Real estate agent | Answer "is this buildable?" on the phone, with a shareable link. |
| Builder or contractor | Get an earthwork order of magnitude before bidding. |
| Licensed surveyor | Decide go or no-go before mobilising, and log what they really measured on site (Ground Truth) so the model improves. |
| Anyone with a backyard project | Find out how much dirt a pad would cost to level. |

---

## 3. The idea everything rests on: the DEM

A **DEM (Digital Elevation Model)** is a grid of numbers. Each cell is
the height of the ground at that spot. Every measurement in this product
is arithmetic on that grid:

- **Area** is counting cells inside your outline.
- **Slope** is how fast heights change between neighbouring cells.
- **Cut and fill** is comparing the grid to a flat plane.
- **Contours** are lines through cells of equal height.
- **The 3D model** is the grid drawn as a surface.

So the whole product is: *get a DEM, then do arithmetic, then be honest
about the error.*

**Row order matters.** Everywhere in this codebase, row 0 of a DEM is
the NORTHERNMOST row, like a GeoTIFF. The polygon trim, the PNG
overlays, the map pinning and the 3D model all assume it.
`tests/test_dem_orientation.py` locks that down.

---

## 4. Architecture in one picture

```
   FREE TIER (built)                PREMIUM TIER (Phase 2, not built)
 pick a location on the map        upload photos or video
        |                                    |
 fetch public elevation data       reconstruct 3D (Structure from Motion)
        |                                    |
        +------------------+-----------------+
                           v
              SHARED MEASUREMENT ENGINE (engine/measurements.py)
              area . slope . volume . contours . profile
                           v
              SCORING (engine/scoring.py) + CONTEXT (fetchers/)
                           v
              results + error bounds + verdict + cost
```

Both tiers return the same object, a `DEMResult`. The engine never asks
where the DEM came from. **That seam is the core design rule: do not
break it.** Measurement logic is written once and both tiers use it.

---

## 5. The stack

**Backend (Python)**

| File | What it does |
| --- | --- |
| `api/server.py` | FastAPI app: every HTTP endpoint, plus serving the built frontend. |
| `api/reports.py` | Shareable reports: create, read, edit, with a storage seam (Supabase in production, memory in dev). |
| `engine/measurements.py` | The maths: area, slope, volume, contours, profile, polygon masking, PNG rendering. Every result is a `Measurement` carrying an error. |
| `engine/scoring.py` | Turns measurements plus context into a 0 to 100 score, a verdict, a breakdown, and the earthwork cost model. |
| `fetchers/usgs_fetcher.py` | USGS 3DEP lidar (about 0.2 m vertical, US only). |
| `fetchers/dem_source.py` | Open-Elevation (about 5 m vertical, global fallback) and the `DEMFetcher` interface. |
| `fetchers/context_layers.py` | Wetlands (USFWS NWI), water (USGS 3DHP), flood (FEMA NFHL). |
| `fetchers/parcel_fetcher.py` | County parcel records for the five pilot counties. |
| `fetchers/photo_fetcher.py` | Phase 2 placeholder for photo-based DEMs. |

**Frontend (TypeScript)**

React 19 + Vite + MapLibre GL (via `@vis.gl/react-maplibre`) + terra-draw
+ Zustand + TanStack Query + Tailwind v4, installable as a PWA.

| Area | Files |
| --- | --- |
| Pages | `src/pages/` (Landing, Map, Report, Saved, Ground Truth, News, Auth, Profile) |
| Results panel | `src/components/results/` |
| Map | `src/components/map/` |
| Mobile chrome | `MobileBottomBar`, `Reticle*`, `CoachMarks`, `WelcomeOverlay` |
| Pure logic | `src/lib/` (api, geo, units, verdict, terrainMesh, savedSurveys, myReports, site3d, mapCamera) |
| State | `src/store/appStore.ts` (UI state), `src/store/authStore.ts` (session) |

**Deployment.** One Render web service runs FastAPI, which also serves
`frontend/dist` at the root (the built bundle is committed to git,
because the Python host has no Node). The old prototype still lives at
`/web/`.

---

## 6. Every screen, and every button on it

### 6.1 Landing page, `/`

The front door. Its hero holds a **live satellite map with a draggable
boundary**: drag any green corner and the acreage and perimeter recompute
in your browser (pure geometry, no server). "Survey this shape for real"
hands that exact outline to the app and runs a genuine survey on it.

Below that: a spinnable **3D model of real ground** west of Golden,
Colorado (baked at build time by `scripts/make_sample_site.py` from USGS
lidar), an example report, how it works, what is in the box, the limits,
and a FAQ.

### 6.2 The map, `/map`

The app itself. Full-screen map with floating panels.

**Top bar (desktop and mobile)**

| Control | What it does |
| --- | --- |
| Wordmark | Back to the landing page. |
| Search | Address or place search (backend proxies OpenStreetMap Nominatim). |
| Draw tools (desktop) | Polygon: tap each corner, tap the first corner to close. Rectangle: drag a box. |
| Map / Satellite | Basemap toggle (CARTO dark streets, or Esri satellite imagery). |
| Layers | Which overlays are drawn: Parcels, Wetlands, Water, Flood, Contours, Slope. |
| 3D | Tilts the whole map with real terrain elevation. |
| Menu | Saved, Ground Truth, News, Sign in or Profile. |

**Bottom bar (phones only)** because the top of a 6.7 inch screen is a
two-hand reach:

| Control | What it does |
| --- | --- |
| Layers | Same overlay sheet, as a bottom sheet. |
| Map / Satellite | Basemap toggle. |
| **Survey** (the big green one) | Starts the crosshair drawing mode. |
| Saved | Your saved surveys and share links (no account needed). |

**The crosshair (reticle) drawing mode.** Fingers are imprecise, so
instead of tapping corners you pan the map under a fixed crosshair and
press "Add corner". The tray shows the corner count, Undo, Close shape,
and Cancel. Three corners minimum.

**Tap a parcel.** When the Parcels layer is on and no draw tool is armed,
tapping the map looks up the tax parcel underneath. In a covered county
you get a card with the parcel ID, owner, acreage, zoning, land use,
assessed value and last sale, and a "Survey this parcel" button that uses
the recorded boundary. Outside those counties you get an honest
"no coverage here yet" card with a "Draw the boundary" button.

### 6.3 The results panel (the site assessment)

Appears as a right-hand panel on desktop and a bottom sheet on a phone,
top to bottom:

1. **Site identity.** The site name (tap to edit), county and state
   (reverse-geocoded), centre coordinates, acreage, parcel ID when known,
   and **Your notes**: free text that travels into any report you share.
2. **Verdict banner.** One word (GO, PROCEED WITH CONDITIONS, or NOT
   RECOMMENDED) plus one sentence naming the biggest constraint.
3. **Scope strip.** What the verdict does *not* check: zoning, septic,
   access, title, easements.
4. **Share report** (creates a public link) and **Save** (keeps it on
   this device, plus your account when signed in).
5. **View site in 3D.** Tilts the real map into an orbiting 3D view of
   this site with satellite imagery draped over the terrain.
6. **Cost.** Building pad earthwork first (the number a buyer can act
   on), with the theoretical full-site balance demoted underneath.
7. **3D site model.** The block of ground you drew, drawn in the browser
   from the elevation grid. Drag to spin, pinch or scroll to zoom, and
   the buttons in the corner are: pause or play the slow spin, cycle the
   vertical exaggeration (1x to 8x), show the mesh lines, reset the view,
   and enlarge. The caption always states the exaggeration in use.
8. **Score dial** and **Why this verdict**: every factor, what it did to
   the score, and why.
9. **Risk flags.** Wetlands, water and flood findings with their sources
   and data vintage.
10. **Measurements.** Area, perimeter, average slope, buildable area,
    elevation range, cut and fill, balance grade. Every one with its
    error bound. The units toggle (ft/yd3 or m/m3) lives in this header.
11. **Elevation profile.** Ground height along the site diagonal; tap or
    drag it for exact values.
12. **Source note and disclaimer.**

### 6.4 Shared report, `/r/{slug}`

What anyone sees when you send the link. No login. Site identity with
county and state, your notes, verdict, score, the map with your outline
drawn on it, the 3D model, cost, risk flags, measurements with error
bounds, and a sticky mini-header carrying the site name, score and a
Share button once you scroll.

Two actions sit under the header, because they are what people actually
do with a report: **Copy as text** puts the whole thing (verdict, numbers
with their bounds, notes, link) on the clipboard for an email or a text
message, and **Print or save as PDF** renders it on white paper with the
interactive parts removed and no card split across a page break.

**If your browser created the report**, an Edit button appears on the
notes block: you can rewrite the site name and notes afterwards. The
measurements can never be edited, by anyone, ever. That is enforced on
the server, not just hidden in the UI.

### 6.5 Saved, `/saved` (also `/reports`)

Two lists, both kept on your device so they work offline and without an
account:

- **Saved surveys.** Reopen re-runs the survey on the same outline with
  today's data (so a saved site is never stale). Delete removes it here.
- **Shared reports.** Open, copy the link, or remove it from this list
  (the public link keeps working).

### 6.6 Ground Truth, `/photo`

Where a surveyor logs what they actually measured on site next to what we
predicted: measured slope, elevation range, their own verdict, notes and
the visit date. This is the accuracy feedback loop, and over time it is
the part of the product nobody can copy. Needs an account and the
`ground_truth` table (see setup below); when the table is missing the
page says so plainly instead of failing.

### 6.7 News, `/news`

Land-relevant news and hazard alerts (ReliefWeb and USGS feeds), filtered
to the area you last surveyed.

### 6.8 Auth and Profile, `/auth`, `/profile`

Email and password or Google sign-in, both optional. The profile page
holds your display name, your merged saved surveys, and sign out. It is
the only route in the app with a login gate.

---

## 7. Where every number comes from

| Output | Source | Typical error |
| --- | --- | --- |
| Elevation | USGS 3DEP lidar (US), else Open-Elevation | 0.2 m, else about 5 m |
| Area and perimeter | Your drawn outline, spherical geometry | half a DEM cell along the edge |
| Slope | Gradient of the DEM | reported per survey, often 0.5 to 1.5 degrees |
| Cut and fill | DEM versus the balance grade plane | random plus systematic (see below) |
| Wetlands | USFWS National Wetlands Inventory | polygon coverage percentage |
| Open water | NWI open-water classes plus USGS 3DHP | coverage percentage |
| Flood | FEMA National Flood Hazard Layer | zone codes, high-risk fraction |
| Parcels | Five county ArcGIS servers | county record, as published |
| Place names | OpenStreetMap Nominatim | county and state |
| Imagery | Esri World Imagery | visual only, never measured |

**The correlated error model.** Lidar error is not independent from cell
to cell: a whole tile can sit 0.2 m high. Averaging it away across
thousands of cells (which is what a naive bound does) produces an
absurdly small number like plus or minus 0.7%. So volume error is
`sqrt(random^2 + systematic^2)`, where the systematic term is
`area x vertical_error x 0.6`. Real bounds land in the 10 to 40% range,
which is honest.

**The cost model.** On a balanced site you move the dirt once, so the
balanced volume is priced once at a cut-and-place rate (about $13/m3),
and only the net imbalance pays an import or export rate (about $16/m3).
The headline figure grades a **building pad** (the larger of 2,000 m2 or
5% of the site), because nobody grades a whole 112 acres to one plane.
The full-site figure is still shown, labelled as the theoretical balance
it is.

**The score.** Every site starts at a baseline of 50 and moves from
there, so scores actually spread across the range. Slope, buildable
ground, wetlands, open water and flood each have an explicit weight in
`CONTEXT_WEIGHTS`, and each can cap the score outright (open water caps
at 80, wetlands and flood at 45). Anything below a weight's threshold is
reported as "below the scoring threshold", never as zero, so the score
and the risk flags can never contradict each other.

---

## 8. The API

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/survey/polygon` | The main event: vertices in, full survey out. |
| GET | `/parcel?lat=&lon=` | Parcel record for a point (pilot counties). |
| GET | `/context?...` | Wetlands, water and flood for an area. |
| GET | `/geocode?q=` | Address search (Nominatim proxy). |
| GET | `/reverse?lat=&lon=` | County, state and place name for a point. |
| POST | `/reports` | Store a report snapshot, get a slug and an edit token. |
| GET | `/reports/{slug}` | Public read (edit token stripped). |
| PATCH | `/reports/{slug}` | Edit the words only, with the edit token. |
| GET | `/tiles/wetlands` | Image proxy for the NWI overlay (that server sends no CORS header). |
| GET | `/health` | Liveness and version. |

Every survey response carries `disclaimer`, and every measurement carries
`error`. That is not decoration; it is the product's credibility.

---

## 9. Running it locally

```bash
python -m venv venv
venv\Scripts\activate            # macOS or Linux: source venv/bin/activate
pip install -r requirements.txt

python demo.py                   # end-to-end pipeline against real terrain
python tests/test_measurements.py       # 7/7
python tests/test_context.py            # 23/23
python tests/test_reports.py            # 8/8
python tests/test_dem_orientation.py    # 2/2

venv\Scripts\python.exe -m uvicorn api.server:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173, proxies /api to :8000
npm run build                    # writes frontend/dist (COMMIT THIS)
node scripts/e2e-final.mjs       # 43-check browser regression, desktop + mobile
```

**`frontend/dist` is committed on purpose.** Render runs a Python
service with no Node, so the built bundle ships in the repository. If you
change frontend code and do not rebuild, the deploy serves the old app.

---

## 10. Optional cloud setup (Supabase)

Everything above works with no database at all. Supabase adds accounts,
cloud-synced saves and Ground Truth.

1. Open your Supabase project, SQL Editor, New query.
2. Paste **`docs/supabase_setup.sql`** and run it. It is idempotent, so
   running it twice is safe. It creates `profiles`, `surveys` and
   `ground_truth` with row-level security and a new-account trigger.
3. `docs/reports_table.sql` covers the public share links and is written
   by the backend with the service-role key.

**Keys.** The anon key in the frontend is public by design: row-level
security decides what it can touch. The service-role key exists only as
the `SUPABASE_SERVICE_ROLE` environment variable on Render and must never
appear in the repository.

If you skip all of this: saving still works (it writes to the device),
the profile name still sticks (it falls back to account metadata), and
Ground Truth explains that storage is not set up yet.

---

## 10b. When the outside world breaks

The product depends on services nobody here controls: federal elevation
and hazard servers, a place-name service, and Supabase for accounts and
share links. The rule is that an outage is explained, never disguised.

| What breaks | What the user sees | Where |
| --- | --- | --- |
| Both elevation sources down | "Survey failed: the elevation service is down", with a retry that reuses the same boundary | `api/server.py` `_fetch_dem`, `MapPage` |
| Lidar covers only part of a site | The uncovered cells are left OUT of the maths (never filled in), and the source note says what percentage was covered | `fetchers/usgs_fetcher.py` |
| Wetlands tile server down | The overlay quietly draws nothing rather than erroring per tile | `/tiles/wetlands` |
| Sign-in service unreachable | The sign-in page says so before you type a password, and the Google button refuses to redirect you to a dead host | `lib/authHealth.ts`, `AuthPage` |
| Report storage unreachable | Sharing fails with a plain explanation AND the survey is saved to your device so nothing is lost | `api/reports.py`, `ShareReport` |
| Someone hammers the API | 429 with a plain sentence saying the limit and when to retry | `api/ratelimit.py` |

`GET /health` answers with the version AND the state of report storage
(`kind`, `durable`, `last_error`), so one request tells you whether share
links actually work, not just whether the process is alive.

**Rate limits, per address, per five minutes:** 15 surveys, 150 lookups
(parcel, context, geocode, reverse). Set in `api/server.py`. They are far
above human use; they exist to stop a runaway script taking down a free
tier and to keep us welcome on the free government services.

## 10c. Moving to a different Supabase project

If the database project is ever replaced (it happened on 2026-08-07 when
the old project disappeared), three things point at it:

1. `frontend/src/lib/supabase.ts`: the URL and the anon key. Override at
   build time with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON`, then
   rebuild `frontend/dist` and commit it.
2. Render environment variables `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE` (the secret one, never in the repo).
3. Run `docs/supabase_setup.sql` and `docs/reports_table.sql` in the new
   project's SQL editor.

Check it worked with `GET /health`: `report_storage.durable` must be
true, and `last_error` must be null after a share.

## 10d. The type system

Three typefaces, each with exactly one job. Mixing them by feel is how a
page ends up looking generic, so the rule is mechanical.

| Face | Used for | Token |
| --- | --- | --- |
| Space Grotesk | Headlines, section labels, buttons, the wordmark, the verdict word | `font-display` |
| Inter | Body copy, UI text, form fields | `font-sans` (default) |
| JetBrains Mono | Numbers only: measurements, scores, coordinates | `font-mono` / the `.num` class |

All three are self-hosted through `@fontsource`, so the app carries no
external font requests and still renders correctly offline as a PWA. The
whole added weight for the display face is about 22 KB.

Section labels on the landing page carry an index (`01`, `02`, ...) and a
rule. That is not decoration: at a glance while scrolling, a numbered
label tells you where you are in a document, which a row of identical
small-caps headings does not.

## 11. Rules the codebase holds itself to

1. **Never return a bare number.** Every measurement carries its error.
2. **Keep `demo.py` green.** If a change breaks it, fix that first.
3. **Never break the DEMResult seam.** The engine must not care where the
   elevation came from.
4. **Row 0 is north.** In every grid, everywhere.
5. **Say what is missing.** Unavailable data is reported as unavailable,
   never as zero and never as "none found".
6. **Saving always works.** The device first, the cloud as a bonus.
7. **The words are editable, the numbers are not.**
8. **No em-dashes anywhere.** House style.

---

## 12. What is deliberately not built

- **Certified survey output.** Never. That needs a licensed PLS.
- **Deep or murky water depth.** That needs sonar. Physics, not code, is
  the blocker.
- **Photo-based 3D (Phase 2).** `PhotoFetcher` is a stub. It will return
  the same `DEMResult`, so the engine and API will not change.
- **Nationwide parcels.** Five pilot counties today; a commercial parcel
  API (Regrid) is the plan, and `parcel_fetcher.py` has the seam for it.
- **Zoning depth.** We show what a county publishes and nothing more.

---

## 13. Known weak spots, stated plainly

- The error model is a reasonable engineering approximation, not
  rigorous geodetic error propagation. A geodesy advisor would tighten
  it.
- Cost rates are national averages, not regional bids.
- Scoring weights are chosen and documented, not yet calibrated against a
  large sample of real sites. Ground Truth exists to fix exactly that.
- The free Render tier sleeps, so the first survey after an idle period
  can take up to about 50 seconds. The app pre-warms the server and says
  what is happening rather than showing a silent spinner.
- MapLibre v6 renders black if an animated camera move runs while 3D
  terrain is on. Every camera move in 3D mode is therefore an instant
  jump (`lib/mapCamera.ts` and `lib/site3d.ts` carry the details).

---

## 14. Keeping the marketing page honest

`frontend/scripts/capture-product.mjs` drives the real app in a real
browser, runs a real survey against the live engine, and screenshots the
result into `frontend/public/shots/`. The landing page uses those images.

That is deliberate. A mockup is a promise; a screenshot is evidence, and
this product's entire pitch is that it does not overstate things. Re-run
the script whenever the UI changes:

```bash
npm --prefix frontend run build
venv\Scripts\python.exe -m uvicorn api.server:app --port 8000   # in one shell
node frontend/scripts/capture-product.mjs                        # in another
```

Then shrink the PNGs it writes to progressive JPEGs (the script captures
at 2x and 3x for sharpness; the page wants files, not posters).

Two more scripts live beside it, both read-only:

- `ux-sweep.mjs` photographs every screen at desktop and phone size and
  reports any control under 44px or any page that scrolls sideways.
- `width-check.mjs` measures the hero across seven breakpoints and says
  whether anything overflows the card it belongs to.
