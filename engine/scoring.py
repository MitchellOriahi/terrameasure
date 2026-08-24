"""
engine/scoring.py
=================
The site suitability score, computed SERVER-SIDE and water-aware.

Why this moved out of the frontend:
  The old score lived in JavaScript and only looked at slope and elevation.
  Open water is perfectly flat, so a lake scored "100% buildable, excellent".
  The score now also listens to the context layers (water, wetlands, flood
  zones) and it explains itself: every response includes an itemized
  breakdown of what helped, what hurt, and by how much, plus an explicit
  GO / CAUTION / NO-GO verdict. The product promise is "a defensible
  go/no-go terrain decision in about 60 seconds", and defensible means
  showing your work.

How the score is calibrated (recalibrated after CEO review):
  Every site starts at a NEUTRAL 50. Terrain (slope, relief, buildable
  area) can move it up to the low 90s or down toward 0, and the context
  layers (water, wetlands, flood) subtract using the CONTEXT_WEIGHTS
  table below. The old version started at 72 and squeezed almost every
  site into 70-90, which made the number meaningless; real terrain should
  plausibly spread from about 10 to 95.

Like everything in engine/, this file does pure math on inputs it is given.
It never fetches anything; the API layer hands it the DEM stats and the
context dict. Same seam philosophy as the rest of the engine.
"""

from __future__ import annotations

import numpy as np


# The disclaimer every scored result must carry. Centralized here so the
# wording never drifts between endpoints.
DISCLAIMER = ("Preliminary and uncertified. A licensed Professional Land "
              "Surveyor must prepare and seal any legally binding survey.")


# ---------------------------------------------------------------------------
# Verdict policy, named so it reads like English.
#
# The verdict WORD is driven by the score band; the nuance lives in the
# breakdown and the headline_reason. One voice, no mixed messages like
# "CAUTION" sitting next to "81/100 Excellent".
#   score >= GO_SCORE and nothing forcing  -> "go"      ("Favorable")
#   forcing condition, or 45..74           -> "caution" ("Proceed with conditions")
#   score < NO_GO_SCORE or a hard blocker  -> "no-go"   ("Not recommended")
# ---------------------------------------------------------------------------
GO_SCORE = 75             # at/above this, with no forcing conditions: go
NO_GO_SCORE = 45          # below this the terrain alone says walk away
NO_GO_WATER_FRACTION = 0.50    # half the site underwater = not a site
NO_GO_WETLAND_FRACTION = 0.60  # mostly wetland = permitting nightmare
HEAVY_WATER_FRACTION = 0.80    # this much open water caps the score at 10

# Exactly one label per verdict, no second adjective. The label is just the
# verdict said politely; nuance goes in headline_reason and the breakdown.
VERDICT_LABELS = {
    "go": "Favorable",
    "caution": "Proceed with conditions",
    "no-go": "Not recommended",
}

# What this score deliberately does NOT evaluate. Shipped with every score
# so the UI can show a scope strip under the verdict, and so nobody reads
# "Favorable" as "nothing else can go wrong".
NOT_CHECKED = [
    "Zoning and land-use restrictions",
    "Septic and soil percolation",
    "Legal access and easements",
    "Utility availability",
]

# ---------------------------------------------------------------------------
# CONTEXT WEIGHT TABLE: the deliberate, documented relative weights.
#
# Per factor:
#   threshold        coverage fraction below which the factor costs nothing
#                    (but the breakdown still SAYS the coverage, see below)
#   points_per_10pct score points lost per 10% of site coverage
#   cap              most points this one factor may remove
#   base_points      flat penalty the moment the factor is present at all
#                    (flood only: touching an SFHA has fixed consequences
#                    like insurance, regardless of coverage)
#
# Why these relative weights:
#   open water (8/10%) > wetland (6/10%): water is flatly unbuildable;
#   wetland is buildable-with-permits (Clean Water Act Section 404).
#   Wetland coverage above its 5% threshold ALWAYS costs points; the old
#   code could show "open water -6 at 7%" next to "wetlands 0 at 8%",
#   which was incoherent.
#   Note the wetland charge is applied to TOTAL mapped wetland coverage.
#   Where wetland overlaps open water the site is penalized on both lines;
#   that is deliberate (it is both unbuildable AND jurisdictional), and the
#   wetland rate is set lower partly to keep that stacking fair.
# ---------------------------------------------------------------------------
CONTEXT_WEIGHTS = {
    "open_water": {"threshold": 0.02, "points_per_10pct": 8.0, "cap": 80},
    "wetland":    {"threshold": 0.05, "points_per_10pct": 6.0, "cap": 45},
    "flood":      {"threshold": 0.00, "points_per_10pct": 4.0, "cap": 45,
                   "base_points": 10},
}


