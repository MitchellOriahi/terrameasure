// pages/ReportPage.tsx
// The public shared-report page, rendered at /r/{slug}.
//
// This is a DOCUMENT, not a map app screen: one scrolling column that a
// person who has never seen TerraMeasure can read top to bottom on a
// phone. It needs no login and touches no app state; everything comes
// from one GET /reports/{slug} call.
//
// Order of sections (per the strategy doc, "The report artifact"):
//   1. Verdict banner (GO / CAUTION / NO-GO, score, one-line reason)
//   2. Parcel facts strip (when the survey came from a parcel)
//   3. Score breakdown bars (no black-box score)
//   4. The map: satellite basemap + the surveyed outline, with an
//      overlay toggle when the contour/slope PNGs survived storage
//   5. Earthwork cost range with its assumptions
//   6. Elevation profile chart
//   7. Risk flags (wetlands / water / flood)
//   8. Error bounds box (every key number's +/- and the DEM source)
//   9. Footer: wordmark, date, verbatim disclaimer, "run your own" CTA
//
// This file is lazy-loaded from App.tsx so the map home screen never
// pays for it.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Map, Source, Layer } from "@vis.gl/react-maplibre";
import type { Feature, Polygon } from "geojson";
import { FileQuestion, Loader2, AlertTriangle } from "lucide-react";
import {
  fetchReport,
  ApiError,
  type ReportResponse,
  type ParcelResponse,
  type SurveyResponse,
} from "@/lib/api";
import {
  demImageCorners,
  polygonAreaM2,
  polygonPerimeterM,
  fmt,
  fmtArea,
  type LatLon,
} from "@/lib/geo";
import { assessSite, fmtUsdK, type SiteAssessment } from "@/lib/verdict";
import { SATELLITE_STYLE } from "@/components/map/basemaps";
import { VERDICT_META } from "@/components/results/ResultsContent";
import { RiskFlags } from "@/components/results/RiskFlags";
import { MetricRow } from "@/components/results/MetricRow";
import { ElevationChart } from "@/components/results/ElevationChart";
import { ScoreDial } from "@/components/results/ScoreDial";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { loadingMessage } from "@/hooks/useSurvey";

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

/** Pull the number out of an effect string like "+15" or "-22". */
function effectMagnitude(effect: string): number {
  const n = parseFloat(effect.replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.abs(n);
}

/**
 * The one-line reason under the big verdict. We lead with the WORST
 * negative factor from the score breakdown (that is the honest headline);
 * when nothing dragged the score down we fall back to the score's own
 * note, then to the generic verdict blurb.
 */
function headlineReason(a: SiteAssessment, survey: SurveyResponse): string {
  const negatives = a.breakdown
    .filter((b) => b.effect.trim().startsWith("-"))
    .sort((x, y) => effectMagnitude(y.effect) - effectMagnitude(x.effect));
  if (negatives.length > 0) return negatives[0].note;
  if (survey.score?.note) return survey.score.note;
  return VERDICT_META[a.verdict].blurb;
}

/** "2026-08-03T18:00:00Z" -> "August 3, 2026". */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** One label/value line of the parcel strip. Missing values stay honest. */
function FactRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className="num min-w-0 truncate text-right text-xs text-foreground">
        {value ?? "not published"}
      </span>
    </div>
  );
}

/** A titled card, the visual unit every report section lives in. */
function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------
// The static map: satellite tiles, the surveyed polygon, and (when the
// overlay PNGs survived storage) a small drape toggle.
// ------------------------------------------------------------------
type OverlayChoice = "none" | "contours" | "slope";

