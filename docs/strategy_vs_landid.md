# TerraMeasure vs Land id: The Plan

One-line strategy: Land id shows you land; TerraMeasure tells you whether to buy it. Never compete on layer count, always on the verdict.

Research basis: Land id ladder confirmed at roughly $7 to $67/user/mo annual, map creation gated to Premium, reports/embeds to Pro, 7-day trial that converts silently (source of billing-trap resentment), confirmed complaints about slow/randomly-loading layers on mobile. Their confirmed strength: beautiful shareable maps, parcel and layer coverage, ease of use. No review anywhere praises Land id for analysis, because it has none. That is the seam we drive a truck through.

## Feature-by-feature verdicts

| Land id capability | Verdict | Our answer |
|---|---|---|
| 150M+ nationwide parcel feed | MATCH (phased) | County pilot now, Regrid later. They genuinely win here for 12+ months. Launch in 3-5 counties where our verdict matters most (rural/exurban land with terrain risk), be explicit about coverage. |
| 40+ map layers | BEAT by subtraction | We carry ~7 layers and every one feeds the score. Theirs are decorative, each of ours changes the verdict. Fewer layers that load fast beats 40 that load randomly. |
| Beautiful branded shareable maps | BEAT | Our artifact is a decision, not a picture. Theirs says "here is the land." Ours says "here is whether to buy it, and why, with error bounds." |
| Deed plotting (metes and bounds) | LATER | Passes the go/no-go filter, Phase 3 pro tier. |
| Survey overlay (georeference a plat) | LATER | Fits surveyor augmentation, after PDF reports ship. |
| AI smart search | SKIP | Discovery, not feasibility. |
| Comp sales | SKIP | Valuation, not feasibility. |
| Mailing lists / owner outreach | SKIP | Lead-gen, zero go/no-go value. |
| Photo/video waypoints | LATER | Becomes Phase 2 photogrammetry input, not a note toy. Land id cannot follow us there. |
| 360 panoramas | SKIP | Eye candy, informs no decision. |
| CarPlay | SKIP | We exist so you do NOT drive out. |
| Offline maps | LATER | For the confirm-visit after a GO verdict. |
| Slope/terrain analysis | BEAT (they have none) | Our entire engine, with error bounds. An architecture gap for them, not a feature gap. |
| Cost estimates | BEAT (they have none) | Dollar-range cost-to-develop from cut/fill. Nobody in the category outputs dollars. |
| Verdict/scoring | BEAT (they have none) | GO / CAUTION / NO-GO with breakdown. They hand you 40 layers and wish you luck. |
| Mobile app | BEAT (low bar) | Their weakest, most-complained-about surface. Mobile-first PWA, 60-second verdict flow. |
| Ease of use | MATCH | Their genuine strength, we must equal it. Click parcel, get verdict, zero GIS vocabulary. |

Where they genuinely win today: parcel coverage (close with Regrid at revenue), brand trust with agents/ranchers since 2014 (we take surveyors, buyers, builders first), map-drawing polish (concede it, judging land is our business).

## The 10 differentiators (ranked by copy-difficulty x demo power)

1. Error bounds on every number. Hover "12,400 cu yd cut" and see "plus or minus 1,900, source: USGS 1m lidar."
2. The GO / CAUTION / NO-GO verdict. Paste an address, 60 seconds later a colored verdict card explains itself in plain English.
3. Cost-to-develop in dollars. "$38k to $65k of earthwork to reach a buildable pad" on a lot that looked flat in photos.
4. Buildable-percentage computation. A gorgeous 40-acre listing shows "9% buildable after slope, wetland, and floodplain exclusions" painted on the map.
5. Water-aware scoring fusing NWI + FEMA + USGS + terrain.
6. The decision report share link. Client reads a verdict, not a map, and answers in one day instead of three weeks.
7. Surveyor augmentation posture. Report footer: "Preliminary, uncertified. Bring this to a PLS." Surveyors realize we are their intake funnel, not their enemy.
8. Cut/fill scenario slider. Drag target pad elevation, watch cut, fill, and dollars recompute live.
9. 60-second mobile flow. Verdict loads before Land id's layer list finishes populating.
10. Phase 2 photo-to-DEM. Walk the parcel filming on a phone, same engine re-scores at sub-meter accuracy. A physics moat.

Why 1-5 are hard to copy: they require a measurement engine with error propagation, not a mapping stack. Land id would need to rebuild its core.

## The report artifact (our viral loop)

Their loop is "look at this pretty map." Ours is "here is the decision, defend it."

Report contents, top to bottom:
1. Verdict banner: GO / CAUTION / NO-GO with a one-sentence reason.
2. Parcel facts strip: APN, owner, acreage, county, coordinates, data vintage.
3. Score breakdown: each factor as a labeled bar with contribution and data source. No black-box score.
4. The map, annotated: buildable shaded, exclusions hatched, worst slope flagged. One map that argues the verdict.
5. Cost-to-develop range with assumptions stated ($/cu yd editable).
6. Elevation profile across the buildable axis.
7. Risk flags, sortable by severity, each with "what a PLS should verify."
8. Error bounds box: every number's uncertainty and DEM source. The trust signature no competitor can fake.
9. Branding + uncertified footer.

Share-link mechanics: public read-only URL per survey (/r/{slug}), no login to view, mobile-perfect, OG preview card shows the verdict banner (the verdict IS the thumbnail). Persistent "Run your own parcel free" CTA. Toggle public/private, expiring links, identical branded PDF export. View analytics on paid tier.

## Pricing (one recommendation)

Counter their billing-trap wound with radical trust:
- Free forever, no card, no trial timer: unlimited verdicts, full breakdown, error bounds, on-screen map and profile, 3 active share links. The core decision is never paywalled.
- Pro: $19/mo flat ($190/yr), ONE tier: branded PDF export, unlimited share links + analytics, cut/fill scenario slider with custom rates, saved portfolio with re-check alerts, priority coverage requests. Surveyor tools land here later at the same price.
- Rules that ARE the positioning: no trial that converts to billing, one-click cancel, price on the homepage. Deliberately in the dead zone between their $15 viewer and $33 creator tiers.

## The 3 kill risks

1. Land id bolts on a shallow "terrain score." Mitigation: make error bounds + published accuracy validation the bar they cannot clear without a real engine. Own the phrase "feasibility verdict" first.
2. Parcel-data asymmetry strangles adoption. Mitigation: degrade gracefully, never fail. Draw-your-own-boundary works everywhere on earth, show a coverage map, let free users vote counties into the queue (demand mapping for the Regrid spend).
3. They buy/build a cheap engine. Mitigation: the moat is the honesty architecture plus surveyor trust, which accrues slowly and cannot be acquired mid-cycle. Ship the photo-DEM path so the accuracy ceiling keeps rising on a road alien to a map-styling company.