def site_score(dem_result, measurements: dict, context: dict | None = None) -> dict:
    """
    Compute the 0-100 site suitability score with a GO / CAUTION / NO-GO
    verdict and an itemized breakdown.

    Parameters:
      dem_result    anything with .heights (2D numpy array); used only for
                    the elevation relief (max height minus min height)
      measurements  dict with:
                      "avg_slope_deg"       average slope in degrees
                      "buildable_area_pct"  slope-based buildable %, 0-100
      context       the dict from fetchers.context_layers.check_context,
                    or None if context was not checked

    Returns:
      {
        "value": 0-100,
        "verdict": "go" | "caution" | "no-go",
        "label": "Favorable" | "Proceed with conditions" | "Not recommended",
        "headline_reason": one sentence, the biggest negative factor,
        "not_checked": list of things this score does not evaluate,
        "buildable_area_pct": water-adjusted buildable %,
        "breakdown": [{"factor": ..., "effect": "+20", "note": ...}, ...],
        "note": one-line summary
      }
    """
    breakdown: list[dict] = []
    avg_slope = float(measurements.get("avg_slope_deg", 0.0))
    buildable = float(measurements.get("buildable_area_pct", 0.0))

    heights = np.asarray(dem_result.heights, dtype=float)
    valid = heights[~np.isnan(heights)]
    relief = float(valid.max() - valid.min()) if valid.size else 0.0

    # ---- Terrain portion, rebased so 50 is neutral. ----
    # The old baseline of 72 compressed nearly every site into 70-90. With a
    # neutral 50 and wider terrain swings (+43 best case, -64 worst case
    # before context) the number can actually separate good land from bad.
    score = 50.0
    breakdown.append({"factor": "baseline", "effect": "+50",
                      "note": "Every site starts at a neutral 50; terrain "
                              "and context move it from there."})

    if avg_slope < 3:
        score += 20
        breakdown.append({"factor": "slope", "effect": "+20",
                          "note": f"Very gentle average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope < 8:
        score += 10
        breakdown.append({"factor": "slope", "effect": "+10",
                          "note": f"Gentle average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope > 25:
        score -= 30
        breakdown.append({"factor": "slope", "effect": "-30",
                          "note": f"Steep average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope > 15:
        score -= 15
        breakdown.append({"factor": "slope", "effect": "-15",
                          "note": f"Moderately steep average slope "
                                  f"({avg_slope:.1f} deg)."})
    else:
        breakdown.append({"factor": "slope", "effect": "0",
                          "note": f"Manageable average slope "
                                  f"({avg_slope:.1f} deg)."})

    # Elevation relief (total height range), checked largest-first.
    if relief < 10:
        score += 8
        breakdown.append({"factor": "relief", "effect": "+8",
                          "note": f"Nearly level site ({relief:.0f} m of "
                                  "elevation change)."})
    elif relief > 100:
        score -= 20
        breakdown.append({"factor": "relief", "effect": "-20",
                          "note": f"Large elevation change ({relief:.0f} m)."})
    elif relief > 50:
        score -= 10
        breakdown.append({"factor": "relief", "effect": "-10",
                          "note": f"Notable elevation change ({relief:.0f} m)."})
    else:
        breakdown.append({"factor": "relief", "effect": "0",
                          "note": f"Moderate elevation change "
                                  f"({relief:.0f} m)."})

    # Buildable area now swings BOTH ways: 50% buildable is neutral, 100%
    # earns +15, 0% costs -15. (Old version only awarded 0..+10, which was
    # part of the compression problem.)
    build_pts = int(round((buildable - 50.0) * 0.3))
    score += build_pts
    # Word this carefully. This number is SLOPE ONLY: it says how much of
    # the ground is gently sloped, and flat water counts as gentle. The
    # headline buildable figure further down subtracts water and wetland.
    # Saying "buildable" in both places with two different numbers is how
    # a report ends up contradicting itself in front of a surveyor.
    breakdown.append({"factor": "gentle ground", "effect": f"{build_pts:+d}",
                      "note": f"{buildable:.0f}% of the site is gently sloped "
                              "(50% is neutral). Slope only; water and "
                              "wetland come off below."})

    # ---- Context portion: the water-aware part that fixes the lake bug ----
    water_frac = None
    wetland_frac = None
    flood_high = None
    flood_frac = None
    caps: list[float] = []      # hard ceilings the score may not exceed
    force_no_go = False
    force_caution = False

    if context is None:
        breakdown.append({"factor": "context", "effect": "0",
                          "note": "Water, wetland, and flood layers were not "
                                  "checked; this score is terrain-only."})
    else:
        water_frac = context.get("open_water_fraction")
        wetlands = context.get("wetlands", {})
        flood = context.get("flood", {})

        # --- Open water: the CEO's lake bug lives and dies right here. ---
        w = CONTEXT_WEIGHTS["open_water"]
        if water_frac is None:
            breakdown.append({"factor": "open water", "effect": "0",
                              "note": "Water sources unavailable; open-water "
                                      "coverage unknown, not evaluated."})
        elif water_frac > w["threshold"]:
            # Penalty grows with coverage per the weight table; heavy
            # coverage adds hard caps so good terrain math can never
            # rescue a lake.
            penalty = round(min(w["cap"],
                                w["points_per_10pct"] * water_frac * 10.0))
            score -= penalty
            if water_frac >= HEAVY_WATER_FRACTION:
                caps.append(10)
            elif water_frac >= NO_GO_WATER_FRACTION:
                caps.append(20)
            if water_frac >= NO_GO_WATER_FRACTION:
                force_no_go = True
            else:
                force_caution = True
            breakdown.append({"factor": "open water", "effect": f"-{penalty}",
                              "note": f"{water_frac * 100:.0f}% of the site is "
                                      "open water. Flat water is not "
                                      "buildable land."})
        else:
            breakdown.append({"factor": "open water", "effect": "0",
                              "note": "No significant open water on the site."})

        # --- Wetlands. ONE source of truth: the same coverage number the ---
        # --- risk flags show is the number this line talks about.        ---
        w = CONTEXT_WEIGHTS["wetland"]
        if wetlands.get("status") != "ok":
            breakdown.append({"factor": "wetlands", "effect": "0",
                              "note": "Wetland source unavailable; unknown, "
                                      "not evaluated."})
        else:
            wetland_frac = wetlands.get("coverage_fraction") or 0.0
            if wetland_frac > w["threshold"]:
                # Charged on TOTAL mapped wetland coverage (see the weight
                # table comment about deliberate overlap with open water).
                penalty = round(min(w["cap"],
                                    w["points_per_10pct"] * wetland_frac * 10.0))
                score -= penalty
                if wetland_frac >= NO_GO_WETLAND_FRACTION:
                    caps.append(30)
                    force_no_go = True
                else:
                    force_caution = True
                breakdown.append({"factor": "wetlands", "effect": f"-{penalty}",
                                  "note": f"{wetland_frac * 100:.0f}% of the "
                                          "site is mapped wetland. Building "
                                          "here usually needs federal permits "
                                          "(Clean Water Act Section 404)."})
            elif wetland_frac > 0:
                # Below the scoring threshold is NOT the same as "none".
                # The old wording ("No significant mapped wetlands") read
                # as a contradiction next to a risk flag showing 8%
                # coverage from the very same survey.
                breakdown.append({"factor": "wetlands", "effect": "0",
                                  "note": f"{wetland_frac * 100:.0f}% mapped "
                                          "wetlands, below the "
                                          f"{w['threshold'] * 100:.0f}% "
                                          "scoring threshold."})
            else:
                breakdown.append({"factor": "wetlands", "effect": "0",
                                  "note": "No mapped wetlands intersect "
                                          "the site."})

        # --- FEMA flood zones. ---
        w = CONTEXT_WEIGHTS["flood"]
        if flood.get("status") != "ok":
            breakdown.append({"factor": "flood zone", "effect": "0",
                              "note": "Flood source unavailable; unknown, "
                                      "not evaluated."})
        else:
            flood_high = bool(flood.get("in_high_risk_zone"))
            flood_frac = flood.get("high_risk_fraction")
            if flood_high:
                frac = flood_frac if flood_frac is not None else 0.5
                # Flat base_points for touching the SFHA at all (insurance,
                # elevated construction), plus coverage-scaled points.
                penalty = round(min(w["cap"],
                                    w["base_points"]
                                    + w["points_per_10pct"] * frac * 10.0))
                score -= penalty
                force_caution = True
                zones = sorted({z.get("zone") for z in flood.get("zones", [])
                                if z.get("high_risk") and z.get("zone")})
                # Only claim a coverage number we actually computed; when the
                # geometry was unusable, say "coverage unknown" honestly.
                coverage_txt = (f"{frac * 100:.0f}% coverage"
                                if flood_frac is not None
                                else "coverage unknown")
                breakdown.append({"factor": "flood zone",
                                  "effect": f"-{penalty}",
                                  "note": f"Site intersects FEMA high-risk "
                                          f"flood zone(s) {', '.join(zones)} "
                                          f"({coverage_txt}). "
                                          "Flood insurance and elevated "
                                          "construction likely required."})
            else:
                breakdown.append({"factor": "flood zone", "effect": "0",
                                  "note": "No high-risk FEMA flood zone "
                                          "mapped on the site."})

    # ---- Apply caps and clamp to 0-100. ----
    # The breakdown promises "no black-box score", so any cap or clamp that
    # moves the number gets its own line. Without this, a lake site's bars
    # would sum to (say) 54 while the headline says 20, and the mismatch
    # reads as a bug (or worse, as dishonesty).
    pre_adjust = int(round(max(0.0, min(100.0, score))))
    if caps:
        score = min(score, min(caps))
    score = int(round(max(0.0, min(100.0, score))))
    if score != pre_adjust:
        breakdown.append({
            "factor": "hard cap",
            "effect": f"{score - pre_adjust:+d}",
            "note": ("Heavy water/wetland coverage caps the score at "
                     f"{score}: good terrain math cannot rescue a site "
                     "that is mostly not land."),
        })

    # ---- Water-adjusted buildable percentage. ----
    # Slope math says water is "buildable" (it is flat!), so scale the
    # slope-based number down by however much of the site is water/wetland.
    unusable = max(water_frac or 0.0, 0.0)
    if wetland_frac:
        unusable = min(1.0, unusable + max(0.0, wetland_frac - (water_frac or 0.0)))
    adjusted_buildable = round(buildable * (1.0 - unusable), 1)

    # If taking water and wetland off changed the number materially, add
    # that to the gentle-ground line so the breakdown and the headline
    # buildable figure tell the same story rather than two.
    if abs(adjusted_buildable - buildable) >= 2.0:
        for item in breakdown:
            if item["factor"] == "gentle ground":
                item["note"] += (f" After water and wetland, "
                                 f"{adjusted_buildable:.0f}% is actually "
                                 "usable.")
                break

    # ---- Verdict: one voice. ----
    # Score band picks the word; forcing conditions (water, wetland, flood)
    # can only pull the verdict DOWN, never up. The label is just the
    # verdict spelled politely, so the two can never disagree again.
    if force_no_go or score < NO_GO_SCORE:
        verdict = "no-go"
    elif force_caution or score < GO_SCORE:
        verdict = "caution"
    else:
        verdict = "go"
    label = VERDICT_LABELS[verdict]

    # ---- Headline reason: the single biggest negative factor, as one ----
    # ---- sentence the UI can print right under the verdict.           ----
    def _effect_int(item: dict) -> int:
        try:
            return int(item["effect"])
        except (KeyError, ValueError):
            return 0

    negatives = [b for b in breakdown if _effect_int(b) < 0]
    if negatives:
        worst = min(negatives, key=_effect_int)
        # First sentence of that factor's note, so it stays headline-sized.
        headline_reason = worst["note"].split(". ")[0].rstrip(".") + "."
    else:
        headline_reason = "No significant negative factors were found."

    return {
        "value": score,
        "verdict": verdict,
        "label": label,
        "headline_reason": headline_reason,
        # Copy, so a caller mutating its response cannot edit our constant.
        "not_checked": list(NOT_CHECKED),
        "buildable_area_pct": adjusted_buildable,
        "breakdown": breakdown,
        "note": f"{label} ({score}/100), verdict: {verdict.upper()}. "
                "See breakdown for the reasons.",
    }


# ---------------------------------------------------------------------------
# Earthwork cost: the "cost-to-develop" layer.
#
# The honest cost model (fixed after CEO review):
#   The old model priced cut at $18/m3 AND fill at $14/m3. On a
#   mass-balanced site (cut == fill) that priced the SAME dirt twice,
#   roughly doubling reality: you dig it once and place it once, one
#   machine operation chain, one bill.
#
#   New model:
#     balanced volume  = min(cut, fill)      dirt moved WITHIN the site,
#                                            priced ONCE at cut-and-place
#     net imbalance    = abs(cut - fill)     dirt that must be trucked in
#                                            or hauled off, priced at the
#                                            import/export haul rate
# ---------------------------------------------------------------------------

# $13/m3 cut-and-place: mid-range of typical US $12-15/m3 for on-site
# excavate + move + compact (mass grading, no long haul).
CUT_AND_PLACE_RATE_USD_PER_M3 = 13.0

# $16/m3 for the net imbalance: import or export includes trucking and
# tipping/purchase, so it costs more per m3 than moving dirt on site.
HAUL_RATE_USD_PER_M3 = 16.0

# Real bids swing widely with region, soil, haul distance, and fuel prices,
# so we publish a RANGE around the base estimate instead of one fake-precise
# number. 0.75x to 1.6x = a -25%/+60% regional rate spread.
RANGE_LOW_FACTOR = 0.75
RANGE_HIGH_FACTOR = 1.6

# Pad-based costing: nobody levels a whole 30-acre parcel, so the full-site
# figure alone produced seven-figure nonsense. A typical building pad is
# about 2000 m2 (house + drive + yard grading), or 5% of the site if that
# is larger, never more than the site itself.
PAD_MIN_AREA_M2 = 2000.0
PAD_SITE_FRACTION = 0.05


def earthwork_cost(cut_m3: float, fill_m3: float,
                   site_area_m2: float | None = None) -> dict:
    """
    Rough grading-and-earthwork cost estimate, returned as a low/high RANGE
    in US dollars.

    The headline figure is a THEORETICAL FULL-SITE BALANCE: what it would
    cost to grade the entire site flat to its balance grade. Almost nobody
    does that, so when site_area_m2 is given we also return "pad_cost":
    the same rates applied to grading just a typical building pad.

    Returns:
      {
        "low_usd": ..., "high_usd": ..., "base_usd": ...,
        "cut_m3": ..., "fill_m3": ...,
        "balanced_m3": dirt moved within the site (priced once),
        "net_m3": import/export imbalance,
        "scope": "theoretical full-site balance",
        "pad_cost": {...} when site_area_m2 was provided,
        "note": the honesty caveat
      }
    """
    cut_m3 = max(0.0, float(cut_m3))
    fill_m3 = max(0.0, float(fill_m3))

    # The dirt you dig here and place there: priced ONCE.
    balanced = min(cut_m3, fill_m3)
    # The dirt you must truck in (or haul away): priced at the haul rate.
    net = abs(cut_m3 - fill_m3)

    base = (balanced * CUT_AND_PLACE_RATE_USD_PER_M3
            + net * HAUL_RATE_USD_PER_M3)

    note = ("Rough preliminary estimate, theoretical full-site balance: "
            "grading the whole site to its balance grade. Balanced volume "
            f"is priced once at ${CUT_AND_PLACE_RATE_USD_PER_M3:.0f}/m3 "
            "cut-and-place; only the net import/export imbalance is priced "
            f"at ${HAUL_RATE_USD_PER_M3:.0f}/m3 haul. The range reflects a "
            "-25%/+60% regional rate spread. Get local bids before "
            "budgeting.")

    result = {
        "low_usd": round(base * RANGE_LOW_FACTOR),
        "high_usd": round(base * RANGE_HIGH_FACTOR),
        "base_usd": round(base),
        "cut_m3": round(cut_m3, 1),
        "fill_m3": round(fill_m3, 1),
        "balanced_m3": round(balanced, 1),
        "net_m3": round(net, 1),
        "scope": "theoretical full-site balance",
        "note": note,
    }

    # --- Pad-based costing: the number a normal buyer actually needs. ---
    if site_area_m2 and site_area_m2 > 0:
        pad_area = min(float(site_area_m2),
                       max(PAD_MIN_AREA_M2,
                           PAD_SITE_FRACTION * float(site_area_m2)))
        # Scale the site's cut/fill volumes down by the pad's share of the
        # site. This assumes the pad's terrain is roughly average for the
        # site; in practice a builder picks the flattest corner, so this
        # leans conservative (slightly high), which is the safe direction.
        frac = pad_area / float(site_area_m2)
        pad_base = (balanced * frac * CUT_AND_PLACE_RATE_USD_PER_M3
                    + net * frac * HAUL_RATE_USD_PER_M3)
        result["pad_cost"] = {
            "pad_area_m2": round(pad_area),
            "low_usd": round(pad_base * RANGE_LOW_FACTOR),
            "high_usd": round(pad_base * RANGE_HIGH_FACTOR),
            "base_usd": round(pad_base),
            "note": ("Cost to grade only a typical building pad "
                     f"({round(pad_area):,} m2: 2000 m2 or 5% of the site, "
                     "whichever is larger, capped at the site size), at the "
                     "same rates. This is the realistic number for building "
                     "a structure; the full-site figure above is a "
                     "theoretical ceiling."),
        }

    return result


# ---------------------------------------------------------------------------
# Water-aware buildable percentage.
# ---------------------------------------------------------------------------
def buildable_area_pct_masked(dem: np.ndarray, cell_size: float,
                              water_mask: np.ndarray | None = None,
                              water_fraction: float | None = None,
                              max_slope_deg: float = 8.0) -> float:
    """
    Like measurements.buildable_area_pct, but water cannot count as
    buildable, even though it is perfectly flat.

    Two ways to tell it about water (use whichever you have):
      water_mask      a boolean grid the same shape as the DEM, True where
                      the cell is water (excluded cell by cell)
      water_fraction  a single 0-1 number (the slope-based percentage is
                      scaled down by this much)

    Returns a float 0-100.
    """
    # Import here to avoid a circular import at module load time
    # (measurements does not import scoring, but keeping engine modules
    # decoupled at import time is cheap insurance).
    from engine.measurements import slope_map

    slopes = slope_map(dem, cell_size)
    valid = ~np.isnan(dem)
    total = int(np.sum(valid))
    if total == 0:
        return 0.0

    buildable_cells = (slopes < max_slope_deg) & valid
    if water_mask is not None:
        buildable_cells = buildable_cells & ~np.asarray(water_mask, dtype=bool)
    pct = buildable_cells.sum() / total * 100.0

    if water_fraction:
        pct *= max(0.0, 1.0 - float(water_fraction))

    return round(float(pct), 1)
