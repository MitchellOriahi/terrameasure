# Review Anticipation: The First 6 Months of TerraMeasure Reviews

Simulated public reviews for terrameasurev2.onrender.com, grounded in the product as actually built (5-county parcel pilot, Render free tier, 20-90s surveys, PWA only, metric-leaning units, uncertified outputs, anonymous use). Written 2026. Purpose: fix the 1-star causes before real people write them.

---

## 1. Twenty realistic reviews

### Positive (8)

**P1. 5 stars, "Saved me from a $95k mistake", land buyer, Austin TX**
> Was about to make an offer on 3 acres outside Austin that looked gently rolling in the listing photos. Tapped the parcel, got CAUTION 54/100, average slope 11 degrees, and an earthwork estimate of $40k to $70k just to get a flat pad. Called the agent, asked pointed questions, she went quiet. This took 90 seconds and cost nothing. The listing photos cost me almost six figures of bad judgment.

**P2. 5 stars, "Finally a tool that shows its error bars", licensed surveyor, WA**
> I am a PLS and I came in ready to hate this. I do not hate it. Every number carries a plus or minus and names its source (USGS 3DEP 1m, vertical about 0.15m, stated right on the report). The footer says preliminary, uncertified, bring it to a licensed surveyor. That is exactly right. Clients now show up having already screened out the obvious no-go parcels, which means the jobs I get are real jobs. This is an intake filter, not a competitor.

**P3. 4 stars, "Cut/fill sanity check in the truck", excavation contractor, Phoenix AZ**
> I bid grading work. Before I drive out to walk a site I run it through this: cut volume, fill volume, dollar range. It is rough, it says it is rough, but it is the right order of magnitude and it takes a minute. Knocked a star off because everything is in meters and cubic meters and I think in yards.

**P4. 5 stars, "Free actually means free", first-time land buyer**
> No card. No trial that flips to $67 a month while you are not looking (looking at you, Land id). No login wall, I ran four parcels before I ever made an account. The verdict, the score breakdown, the flood and wetland flags, all free. I do not understand the business model and I do not care.

**P5. 5 stars, "The share link closed my deal", real estate agent, Charlotte NC**
> Buyer was spooked about a sloped lot in Mecklenburg. I ran the parcel, got GO 78/100 with the slope numbers and no flood or wetland flags, and texted her the report link. She read it on her phone, no login, saw the score breakdown explain itself, and we wrote the offer that night. A pretty map would not have done that. A verdict did.

**P6. 4 stars, "The drawing tool is better than apps I pay for"**
> On the phone you do not fat-finger points onto the map, you move the map under a crosshair and press a big button. Undo actually works. Live area readout while you draw, with the uncertainty right next to it. Whoever designed this has actually stood in a field with a phone. Four stars only because my rural county has no parcel outlines yet so I draw everything by hand.

**P7. 5 stars, "Wetland flag saved us", buyer, Miami-Dade FL**
> Gorgeous half-acre listed cheap. TerraMeasure flagged about 60 percent of it as National Wetlands Inventory wetland and put it in the score with a NO-GO. Our attorney confirmed it. The seller knew. The listing did not mention it. This app mentioned it, for free, in a minute.

**P8. 4 stars, "Land id shows you land, this judges it"**
> I have Land id Pro. It has 40 layers and makes beautiful maps and after an hour of toggling layers you still have to be your own analyst. TerraMeasure has like seven layers and one job: should you build here. Score, buildable percent, dollars, done. Keeping Land id for parcel coverage (TerraMeasure only has real parcels in a few counties), but this is the one I open first.

### Negative and critical (12)

**N1. 1 star, "Uncertified numbers pretending to be a survey", surveyor**
> A client walked into my office waving a phone at me saying the app said grading would be $22k so why is my quote different. These outputs are UNCERTIFIED. The disclaimer is in tiny gray text at the bottom where nobody reads it. A slope number from a public 1m DEM with hand-wavy error math is not a survey, and putting a confident green GO banner on top of it teaches people it is. You are creating arguments for every PLS in the country.

**N2. 2 stars, "Opened it, stared at a map, gave up", first-timer**
> The website says find out in a minute. I opened the map and got... a map. I tapped my land in Ohio, a little gray message flashed for two seconds saying no parcel data here yet and disappeared before I finished reading it. Nothing told me I could draw the boundary myself. My daughter figured it out later. If I have to be shown how to use it, the minute claim is false for people like me.

