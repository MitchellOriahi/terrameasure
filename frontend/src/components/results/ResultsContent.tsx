// components/results/ResultsContent.tsx
// The body of the results view: verdict banner, cost range, score dial,
// metric rows, elevation chart. This one component is reused in two
// homes: the desktop right-side panel and the mobile bottom sheet, so
// it knows nothing about panels, only about content.

import { useMemo } from "react";
import { X } from "lucide-react";
import type { MeasurementOut, SurveyResponse } from "@/lib/api";
import {
  polygonAreaM2,
  polygonPerimeterM,
  fmt,
  type LatLon,
} from "@/lib/geo";
import {
  areaPair,
  distancePair,
  elevationPair,
  elevValue,
  elevUnit,
  volumePair,
  cleanUnitText,
} from "@/lib/units";
import { assessSite, fmtUsdK, type Verdict } from "@/lib/verdict";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScoreDial } from "./ScoreDial";
import { MetricRow } from "./MetricRow";
import { ElevationChart } from "./ElevationChart";
import { RiskFlags } from "./RiskFlags";
import { ShareReport } from "./ShareReport";
import { SaveSurvey } from "./SaveSurvey";
import { Site3DEntryButton } from "@/components/site3d/Site3DEntryButton";
import { ScopeStrip } from "./ScopeStrip";
import { UnitsToggle } from "./UnitsToggle";

// Verdict banner styling: color + a one-line meaning. The verdict word
// itself is always text, so color is never the only signal.
// Exported because the shared-report page paints the same banner.
export const VERDICT_META: Record<
  Verdict,
  { className: string; blurb: string }
> = {
  GO: {
    className: "bg-go/10 border-go/40 text-go",
    blurb: "Terrain looks workable. Worth a site visit.",
  },
  CAUTION: {
    className: "bg-caution/10 border-caution/40 text-caution",
    blurb: "Buildable, but expect real earthwork or constraints.",
  },
  "NO-GO": {
    className: "bg-nogo/10 border-nogo/40 text-nogo",
    blurb: "Terrain is fighting you. Probably not worth the drive.",
  },
};

/**
 * Slope-confidence rule: any sentence that CHARACTERIZES the slope
 * ("very gentle average slope") must carry its error bound inline, so
 * the adjective can never sound more certain than the data. Exported
 * because the shared-report page applies the same rule.
 */
export function withSlopeBound(text: string, slope: MeasurementOut): string {
  // Only touch sentences that talk about slope, and never double-append
  // a bound onto text that already shows one.
  if (!/slope/i.test(text) || text.includes("±")) return text;
  return `${text} (${fmt(slope.value, 1)}° ± ${fmt(slope.error, 1)}°)`;
}

interface ResultsContentProps {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}

