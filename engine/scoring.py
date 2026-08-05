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
# Verdict thresholds, named so the policy reads like English.
# ---------------------------------------------------------------------------
NO_GO_SCORE = 35          # below this the terrain alone says walk away
CAUTION_SCORE = 65        # below this, proceed but budget for problems
NO_GO_WATER_FRACTION = 0.50    # half the site underwater = not a site
NO_GO_WETLAND_FRACTION = 0.60  # mostly wetland = permitting nightmare
HEAVY_WATER_FRACTION = 0.80    # this much open water caps the score at 10


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
        "label": "Excellent" | "Good" | "Fair" | "Challenging",
        "buildable_area_pct": water-adjusted buildable %,
        "breakdown": [{"factor": ..., "effect": "+15", "note": ...}, ...],
        "note": one-line summary
      }
    """
    breakdown: list[dict] = []
    avg_slope = float(measurements.get("avg_slope_deg", 0.0))
    buildable = float(measurements.get("buildable_area_pct", 0.0))

    heights = np.asarray(dem_result.heights, dtype=float)
    valid = heights[~np.isnan(heights)]
    relief = float(valid.max() - valid.min()) if valid.size else 0.0

    # ---- Terrain portion: a faithful port of the old frontend formula ----
    # (calcSiteScore in web/terrascan.html), so scores stay comparable for
    # dry land. Start at 72, adjust for slope, relief, and buildable area.
    score = 72.0
    breakdown.append({"factor": "baseline", "effect": "+72",
                      "note": "Every site starts at 72; terrain and context "
                              "move it from there."})

    if avg_slope < 3:
        score += 15
        breakdown.append({"factor": "slope", "effect": "+15",
                          "note": f"Very gentle average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope < 8:
        score += 8
        breakdown.append({"factor": "slope", "effect": "+8",
                          "note": f"Gentle average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope > 25:
        score -= 22
        breakdown.append({"factor": "slope", "effect": "-22",
                          "note": f"Steep average slope "
                                  f"({avg_slope:.1f} deg)."})
    elif avg_slope > 15:
        score -= 12
        breakdown.append({"factor": "slope", "effect": "-12",
                          "note": f"Moderately steep average slope "
                                  f"({avg_slope:.1f} deg)."})
    else:
        breakdown.append({"factor": "slope", "effect": "0",
                          "note": f"Manageable average slope "
                                  f"({avg_slope:.1f} deg)."})

    # Elevation relief (total height range). Note: the old frontend checked
    # ">50" before ">100" so the bigger penalty could never fire; we check
    # largest first, which is clearly what was intended.
    if relief < 10:
        score += 5
        breakdown.append({"factor": "relief", "effect": "+5",
                          "note": f"Nearly level site ({relief:.0f} m of "
                                  "elevation change)."})
    elif relief > 100:
        score -= 18
        breakdown.append({"factor": "relief", "effect": "-18",
                          "note": f"Large elevation change ({relief:.0f} m)."})
    elif relief > 50:
        score -= 8
        breakdown.append({"factor": "relief", "effect": "-8",
                          "note": f"Notable elevation change ({relief:.0f} m)."})
    else:
        breakdown.append({"factor": "relief", "effect": "0",
                          "note": f"Moderate elevation change "
                                  f"({relief:.0f} m)."})

    build_bonus = min(buildable / 100.0 * 10.0, 10.0)
    score += build_bonus
    breakdown.append({"factor": "buildable area", "effect": f"+{build_bonus:.0f}",
                      "note": f"{buildable:.0f}% of the site has slope gentle "
                              "enough to build on."})

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
        if water_frac is None:
            breakdown.append({"factor": "open water", "effect": "0",
                              "note": "Water sources unavailable; open-water "
                                      "coverage unknown, not evaluated."})
        elif water_frac > 0.02:
            # Penalty grows with coverage; heavy coverage adds hard caps so
            # good terrain math can never rescue a lake.
            penalty = round(80 * water_frac)
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

        # --- Wetlands (the vegetated kind, beyond any open water). ---
        if wetlands.get("status") != "ok":
            breakdown.append({"factor": "wetlands", "effect": "0",
                              "note": "Wetland source unavailable; unknown, "
                                      "not evaluated."})
        else:
            wetland_frac = wetlands.get("coverage_fraction") or 0.0
            # Only count the portion that is not already penalized as water.
            veg_frac = max(0.0, wetland_frac - (water_frac or 0.0))
            if veg_frac > 0.05:
                penalty = round(min(40, 45 * veg_frac))
                score -= penalty
                if wetland_frac >= NO_GO_WETLAND_FRACTION:
                    caps.append(30)
                    force_no_go = True
                else:
                    force_caution = True
                breakdown.append({"factor": "wetlands", "effect": f"-{penalty}",
                                  "note": f"{veg_frac * 100:.0f}% of the site "
                                          "is mapped wetland. Building here "
                                          "usually needs federal permits "
                                          "(Clean Water Act Section 404)."})
            else:
                breakdown.append({"factor": "wetlands", "effect": "0",
                                  "note": "No significant mapped wetlands."})

        # --- FEMA flood zones. ---
        if flood.get("status") != "ok":
            breakdown.append({"factor": "flood zone", "effect": "0",
                              "note": "Flood source unavailable; unknown, "
                                      "not evaluated."})
        else:
            flood_high = bool(flood.get("in_high_risk_zone"))
            flood_frac = flood.get("high_risk_fraction")
            if flood_high:
                frac = flood_frac if flood_frac is not None else 0.5
                penalty = round(10 + 25 * frac)
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

    # ---- Verdict. ----
    if force_no_go or score < NO_GO_SCORE:
        verdict = "no-go"
    elif force_caution or score < CAUTION_SCORE:
        verdict = "caution"
    else:
        verdict = "go"

    label = ("Excellent" if score >= 80 else
             "Good" if score >= 65 else
             "Fair" if score >= 45 else "Challenging")

    # A verdict override can leave a high score with a worse verdict: for
    # example, lovely terrain that clips a FEMA flood zone still forces
    # CAUTION. Showing "CAUTION" right next to "Excellent" reads as a
    # contradiction, so the label is never allowed to outrank the verdict:
    # a caution site caps at "Good", a no-go site caps at "Fair".
    if verdict == "caution" and label == "Excellent":
        label = "Good"
    elif verdict == "no-go" and label in ("Excellent", "Good"):
        label = "Fair"

    return {
        "value": score,
        "verdict": verdict,
        "label": label,
        "buildable_area_pct": adjusted_buildable,
        "breakdown": breakdown,
        "note": f"{label} ({score}/100), verdict: {verdict.upper()}. "
                "See breakdown for the reasons.",
    }


# ---------------------------------------------------------------------------
# Earthwork cost: the "cost-to-develop" layer.
# ---------------------------------------------------------------------------
# US average unit rates the old frontend used: $18 per cubic meter to cut
# (excavate and haul) and $14 per cubic meter to fill (import and compact).
CUT_RATE_USD_PER_M3 = 18.0
FILL_RATE_USD_PER_M3 = 14.0

# Real bids swing widely with region, soil, haul distance, and fuel prices,
# so we publish a RANGE around the base estimate instead of one fake-precise
# number. 0.75x to 1.6x brackets typical regional variation.
RANGE_LOW_FACTOR = 0.75
RANGE_HIGH_FACTOR = 1.6


def earthwork_cost(cut_m3: float, fill_m3: float) -> dict:
    """
    Rough grading-and-earthwork cost estimate for cutting and filling the
    site to grade, returned as a low/high RANGE in US dollars.

    Returns:
      {
        "low_usd": ..., "high_usd": ..., "base_usd": ...,
        "cut_m3": ..., "fill_m3": ...,
        "note": the honesty caveat
      }
    """
    cut_m3 = max(0.0, float(cut_m3))
    fill_m3 = max(0.0, float(fill_m3))
    base = cut_m3 * CUT_RATE_USD_PER_M3 + fill_m3 * FILL_RATE_USD_PER_M3
    return {
        "low_usd": round(base * RANGE_LOW_FACTOR),
        "high_usd": round(base * RANGE_HIGH_FACTOR),
        "base_usd": round(base),
        "cut_m3": round(cut_m3, 1),
        "fill_m3": round(fill_m3, 1),
        "note": ("Rough preliminary estimate of grading and earthwork cost, "
                 f"from US average rates (${CUT_RATE_USD_PER_M3:.0f}/m3 cut, "
                 f"${FILL_RATE_USD_PER_M3:.0f}/m3 fill). Regional rates, "
                 "soil conditions, and haul distance vary significantly; "
                 "get local bids before budgeting."),
    }


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
