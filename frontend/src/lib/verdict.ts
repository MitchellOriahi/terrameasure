// lib/verdict.ts
// TerraMeasure's headline promise: a GO / CAUTION / NO-GO answer in about
// 60 seconds. This file turns a survey response into that verdict.
//
// HOW IT WORKS NOW: the backend computes the official score, verdict,
// breakdown, and earthwork cost server-side (it knows about water,
// wetlands, and flood zones, which the browser does not). When those
// fields are present on the response we use them as-is.
//
// FALLBACK ONLY: the deployed API on Render may be an older build that
// does not send `score` or `earthwork_cost` yet. For that case, and only
// that case, we keep the original client-side heuristic below. It is a
// simple documented formula, not survey science, and every screen that
// shows it also shows "Preliminary and uncertified".

import type { ScoreFactor, SurveyResponse } from "./api";

export type Verdict = "GO" | "CAUTION" | "NO-GO";

export interface SiteAssessment {
  score: number; // 0 to 100
  verdict: Verdict;
  label: string | null; // backend's word ("Good", "Fair", ...), if any
  costLow: number; // estimated earthwork cost range, USD
  costHigh: number;
  // Water-adjusted buildable % from the backend, or the plain slope-based
  // % when the backend did not send a score.
  buildablePct: number;
  // "Why this verdict" lines from the backend; empty for old backends.
  breakdown: ScoreFactor[];
  // True when everything above came from the server (the trustworthy
  // path); false means the client fallback heuristic produced it.
  fromBackend: boolean;
}

/** Map a 0-100 score to the verdict bands the CEO spec defines. */
export function verdictFromScore(score: number): Verdict {
  if (score >= 70) return "GO";
  if (score >= 40) return "CAUTION";
  return "NO-GO";
}

/** The backend sends lowercase verdicts; the UI shows them uppercase. */
function verdictFromBackend(v: "go" | "caution" | "no-go"): Verdict {
  if (v === "go") return "GO";
  if (v === "caution") return "CAUTION";
  return "NO-GO";
}

export function assessSite(r: SurveyResponse): SiteAssessment {
  // ---- Preferred path: the backend already did the thinking ----
  if (r.score) {
    // Cost: use the server range when present; otherwise fall back to the
    // client bracket (the two can arrive independently on old builds).
    const cost = r.earthwork_cost;
    const fallbackCost = clientCostRange(r);
    return {
      score: Math.round(r.score.value),
      verdict: verdictFromBackend(r.score.verdict),
      label: r.score.label ?? null,
      costLow: cost ? roundToK(cost.low_usd) : fallbackCost.low,
      costHigh: cost ? roundToK(cost.high_usd) : fallbackCost.high,
      buildablePct: r.score.buildable_area_pct,
      breakdown: r.score.breakdown ?? [],
      fromBackend: true,
    };
  }

  // ---- Fallback path: old backend, derive everything client-side ----
  // Score: mostly "how much of the site is buildable" (slope under 8
  // degrees), with a penalty for steep average slope. Clamped to 0-100.
  const buildable = r.buildable_area_pct; // already a 0-100 percentage
  const slopePenalty = Math.min(r.avg_slope.value / 30, 1) * 30;
  const score = Math.round(
    Math.max(0, Math.min(100, buildable * 0.75 + (30 - slopePenalty))),
  );
  const cost = clientCostRange(r);

  return {
    score,
    verdict: verdictFromScore(score),
    label: null,
    costLow: cost.low,
    costHigh: cost.high,
    buildablePct: buildable,
    breakdown: [],
    fromBackend: false,
  };
}

// Earthwork cost, client version: moving dirt in the US typically runs a
// few dollars to the mid-teens per cubic meter depending on region, soil
// and access. We take total cut + fill volume and bracket it with $7 and
// $14 per m3. A rough planning range, labeled as such in the UI.
function clientCostRange(r: SurveyResponse): { low: number; high: number } {
  const totalM3 = r.cut_volume.value + r.fill_volume.value;
  return { low: roundToK(totalM3 * 7), high: roundToK(totalM3 * 14) };
}

/** Round to the nearest $1,000 so the range reads like a planning number. */
function roundToK(usd: number): number {
  return Math.round(usd / 1000) * 1000;
}

/** "$12k" style label for the cost range. */
export function fmtUsdK(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1000) return `$${Math.round(usd / 1000)}k`;
  return `$${Math.round(usd)}`;
}
