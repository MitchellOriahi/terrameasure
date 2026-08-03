// components/results/ResultsContent.tsx
// The body of the results view: verdict banner, cost range, score dial,
// metric rows, elevation chart. This one component is reused in two
// homes: the desktop right-side panel and the mobile bottom sheet, so
// it knows nothing about panels, only about content.

import { useMemo } from "react";
import { X } from "lucide-react";
import type { SurveyResponse } from "@/lib/api";
import {
  polygonAreaM2,
  polygonPerimeterM,
  fmt,
  fmtArea,
  fmtLength,
  type LatLon,
} from "@/lib/geo";
import { assessSite, fmtUsdK, type Verdict } from "@/lib/verdict";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScoreDial } from "./ScoreDial";
import { MetricRow } from "./MetricRow";
import { ElevationChart } from "./ElevationChart";

// Verdict banner styling: color + a one-line meaning. The verdict word
// itself is always text, so color is never the only signal.
const VERDICT_META: Record<
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

interface ResultsContentProps {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}

export function ResultsContent({ survey, vertices }: ResultsContentProps) {
  const clearSurvey = useAppStore((s) => s.clearSurvey);

  // Score, verdict and cost range. Derived client-side for now; the
  // backend will own these numbers soon (see lib/verdict.ts).
  const assessment = useMemo(() => assessSite(survey), [survey]);
  const meta = VERDICT_META[assessment.verdict];

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

  const area = outline ? fmtArea(outline.areaM2) : null;
  const areaErr = outline ? fmtArea(outline.areaErrM2) : null;
  const perim = outline ? fmtLength(outline.perimM) : null;

  const elevRange = survey.max_height - survey.min_height;
  // Range of two independently uncertain heights: errors add in quadrature
  // (sqrt of 2 factor). A simplification, and an honest one.
  const elevRangeErr = survey.vertical_error_m * Math.SQRT2;

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
        <p className="mt-0.5 text-xs text-foreground/80">{meta.blurb}</p>
      </div>

      {/* ---- Cost to develop: right under the verdict per spec ---- */}
      <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
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
      </div>

      {/* ---- Score dial: supports the verdict ---- */}
      <div className="flex justify-center py-1">
        <ScoreDial score={assessment.score} verdict={assessment.verdict} />
      </div>

      {/* ---- The metric rows ---- */}
      <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-1">
        {area && areaErr && outline && (
          <MetricRow
            label="Area"
            value={area.value}
            unit={area.unit}
            error={`± ${areaErr.value}`}
            note="from your drawn outline"
          />
        )}
        {perim && outline && (
          <MetricRow
            label="Perimeter"
            value={perim.value}
            unit={perim.unit}
            error={`± ${fmt(outline.perimErrM, 1)}`}
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
          value={fmt(survey.buildable_area_pct, 0)}
          unit="%"
          qualifier="est. (no formal bound yet)"
          note="ground with slope under 8 degrees"
        />
        <MetricRow
          label="Elevation range"
          value={fmt(elevRange, 1)}
          unit="m"
          error={`± ${fmt(elevRangeErr, 1)}`}
          note={`${fmt(survey.min_height, 0)} to ${fmt(survey.max_height, 0)} m`}
        />
        <MetricRow
          label="Cut volume"
          value={fmt(survey.cut_volume.value)}
          unit={survey.cut_volume.unit}
          error={`± ${fmt(survey.cut_volume.error)}`}
          note="dirt to remove to reach level grade"
        />
        <MetricRow
          label="Fill volume"
          value={fmt(survey.fill_volume.value)}
          unit={survey.fill_volume.unit}
          error={`± ${fmt(survey.fill_volume.error)}`}
          note="dirt to add to reach level grade"
        />
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
        Elevation source: {survey.source}, {survey.cell_size_m.toFixed(0)} m
        grid, vertical accuracy about ±{survey.vertical_error_m.toFixed(1)} m.
        Tip: turn on the Contours layer to see this survey's contour lines on
        the map.
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