export function ResultsContent({ survey, vertices }: ResultsContentProps) {
  const clearSurvey = useAppStore((s) => s.clearSurvey);
  // Which measurement system to display (imperial by default, toggleable).
  const units = useAppStore((s) => s.units);

  // Score, verdict and cost range. The backend computes these when it
  // can; assessSite falls back to a client heuristic for old backends
  // (see lib/verdict.ts for the whole story).
  const assessment = useMemo(() => assessSite(survey), [survey]);
  const meta = VERDICT_META[assessment.verdict];

  // The one-sentence headline under the verdict word: the backend's
  // biggest-constraint sentence when present, the generic blurb otherwise.
  const headline = survey.score?.headline_reason ?? meta.blurb;

  // Area and perimeter come from the drawn outline (pure 2D geometry).
  // Their error bound is tied to the DEM cell size: you cannot trust an
  // outline more precisely than the grid under it.
  const outline = useMemo(() => {
    if (!vertices || vertices.length < 3) return null;
    const areaM2 = polygonAreaM2(vertices);
    const perimM = polygonPerimeterM(vertices);
    const cell = survey.cell_size_m;
    return {
      areaM2,
      perimM,
      areaErrM2: perimM * (cell / 2), // half a cell of slack along the edge
      perimErrM: vertices.length * (cell / 2),
    };
  }, [vertices, survey.cell_size_m]);

  // Every displayed pair (value + error, same unit) goes through
  // lib/units.ts so imperial/metric can never get out of sync.
  const area = outline ? areaPair(outline.areaM2, outline.areaErrM2, units) : null;
  const perim = outline
    ? distancePair(outline.perimM, outline.perimErrM, units)
    : null;

  const elevRangeM = survey.max_height - survey.min_height;
  // Range of two independently uncertain heights: errors add in quadrature
  // (sqrt of 2 factor). A simplification, and an honest one.
  const elevRange = elevationPair(
    elevRangeM,
    survey.vertical_error_m * Math.SQRT2,
    units,
  );
  const cut = volumePair(survey.cut_volume.value, survey.cut_volume.error, units);
  const fill = volumePair(
    survey.fill_volume.value,
    survey.fill_volume.error,
    units,
  );

  // Pad-based cost (newer backends): the realistic headline number.
  // Guarded hard because a concurrent backend build may or may not
  // send it, or send it half-formed.
  const padCost = survey.earthwork_cost?.pad_cost;
  const hasPadCost =
    padCost != null &&
    Number.isFinite(padCost.low_usd) &&
    Number.isFinite(padCost.high_usd);

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Verdict banner: the headline answer ---- */}
      <div
        className={`rounded-xl border px-4 py-3 ${meta.className}`}
        role="status"
      >
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold tracking-tight">
            {assessment.verdict}
            {/* The backend's one-word grade ("Good", "Fair", ...) only
                when there is no headline sentence: one qualifier under
                the verdict, never two. */}
            {assessment.label && !survey.score?.headline_reason && (
              <span className="ml-2 text-sm font-medium opacity-80">
                {assessment.label}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Clear survey"
            onClick={clearSurvey}
          >
            <X size={16} />
          </Button>
        </div>
        <p className="mt-0.5 text-xs text-foreground/80">
          {withSlopeBound(headline, survey.avg_slope)}
        </p>
      </div>

      {/* ---- Scope strip: what this verdict does NOT check ---- */}
      <ScopeStrip notChecked={survey.score?.not_checked} />

      {/* ---- Share this survey as a public read-only report link,
           and Save it to the signed-in user's profile ---- */}
      <ShareReport survey={survey} vertices={vertices} />
      <SaveSurvey survey={survey} vertices={vertices} />
      {/* Fly into a 3D view of this site (hides itself if unavailable) */}
      <Site3DEntryButton />

      {/* ---- Cost to develop: right under the verdict per spec ---- */}
      <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
        {hasPadCost ? (
          <>
            {/* Pad costing: what it costs to grade a building pad. This
                is the number a buyer can act on, so it leads. */}
            <div className="text-[11px] uppercase tracking-widest text-muted">
              Building pad earthwork
            </div>
            <div className="num mt-1 text-2xl font-semibold text-foreground">
              {fmtUsdK(padCost.low_usd)}
              <span className="mx-1 text-muted">to</span>
              {fmtUsdK(padCost.high_usd)}
            </div>
            <div className="text-[11px] text-muted">
              {padCost.note
                ? cleanUnitText(padCost.note)
                : "grading a building pad, not the whole site"}
            </div>
            {/* The old full-site figure stays visible but demoted, with
                a label that says what it really is. */}
            <div className="num mt-2 border-t border-line pt-2 text-[11px] text-muted">
              Theoretical full-site balance: {fmtUsdK(assessment.costLow)} to{" "}
              {fmtUsdK(assessment.costHigh)}
            </div>
          </>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-widest text-muted">
              Estimated earthwork cost
            </div>
            <div className="num mt-1 text-2xl font-semibold text-foreground">
              {fmtUsdK(assessment.costLow)}
              <span className="mx-1 text-muted">to</span>
              {fmtUsdK(assessment.costHigh)}
            </div>
            <div className="text-[11px] text-muted">
              rough planning range, from cut and fill volume
            </div>
          </>
        )}
      </div>

      {/* ---- Score dial: supports the verdict ---- */}
      <div className="flex justify-center py-1">
        <ScoreDial score={assessment.score} verdict={assessment.verdict} />
      </div>

      {/* ---- Why this verdict: the backend's score breakdown ----
           Only server-computed scores come with receipts; the client
           fallback has no breakdown, so this section simply disappears
           on old backends. */}
      {assessment.breakdown.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">
            Why this verdict
          </div>
          <ul className="flex flex-col gap-2">
            {assessment.breakdown.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                {/* The score effect: green for bonus, red for penalty,
                    muted for neutral. The +/- sign carries the meaning
                    too, so color is never the only signal. */}
                <span
                  className={`num w-9 shrink-0 text-right text-xs font-semibold ${
                    item.effect.startsWith("+")
                      ? "text-go"
                      : item.effect.startsWith("-")
                        ? "text-nogo"
                        : "text-muted"
                  }`}
                >
                  {item.effect}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium capitalize text-foreground">
                    {item.factor}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted">
                    {withSlopeBound(item.note, survey.avg_slope)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Risk flags: wetlands, water, flood from federal sources ---- */}
      {survey.context && <RiskFlags context={survey.context} />}

      {/* ---- The metric rows ---- */}
      <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-1">
        {/* Header row: name the section and hold the units switch */}
        <div className="flex items-center justify-between border-b border-line py-2">
          <span className="text-[11px] uppercase tracking-widest text-muted">
            Measurements
          </span>
          <UnitsToggle />
        </div>
        {area && (
          <MetricRow
            label="Area"
            value={area.value}
            unit={area.unit}
            error={`± ${area.err}`}
            note="from your drawn outline"
          />
        )}
        {perim && (
          <MetricRow
            label="Perimeter"
            value={perim.value}
            unit={perim.unit}
            error={`± ${perim.err}`}
          />
        )}
        <MetricRow
          label="Average slope"
          value={fmt(survey.avg_slope.value, 1)}
          unit={survey.avg_slope.unit}
          error={`± ${fmt(survey.avg_slope.error, 1)}`}
        />
        <MetricRow
          label="Buildable area"
          // Prefer the backend's water-adjusted number (open water is not
          // buildable no matter how flat it is); fall back to the plain
          // slope-based percentage on old backends.
          value={fmt(assessment.buildablePct, 0)}
          unit="%"
          qualifier="est. (no formal bound yet)"
          note={
            assessment.fromBackend
              ? "gentle slope, adjusted for open water"
              : "ground with slope under 8 degrees"
          }
        />
        <MetricRow
          label="Elevation range"
          value={elevRange.value}
          unit={elevRange.unit}
          error={`± ${elevRange.err}`}
          note={`${elevValue(survey.min_height, units)} to ${elevValue(survey.max_height, units)} ${elevUnit(units)}`}
        />
        <MetricRow
          label="Cut volume"
          value={cut.value}
          unit={cut.unit}
          error={`± ${cut.err}`}
          note="dirt to remove to reach balance grade"
        />
        <MetricRow
          label="Fill volume"
          value={fill.value}
          unit={fill.unit}
          error={`± ${fill.err}`}
          note="dirt to add to reach balance grade"
        />
        {/* What "balance grade" means, from the backend when it says so */}
        {survey.balance_grade &&
          Number.isFinite(survey.balance_grade.elevation_m) && (
            <p className="border-t border-line py-2 text-[11px] leading-snug text-muted">
              <span className="text-foreground/80">Balance grade:</span>{" "}
              <span className="num">
                {elevValue(survey.balance_grade.elevation_m, units, 1)}{" "}
                {elevUnit(units)}
              </span>
              {survey.balance_grade.note
                ? `, ${cleanUnitText(survey.balance_grade.note)}.`
                : "."}
            </p>
          )}
      </div>

      {/* ---- Elevation profile ---- */}
      <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-muted">
          Elevation profile (site diagonal)
        </div>
        <ElevationChart
          profile={survey.elevation_profile}
          verticalError={survey.vertical_error_m}
        />
      </div>

      {/* ---- Data source note ---- */}
      <p className="text-[11px] leading-relaxed text-muted">
        Elevation source: {survey.source}
        {/* Data vintage only when the backend actually knows it */}
        {survey.dem_data_vintage ? ` (${survey.dem_data_vintage})` : ""},{" "}
        {elevValue(survey.cell_size_m, units)} {elevUnit(units)} grid, vertical
        accuracy about ±{elevValue(survey.vertical_error_m, units, 1)}{" "}
        {elevUnit(units)}.
        {/* When the backend fell back to a coarser DEM it says so here */}
        {survey.dem_source_note ? ` ${cleanUnitText(survey.dem_source_note)}` : ""} Tip:
        turn on the Contours layer to see this survey's contour lines on the
        map.
      </p>

      {/* ---- The disclaimer, verbatim from the backend when present ---- */}
      <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
        {survey.disclaimer ?? "Preliminary and uncertified"}
      </p>
    </div>
  );
}

/** The small legal honesty line. Rendered by every results container. */
export function UncertifiedLabel() {
  return (
    <div className="pointer-events-none text-center text-[10px] uppercase tracking-widest text-muted">
      Preliminary and uncertified
    </div>
  );
}