function ReportMap({
  survey,
  vertices,
}: {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}) {
  const [overlay, setOverlay] = useState<OverlayChoice>("none");

  // The polygon as GeoJSON (rings close on themselves).
  const feature = useMemo<Feature<Polygon> | null>(() => {
    if (!vertices || vertices.length < 3) return null;
    const ring = vertices.map((v) => [v.lon, v.lat]);
    ring.push(ring[0]);
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }, [vertices]);

  // Fit the camera to the drawn outline, or (when the report was saved
  // without vertices) to the DEM footprint the backend reported.
  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (vertices && vertices.length >= 3) {
      const lats = vertices.map((v) => v.lat);
      const lons = vertices.map((v) => v.lon);
      return [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ];
    }
    if (survey.dem_center_lat) {
      const c = demImageCorners(survey);
      return [c[3], c[1]]; // bottom-left, top-right
    }
    return null;
  }, [vertices, survey]);

  // Where to pin the overlay images, and which images we actually have.
  const corners = useMemo(
    () => (survey.dem_center_lat ? demImageCorners(survey) : null),
    [survey],
  );
  const hasContours = Boolean(survey.contour_map_clean_b64) && corners !== null;
  const hasSlope = Boolean(survey.slope_map_clean_b64) && corners !== null;

  if (!bounds) return null; // nothing to frame a map around

  const overlayB64 =
    overlay === "contours"
      ? survey.contour_map_clean_b64
      : overlay === "slope"
        ? survey.slope_map_clean_b64
        : undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="h-64 sm:h-80">
        <Map
          id="report-map"
          initialViewState={{
            bounds,
            fitBoundsOptions: { padding: 48 },
          }}
          mapStyle={SATELLITE_STYLE}
          style={{ width: "100%", height: "100%" }}
          attributionControl={{ compact: true }}
          // A report is a picture, not an app: freeze every gesture.
          dragPan={false}
          dragRotate={false}
          scrollZoom={false}
          doubleClickZoom={false}
          touchZoomRotate={false}
          touchPitch={false}
          keyboard={false}
          cursor="default"
        >
          {/* The overlay drape, pinned to the DEM's exact footprint */}
          {overlayB64 && corners && (
            <Source
              id="report-overlay"
              type="image"
              url={`data:image/png;base64,${overlayB64}`}
              coordinates={corners}
            >
              <Layer
                id="report-overlay-layer"
                type="raster"
                paint={{ "raster-opacity": 0.85, "raster-fade-duration": 0 }}
              />
            </Source>
          )}
          {/* The surveyed outline itself */}
          {feature && (
            <Source id="report-shape" type="geojson" data={feature}>
              <Layer
                id="report-shape-fill"
                type="fill"
                paint={{ "fill-color": "#34d399", "fill-opacity": 0.1 }}
              />
              <Layer
                id="report-shape-line"
                type="line"
                paint={{ "line-color": "#34d399", "line-width": 2.5 }}
              />
            </Source>
          )}
        </Map>
      </div>

      {/* Overlay chips, only when the report actually stored the images */}
      {(hasContours || hasSlope) && (
        <div className="flex items-center gap-1 border-t border-line bg-surface-2/60 px-3 py-2">
          <span className="mr-1 text-[10px] uppercase tracking-widest text-muted">
            Overlay
          </span>
          {(
            [
              ["none", "None", true],
              ["contours", "Contours", hasContours],
              ["slope", "Slope", hasSlope],
            ] as [OverlayChoice, string, boolean][]
          )
            .filter(([, , available]) => available)
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setOverlay(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  overlay === key
                    ? "bg-accent-deep text-accent-bright"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// The report body, rendered once the fetch succeeds
// ------------------------------------------------------------------
function ReportBody({ report }: { report: ReportResponse }) {
  const survey = report.snapshot.survey;
  const parcel: ParcelResponse | null = report.snapshot.parcel ?? null;
  const vertices: LatLon[] | null = report.snapshot.vertices ?? null;

  const assessment = useMemo(() => assessSite(survey), [survey]);
  const meta = VERDICT_META[assessment.verdict];
  const reason = headlineReason(assessment, survey);

  // Browser tab title: the verdict IS the headline.
  useEffect(() => {
    document.title = `TerraMeasure Report: ${assessment.verdict} ${assessment.score}/100`;
    return () => {
      document.title = "TerraMeasure";
    };
  }, [assessment]);

  // Outline area, same 2D geometry + honesty math as the live panel.
  const outline = useMemo(() => {
    if (!vertices || vertices.length < 3) return null;
    const areaM2 = polygonAreaM2(vertices);
    const perimM = polygonPerimeterM(vertices);
    return {
      area: fmtArea(areaM2),
      // Half a DEM cell of slack along every meter of edge.
      areaErr: fmtArea(perimM * (survey.cell_size_m / 2)),
    };
  }, [vertices, survey.cell_size_m]);

  // The largest bar in the breakdown sets the scale for all the bars.
  const maxEffect = Math.max(
    1,
    ...assessment.breakdown.map((b) => effectMagnitude(b.effect)),
  );

  // Show the parcel source as a short host name, not a giant URL.
  let parcelSource: string | null = null;
  if (parcel?.source) {
    try {
      parcelSource = new URL(parcel.source).hostname;
    } catch {
      parcelSource = parcel.source;
    }
  }

  const elevRange = survey.max_height - survey.min_height;
  const elevRangeErr = survey.vertical_error_m * Math.SQRT2;

  return (
    <div className="flex flex-col gap-4">
      {/* ---- 1. Verdict banner ---- */}
      <section
        className={`rounded-xl border px-5 py-4 ${meta.className}`}
        role="status"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-3xl font-bold tracking-tight sm:text-4xl">
              {assessment.verdict}
            </div>
            <div className="num mt-1 text-sm text-foreground/80">
              Site score {assessment.score}/100
              {assessment.label ? ` (${assessment.label})` : ""}
            </div>
            <p className="mt-2 text-sm leading-snug text-foreground/90">
              {reason}
            </p>
          </div>
          <div className="hidden shrink-0 sm:block">
            <ScoreDial
              score={assessment.score}
              verdict={assessment.verdict}
              size={110}
            />
          </div>
        </div>
      </section>

      {/* ---- 2. Parcel facts strip ---- */}
      {parcel && (
        <SectionCard title="Parcel">
          <FactRow label="APN" value={parcel.parcel_id} />
          <FactRow label="Owner" value={parcel.owner} />
          <FactRow
            label="Acreage"
            value={parcel.acreage !== null ? fmt(parcel.acreage, 2) : null}
          />
          <FactRow label="County" value={parcel.county} />
          <FactRow label="Source" value={parcelSource} />
        </SectionCard>
      )}

      {/* ---- 3. Score breakdown bars: no black-box score ---- */}
      {assessment.breakdown.length > 0 && (
        <SectionCard title="Why this score">
          <ul className="flex flex-col gap-3">
            {assessment.breakdown.map((item, i) => {
              const mag = effectMagnitude(item.effect);
              const positive = item.effect.trim().startsWith("+");
              const negative = item.effect.trim().startsWith("-");
              return (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium capitalize text-foreground">
                      {item.factor}
                    </span>
                    <span
                      className={`num text-xs font-semibold ${
                        positive
                          ? "text-go"
                          : negative
                            ? "text-nogo"
                            : "text-muted"
                      }`}
                    >
                      {item.effect}
                    </span>
                  </div>
                  {/* The bar: length shows how hard this factor pushed */}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${
                        positive
                          ? "bg-go"
                          : negative
                            ? "bg-nogo"
                            : "bg-line"
                      }`}
                      style={{
                        width: `${Math.max(3, (mag / maxEffect) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted">
                    {item.note}
                  </p>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {/* ---- 4. The map that argues the verdict ---- */}
      <ReportMap survey={survey} vertices={vertices} />

      {/* ---- 5. Earthwork cost range ---- */}
      <SectionCard title="Estimated earthwork cost">
        <div className="num text-2xl font-semibold text-foreground">
          {fmtUsdK(assessment.costLow)}
          <span className="mx-1 text-muted">to</span>
          {fmtUsdK(assessment.costHigh)}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {survey.earthwork_cost?.note ??
            "Rough planning range from cut and fill volume, not a contractor quote."}
        </p>
      </SectionCard>

      {/* ---- 6. Elevation profile ---- */}
      <SectionCard title="Elevation profile (site diagonal)">
        <ElevationChart
          profile={survey.elevation_profile}
          verticalError={survey.vertical_error_m}
        />
      </SectionCard>

      {/* ---- 7. Risk flags ---- */}
      {survey.context && <RiskFlags context={survey.context} />}

      {/* ---- 8. Error bounds box: the trust signature ---- */}
      <SectionCard title="Error bounds">
        <div>
          {outline && (
            <MetricRow
              label="Area"
              value={outline.area.value}
              unit={outline.area.unit}
              error={`± ${outline.areaErr.value}`}
              note="from the surveyed outline"
            />
          )}
          <MetricRow
            label="Average slope"
            value={fmt(survey.avg_slope.value, 1)}
            unit={survey.avg_slope.unit}
            error={`± ${fmt(survey.avg_slope.error, 1)}`}
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
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Elevation source: {survey.source}, {survey.cell_size_m.toFixed(0)} m
          grid, vertical accuracy about ±{survey.vertical_error_m.toFixed(1)}{" "}
          m.{survey.dem_source_note ? ` ${survey.dem_source_note}` : ""}
        </p>
      </SectionCard>

      {/* ---- 9. Footer ---- */}
      <footer className="border-t border-line pt-4 pb-2 text-center">
        <div className="flex justify-center">
          <Wordmark />
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Report created {fmtDate(report.created_at)}
        </p>
        <p className="mx-auto mt-3 max-w-md text-[10px] leading-relaxed text-muted">
          {report.disclaimer}
        </p>
        <Link to="/" className="mt-4 inline-block">
          <Button variant="primary" size="md" tabIndex={-1}>
            Run your own survey free
          </Button>
        </Link>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------
// Loading skeleton and friendly 404
// ------------------------------------------------------------------
function LoadingSkeleton() {
  // Elapsed-seconds ticker so the cold-start copy stays honest here too.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Gray pulsing blocks shaped like the real sections */}
      <div className="h-28 animate-pulse rounded-xl bg-surface-2" />
      <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted">
        <Loader2 className="animate-spin text-accent" size={14} />
        {loadingMessage(elapsed)}
      </div>
    </div>
  );
}

function NotFound() {
  useEffect(() => {
    document.title = "TerraMeasure Report";
    return () => {
      document.title = "TerraMeasure";
    };
  }, []);
  return (
    <div className="glass p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-deep">
        <FileQuestion className="text-accent-bright" size={26} />
      </div>
      <h1 className="text-xl font-semibold text-foreground">
        Report not found
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This report does not exist or was removed. Check that the link was
        copied completely.
      </p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="primary" size="sm" tabIndex={-1}>
          Run your own survey free
        </Button>
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// The page shell: fetch, then hand off to the right state
// ------------------------------------------------------------------
export default function ReportPage() {
  const { slug } = useParams<{ slug: string }>();

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["report", slug],
    queryFn: () => fetchReport(slug ?? ""),
    enabled: Boolean(slug),
    staleTime: Infinity, // a stored report never changes
  });

  const notFound =
    !slug || (error instanceof ApiError && error.status === 404);

  return (
    <div className="min-h-dvh bg-background">
      {/* Slim header so a stranger knows whose document this is */}
      <header className="pt-safe border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Wordmark />
          <Link to="/">
            <Button variant="ghost" size="sm" tabIndex={-1}>
              Run your own survey free
            </Button>
          </Link>
        </div>
      </header>

      <main className="pb-safe mx-auto max-w-2xl px-4 py-5">
        {notFound ? (
          <NotFound />
        ) : error ? (
          // A real failure (server down, cold-start timeout): offer retry.
          <div className="glass flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-nogo">
              <AlertTriangle size={18} />
              <span className="text-sm font-semibold">
                Could not load this report
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              {error.message}
            </p>
            <div>
              <Button variant="primary" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : isPending || !data ? (
          <LoadingSkeleton />
        ) : (
          <ReportBody report={data} />
        )}
      </main>
    </div>
  );
}