**N3. 1 star, "Anywhere in the US, except where I live", rancher, Montana**
> The homepage says pick any spot in the US. My parcel taps do nothing but an error message. Turns out real parcel data exists in exactly FIVE counties (it says pilot counties, it does not say which, or show a map of them). Everyone I know who buys land is rural. The five counties are all big metros. This app is anywhere in the US the way a food truck is a restaurant chain.

**N4. 1 star, "Timed out twice, never saw a result"**
> Tapped a parcel, spinner said waking up the survey engine, the free tier naps when idle. Cute. Forty seconds later, still spinning, message now says almost there. My phone auto-locked, came back, dead. Tried again, waited about a minute total, got an error. A tool whose whole pitch is a verdict in a minute took four minutes of my life and delivered nothing.

**N5. 2 stars, "Unusable on rural LTE"**
> Ironic that an app for evaluating rural land barely works on rural cell service. Satellite tiles crawl in, the survey ran 90+ seconds on one bar of LTE, and there is no offline anything, no app in the App Store, just an add-to-home-screen webpage trick my iPhone buried. Standing on the actual parcel, the one place I most want this, is the one place it does not work.

**N6. 2 stars, "Not ready for listing work", real estate agent comparing to Land id**
> Wanted to like this for my land listings. Deal breakers: parcel data in 5 counties (Land id: 150 million parcels, every state). No comp sales, so I cannot support a price opinion. No branded PDF, I cannot put a webpage link in a listing package or an email to a 70-year-old seller. The acreage comes with a plus or minus, which is honest but confuses clients who want the number to match the county record shown two lines up. Verdict is genuinely cool, everything around it is not agent-ready.

**N7. 1 star, "It quoted $2.1M of earthwork on a normal 30-acre parcel", developer**
> I ran a 30-acre parcel with an ordinary rolling grade. Earthwork estimate: $1.4M to $2.1M. That is nonsense, and I know why: it costed leveling the ENTIRE parcel to one flat plane. Nobody levels 30 acres to build a house, you grade a pad. Any number this silly, presented this confidently in a big bold font, torches the credibility of every other number on the report.

**N8. 2 stars, "The error bounds are theater", GIS professional**
> Plus or minus 0.6 degrees of slope sounds rigorous until you ask where it came from. The error formulas are approximations, not real propagation (their own materials admit this). Worse: outside 1m lidar coverage it silently falls back to a coarser global elevation source with roughly 5m error, and you only find out in a footnote. In tree canopy the DEM can be wrong in ways no formula here captures. Publish a methodology page and validation numbers against known sites, or drop the precision cosplay.

**N9. 1 star, "It deleted my survey"**
> Spent 15 minutes carefully outlining an odd-shaped 12-corner parcel, got my results, closed the tab. Gone. Made an account the next day thinking it would be there. Nothing. Nobody told me anonymous surveys evaporate, the site brags no sign-up needed. If sign-up is actually required to keep your work, say so BEFORE I do the work.

**N10. 2 stars, "Meters. In Texas."**
> Elevation range in meters. Cut volume in cubic meters. Distances in meters. Grid resolution in meters. I am an American buying American land with American contractors who quote in cubic yards and feet. There is no unit toggle anywhere. Small thing, but I have to keep a converter app open next to a measuring app, which is absurd.

**N11. 1 star, "Crash ate 12 vertices"**
> Survey failed partway (server error after the long wait). The retry did not keep my drawn boundary. Twelve points, redrawn from scratch, on a phone, twice. Any tool where drawing is the main input MUST treat the drawing as sacred. Lost work is the fastest one-star there is.

**N12. 1 star, "GO verdict on an unbuildable lot"**
> Got GO 81/100 on a lot near Austin. Bought it. County then told me: no septic approval possible on that soil, plus a 75-foot creek setback eats the buildable area. The app checks slope, flood, wetlands, and water, and NOT zoning, setbacks, soil, septic, or legal access, but the big green GO does not shout that. A go verdict that ignores the things that most often kill a build is not a go verdict, it is a slope calculator with confidence.

---

## 2. Root-cause table

