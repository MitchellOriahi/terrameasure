// components/results/ResultsContent.tsx
// The body of the results view: verdict banner, cost range, score dial,
// metric rows, elevation chart. This one component is reused in two
// homes: the desktop right-side panel and the mobile bottom sheet, so
// it knows nothing about panels, only about content.

import { useMemo, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { SurveyContext, SurveyResponse } from "@/lib/api";
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

  // Score, verdict and cost range. The backend computes these when it
  // can; assessSite falls back to a client heuristic for old backends
  // (see lib/verdict.ts for the whole story).
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
            {/* The backend's one-word grade ("Good", "Fair", ...), when
                the server computed this verdict */}
            {assessment.label && (
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
                    {item.note}
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
        {/* When the backend fell back to a coarser DEM it says so here */}
        {survey.dem_source_note ? ` ${survey.dem_source_note}` : ""} Tip: turn
        on the Contours layer to see this survey's contour lines on the map.
      </p>

      {/* ---- The disclaimer, verbatim from the backend when present ---- */}
      <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
        {survey.disclaimer ?? "Preliminary and uncertified"}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------
// Risk flags: what the federal context layers found on this site.
// Three honest rules:
//   1. An "unavailable" source is SHOWN as unavailable, never hidden.
//      Unknown is not the same as clear.
//   2. Lots of open water (over 30% of the site) gets the loud red row.
//   3. Every row names its data source.
// ------------------------------------------------------------------

/** "0.42" -> "42%" for the coverage fractions (which are 0 to 1). */
function fmtPct(fraction: number | null): string {
  if (fraction === null || fraction === undefined) return "?";
  return `${Math.round(fraction * 100)}%`;
}

/** One risk row: a title line, a detail line, and the source name. */
function RiskRow({
  title,
  detail,
  source,
  tone,
}: {
  title: string;
  detail: string;
  source: string;
  tone: "ok" | "warn" | "danger" | "unknown";
}) {
  const toneClass =
    tone === "danger"
      ? "border-nogo/40 bg-nogo/10"
      : tone === "warn"
        ? "border-caution/40 bg-caution/10"
        : "border-line bg-transparent";
  const titleClass =
    tone === "danger"
      ? "text-nogo"
      : tone === "warn"
        ? "text-caution"
        : tone === "unknown"
          ? "text-muted"
          : "text-foreground";
  return (
    <li className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div
        className={`flex items-center gap-1.5 text-xs font-medium ${titleClass}`}
      >
        {(tone === "danger" || tone === "warn") && (
          <AlertTriangle size={12} className="shrink-0" />
        )}
        {title}
      </div>
      <div className="text-[11px] leading-snug text-muted">{detail}</div>
      <div className="mt-0.5 text-[10px] text-muted/80">Source: {source}</div>
    </li>
  );
}

function RiskFlags({ context }: { context: SurveyContext }) {
  const { water, wetlands, flood } = context;
  const rows: ReactNode[] = [];

  // ---- Open water ----
  if (water.status === "unavailable") {
    rows.push(
      <RiskRow
        key="water"
        title="Open water: could not check (source unavailable)"
        detail="The waterbody service did not answer. Unknown, not clear."
        source={water.source}
        tone="unknown"
      />,
    );
  } else {
    // Prefer the combined open-water estimate (it also counts wetland
    // open water); fall back to the waterbody coverage alone.
    const frac = context.open_water_fraction ?? water.coverage_fraction ?? 0;
    const names = water.waterbodies
      .map((w) => w.name || w.feature_type || "unnamed waterbody")
      .slice(0, 3)
      .join(", ");
    if (frac > 0.3) {
      // A site that is nearly a third water is a headline, not a footnote.
      rows.push(
        <RiskRow
          key="water"
          title={`Open water covers about ${fmtPct(frac)} of this site`}
          detail={names ? `Waterbodies: ${names}.` : "Mapped open water."}
          source={water.source}
          tone="danger"
        />,
      );
    } else if (frac > 0.02 || water.waterbodies.length > 0) {
      rows.push(
        <RiskRow
          key="water"
          title={`Open water: about ${fmtPct(frac)} of the site`}
          detail={names ? `Waterbodies: ${names}.` : "Minor mapped water."}
          source={water.source}
          tone="warn"
        />,
      );
    } else {
      rows.push(
        <RiskRow
          key="water"
          title="Open water: none mapped on this site"
          detail="No significant waterbodies intersect the outline."
          source={water.source}
          tone="ok"
        />,
      );
    }
  }

  // ---- Wetlands ----
  if (wetlands.status === "unavailable") {
    rows.push(
      <RiskRow
        key="wetlands"
        title="Wetlands: could not check (source unavailable)"
        detail="The wetlands inventory did not answer. Unknown, not clear."
        source={wetlands.source}
        tone="unknown"
      />,
    );
  } else if (wetlands.wetland_types.length > 0) {
    rows.push(
      <RiskRow
        key="wetlands"
        title={`Wetlands: about ${fmtPct(wetlands.coverage_fraction)} of the site`}
        detail={`Types: ${wetlands.wetland_types.join(", ")}. Wetlands often need permits to disturb.`}
        source={wetlands.source}
        tone="warn"
      />,
    );
  } else {
    rows.push(
      <RiskRow
        key="wetlands"
        title="Wetlands: none mapped on this site"
        detail="No inventoried wetlands intersect the outline."
        source={wetlands.source}
        tone="ok"
      />,
    );
  }

  // ---- Flood zones ----
  if (flood.status === "unavailable") {
    rows.push(
      <RiskRow
        key="flood"
        title="Flood zones: could not check (source unavailable)"
        detail="The flood hazard service did not answer. Unknown, not clear."
        source={flood.source}
        tone="unknown"
      />,
    );
  } else if (flood.zones.length > 0) {
    const zoneLabels = flood.zones
      .map((z) => `${z.zone}${z.high_risk ? " (high risk)" : ""}`)
      .join(", ");
    const high = flood.in_high_risk_zone === true;
    rows.push(
      <RiskRow
        key="flood"
        title={
          high
            ? "Flood: site touches a high-risk FEMA zone"
            : "Flood: site is in mapped FEMA zones"
        }
        detail={`Zones: ${zoneLabels}.${
          high && flood.high_risk_fraction !== null
            ? ` About ${fmtPct(flood.high_risk_fraction)} of the site is high risk.`
            : ""
        }`}
        source={flood.source}
        tone={high ? "danger" : "ok"}
      />,
    );
  } else {
    rows.push(
      <RiskRow
        key="flood"
        title="Flood zones: none mapped on this site"
        detail="No FEMA flood zones intersect the outline."
        source={flood.source}
        tone="ok"
      />,
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">
        Risk flags
      </div>
      <ul className="flex flex-col gap-2">{rows}</ul>
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
