// lib/verdict.ts
// TerraMeasure's headline promise: a GO / CAUTION / NO-GO answer in about
// 60 seconds. This file turns raw survey numbers into that verdict.
//
// IMPORTANT HONESTY NOTE: the backend will eventually return the official
// score and verdict itself. Until that lands, we derive them client-side
// from buildable percentage and average slope. The formula is a simple,
// documented heuristic, not survey science, and every screen that shows
// it also shows "Preliminary and uncertified".

import type { SurveyResponse } from "./api";

export type Verdict = "GO" | "CAUTION" | "NO-GO";

export interface SiteAssessment {
  score: number; // 0 to 100
  verdict: Verdict;
  costLow: number; // estimated earthwork cost range, USD
  costHigh: number;
}

/** Map a 0-100 score to the verdict bands the CEO spec defines. */
export function verdictFromScore(score: number): Verdict {
  if (score >= 70) return "GO";
  if (score >= 40) return "CAUTION";
  return "NO-GO";
}

export function assessSite(r: SurveyResponse): SiteAssessment {
  // Score: mostly "how much of the site is buildable" (slope under 8
  // degrees), with a penalty for steep average slope. Clamped to 0-100.
  const buildable = r.buildable_area_pct; // already a 0-100 percentage
  const slopePenalty = Math.min(r.avg_slope.value / 30, 1) * 30;
  const score = Math.round(
    Math.max(0, Math.min(100, buildable * 0.75 + (30 - slopePenalty))),
  );

  // Earthwork cost: moving dirt in the US typically runs a few dollars to
  // the mid-teens per cubic meter depending on region, soil and access.
  // We take total cut + fill volume and bracket it with $7 and $14 per m3.
  // This is a rough planning range, and it is labeled as such in the UI.
  const totalM3 = r.cut_volume.value + r.fill_volume.value;
  const costLow = roundToK(totalM3 * 7);
  const costHigh = roundToK(totalM3 * 14);

  return { score, verdict: verdictFromScore(score), costLow, costHigh };
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