| # | Review | Root cause (real, as built) | Concrete fix | Effort |
|---|---|---|---|---|
| N1 | Angry surveyor | Disclaimer is small footer text; GO banner reads as certified confidence; no PLS-facing framing at point of reading | Add a "What a licensed surveyor must still verify" section to ReportPage.tsx (per strategy doc report spec item 7, currently unbuilt); move a one-line uncertified notice INTO the verdict banner component; add a /surveyors page positioning us as intake | QUICK (banner line) + MEDIUM (verify section, page) |
| N2 | Confused first-timer | `useParcel.ts` no_coverage feedback is a 2-second toast; no persistent empty-state guidance; draw-your-own path undiscoverable after a failed tap | Replace the toast with a bottom sheet: "No parcel outlines here yet. Draw the boundary yourself, takes about a minute" with a Start Drawing button; first-visit coach mark on the Survey button | QUICK |
| N3 | Rural user, no parcels | Landing says "Anywhere in the US" and "Tap a parcel... in pilot counties" without naming counties; no coverage map anywhere | Coverage section on LandingPage.tsx naming all 5 counties with a small static map; in-app coverage layer; "vote your county next" request button feeding a demand table (strategy doc kill-risk 2 already prescribes this) | QUICK (list + copy) + MEDIUM (map, voting) |
| N4 | Cold-start timeout | Render free tier sleeps; `loadingMessage()` in useSurvey.ts is honest but capped, "almost there" can run indefinitely; no warm-up, no progress, no recovery | Fire a `/health` warm-up ping on landing/map mount so the dyno wakes during map browsing; show elapsed seconds + a determinate-feeling stage bar; on failure auto-retry once against the now-warm server; long term paid Render tier ($7/mo kills the whole class) | QUICK (ping + elapsed) + LONG (paid hosting) |
| N5 | Slow rural connection | Heavy satellite tiles, 20-90s surveys, no offline, PWA-only | Default to lighter street basemap on slow connections (Network Information API where present, else tile-latency heuristic); tile cache via Workbox per mobile_ux_spec.md section 10 (specced, unbuilt); saved surveys to IndexedDB; app store is LONG | MEDIUM (basemap + cache) / LONG (app store) |
| N6 | Agent vs Land id | 5-county pilot, no comps, no branded PDF, error-bound acreage confuses clients | Branded PDF export of the existing report (server-side render of ReportPage, it is already a document); label outline area "drawn outline" vs county "recorded acreage" so the two numbers stop fighting; comps stay SKIP per strategy; parcel coverage needs Regrid | MEDIUM (PDF, labels) / LONG (Regrid) |
| N7 | Silly cost number | `assessSite` costs cut/fill of leveling the ENTIRE polygon to one grade; unbounded area | Cost a buildable pad, not the parcel: compute cut/fill on the best-fit pad (default 0.25 ac, user adjustable) placed on the flattest cell window; above ~5 ac auto-switch and say so in earthwork_cost.note; cap or warn on giant polygons | MEDIUM (engine + verdict.ts + note copy) |
| N8 | Accuracy skeptic | Error formulas are admitted approximations (CLAUDE.md known weak spot); ~5m fallback source only visible in a footnote; no validation data | Methodology page: formulas, sources, caveats (canopy, fallback); when source is not 1m lidar, badge the verdict banner "coarse elevation data, wider error"; Phase 3 published validation against known sites is the real answer | QUICK (badge) + MEDIUM (methodology page) + LONG (validation study) |
| N9 | Lost saved survey | Anonymous surveys live only in page state; nothing warns; signup does not claim past work | Persist every completed survey (geometry + results JSON) to localStorage/IndexedDB automatically; "Recent surveys" list for anonymous users; on signup, offer to claim local surveys into the account; post-results nudge "This survey lives only on this device until you save it" | MEDIUM |
| N10 | Metric units | `geo.ts` fmtArea/fmtLength emit m, km, m2; report emits meters and m3; no toggle | Global ft/ac/yd3 vs metric toggle (default imperial for US audience) in one formatting module (geo.ts + MetricRow), persisted in localStorage, respected in reports | QUICK |
| N11 | Retry lost drawing | Failed survey mutation does not guarantee the polygon survives into retry; redraw from scratch | Keep vertices in state and sessionStorage through any failure; error card gets "Retry with the same boundary"; retry reuses server-cached DEM where the backend kept it | QUICK (persist + retry) |
| N12 | GO on unbuildable lot | Score covers slope/flood/wetland/water only; zoning, septic, soils, access, setbacks unchecked; verdict copy does not scope itself | Rename banner sublabel to "Terrain and water verdict"; add a fixed "Not checked: zoning, setbacks, soils and septic, legal access" strip directly under the verdict in ResultsContent and ReportPage; each risk flag already has room for "what a PLS should verify" text; soils (SSURGO) and zoning layers are LONG | QUICK (scope strip) / LONG (new data factors) |

---

## 3. The 5 highest-leverage fixes (ranked)

1. **Warm-up ping + honest elapsed/stage progress + auto-retry (N4, QUICK).** Cold start is the first 60 seconds of every idle-hour user's experience; it manufactures 1-stars from people who never even saw the product.
2. **Verdict scope strip: "Not checked: zoning, septic, soils, access" (N12 and half of N1, QUICK).** The worst possible review is "your GO cost me real money"; two lines of copy convert a liability into demonstrated honesty.
3. **No-coverage sheet with a Draw-It-Yourself button + named counties on the landing page (N2 + N3, QUICK).** Most of the US has no parcel data for 12+ months; every rural visitor hits this wall, and today the wall is a 2-second toast.
4. **Pad-based earthwork costing with the assumption stated (N7, MEDIUM).** One absurd headline dollar figure poisons trust in every honest number on the page; cost credibility is a ranked differentiator (strategy doc #3).
5. **Unit toggle defaulting to imperial (N10 + a star back from N3-adjacent contractors, QUICK).** Cheapest fix on the list, irritates nearly 100 percent of the US audience today, and pros cannot quote in cubic meters.

Honorable mention: survey persistence for anonymous users (N9, N11), because lost work is the most emotionally charged 1-star category.

---

## 4. Competitor-comparison gaps a reviewer will cite

| "Land id / others have X" | Our answer |
|---|---|
| 150M parcels, every US county | True and unanswerable for now. Own it: named pilot counties, coverage map, county voting queue, draw-anywhere fallback. Regrid at revenue. |
| Native apps in the App Store / Play Store | Accepted gap for v1. PWA install flow per mobile_ux_spec; store wrapper (Capacitor) is a LONG item once retention proves out. |
| Offline maps (onX's core strength) | Accepted gap in v1, specced in mobile_ux_spec (tile cache, IndexedDB saves). Say "cached tiles only" honestly; never promise offline areas. |
| Beautiful branded shareable maps, PDF | Partially real gap: our report is a stronger artifact but has no PDF export yet. MEDIUM fix; branded PDF is the planned Pro anchor. |
| Comp sales (Land id, AcreValue) | Deliberate SKIP: valuation is not feasibility. Answer reviewers with the positioning line, do not build it. |
| 40+ map layers | Deliberate: our ~7 layers each feed the score. "Fewer layers that load fast and change the verdict" is the counterpunch, keep saying it. |
| Owner mailing lists, lead gen | Deliberate SKIP, zero go/no-go value. |
| Years of brand trust with agents/ranchers (Land id since 2014) | Cannot shortcut. Earned via surveyor-augmentation posture, published accuracy validation, and radical-trust pricing. |
| Deed plotting, survey/plat overlay | LATER per strategy (Phase 3 pro). Acknowledge as "on the pro roadmap" when asked. |
| Zoning/soils/septic layers (various GIS tools) | Real analysis gap (see N12). Short term: scope the verdict honestly. Long term: SSURGO soils is the most feasible addition and feeds the score, unlike decorative layers. |
| Instant results (any always-on SaaS) | Free-tier hosting artifact, not architecture. $7/mo Render tier erases the category; until then, warm-up ping + honest wait copy. |

---

## 5. Trust and expectation management copy

### Moment 1: the cold-start wait

Current copy (useSurvey.ts `loadingMessage`) is decent; upgrade it to show elapsed time, name the worst case up front, and give the wait a purpose:

> **Starting the survey engine... (14s)**
> We run on free infrastructure so every verdict stays free, and the engine naps when nobody is surveying. First survey of the hour can take up to 60 seconds; every one after that takes a few seconds. Your boundary is saved, and we will retry automatically if this attempt stalls.

Failure state:

> **That took longer than it should have.**
> The engine is awake now, so the next attempt is usually fast. Your boundary is untouched.
> [Retry with the same boundary]

### Moment 2: the no-parcel-data moment

Replace the vanishing toast with a persistent sheet:

> **No parcel outlines in this county yet.**
> Official boundary data is live in 5 pilot counties (Maricopa AZ, Travis TX, King WA, Mecklenburg NC, Miami-Dade FL) and expanding by demand. The full analysis, slope, buildable area, flood, wetlands, and cost, works everywhere in the US: trace the boundary yourself in about a minute.
> [Draw the boundary]  [Request my county]

### Moment 3: the uncertified disclaimer (honesty as strength)

Move a short version into the verdict banner itself, not just the footer:

> **This is a terrain and water pre-screen, not a survey, and we would not want it any other way.** Every number here carries its error range and names its government data source, which is exactly what a certified survey will tighten. Use this to decide whether the land is worth a licensed surveyor's fee; if it is, bring them this report and you will both start two weeks ahead.

Report footer, PLS-facing line:

> Preliminary and uncertified by design. A licensed Professional Land Surveyor must verify boundaries, zoning, setbacks, soils, and legal access before any decision that costs real money. This report exists to make that conversation faster, not to replace it.
