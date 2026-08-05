// pages/ReportPage.tsx
// The public shared-report page, rendered at /r/{slug}.
//
// This is a DOCUMENT, not a map app screen: one scrolling column that a
// person who has never seen TerraMeasure can read top to bottom on a
// phone. It needs no login and touches no app state; everything comes
// from one GET /reports/{slug} call.
//
// Order of sections (per the strategy doc, "The report artifact"):
//   0. Site identity header (WHERE this is: name, county, coordinates)
//   1. Verdict banner (GO / CAUTION / NO-GO, score, one-line reason)
//      plus the scope strip (what the verdict does NOT check)
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
// A sticky mini-header (site name, score, verdict, Share) slides in
// once the reader scrolls past the verdict banner, so the headline and
// the share action are always one glance away.
//
// This file is lazy-loaded from App.tsx so the map home screen never
// pays for it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Map, Source, Layer, type MapRef } from "@vis.gl/react-maplibre";
import type { Feature, Polygon } from "geojson";
import {
  FileQuestion,
  Loader2,
  AlertTriangle,
  Share2,
  Check,
} from "lucide-react";
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
  type LatLon,
} from "@/lib/geo";
import {
  areaPair,
  elevationPair,
  elevValue,
  elevUnit,
  volumePair,
  cleanUnitText,
  M2_PER_ACRE,
} from "@/lib/units";
import { assessSite, fmtUsdK, type SiteAssessment } from "@/lib/verdict";
import { SATELLITE_STYLE } from "@/components/map/basemaps";
import { VERDICT_META, withSlopeBound } from "@/components/results/ResultsContent";
import { RiskFlags } from "@/components/results/RiskFlags";
import { MetricRow } from "@/components/results/MetricRow";
import { ElevationChart } from "@/components/results/ElevationChart";
import { ScoreDial } from "@/components/results/ScoreDial";
import { ScopeStrip } from "@/components/results/ScopeStrip";
import { UnitsToggle } from "@/components/results/UnitsToggle";
import { copyText } from "@/components/results/ShareReport";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { loadingMessage } from "@/hooks/useSurvey";
import { useAppStore } from "@/store/appStore";
import "./report.css";

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

/** Pull the number out of an effect string like "+15" or "-22". */
function effectMagnitude(effect: string): number {
  const n = parseFloat(effect.replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.abs(n);
}

/**
 * The one-line reason under the big verdict, used only when the backend
 * did not send its own headline_reason. We lead with the WORST negative
 * factor from the score breakdown (that is the honest headline); when
 * nothing dragged the score down we fall back to the score's own note,
 * then to the generic verdict blurb.
 */
function fallbackHeadline(a: SiteAssessment, survey: SurveyResponse): string {
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
// Site identity: WHERE is this report about?
//
// The best available name wins: the title the sharer typed (or the
// parcel address the app filled in), else "Near {lat}, {lon}". The
// backend geocoder only does forward search (name to coordinates), so
// there is no reverse lookup to lean on; county comes from parcel data
// when the survey started from a parcel.
// ------------------------------------------------------------------

/** Average of the polygon corners: good enough to say "here". */
function centroidOf(vertices: LatLon[] | null): LatLon | null {
  if (!vertices || vertices.length === 0) return null;
  return {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
    lon: vertices.reduce((s, v) => s + v.lon, 0) / vertices.length,
  };
}

function IdentityHeader({
  title,
  parcel,
  center,
  acreage,
  acreageSource,
}: {
  title: string;
  parcel: ParcelResponse | null;
  center: LatLon | null;
  acreage: number | null;
  acreageSource: "recorded" | "outline" | null;
}) {
  return (
    <header className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {/* County line only when parcel data told us one */}
          {parcel?.county && (
            <p className="mt-0.5 text-xs text-muted">{parcel.county}</p>
          )}
        </div>
        {/* The compact ft/m switch lives up here so a reader can flip
            every number on the page before reading any of them */}
        <div className="shrink-0 pt-0.5">
          <UnitsToggle />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {center && (
          <span className="num text-[11px] text-muted">
            {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
          </span>
        )}
        {acreage !== null && (
          <span className="num text-[11px] text-muted">
            {fmt(acreage, 2)} acres
            {acreageSource === "outline" ? " (drawn outline)" : ""}
          </span>
        )}
        {/* Parcel ID row ONLY when parcel data exists; no blank rows */}
        {parcel?.parcel_id && (
          <span className="num text-[11px] text-muted">
            APN {parcel.parcel_id}
          </span>
        )}
      </div>
    </header>
  );
}

// ------------------------------------------------------------------
// Sticky mini-header: appears after the verdict banner scrolls away.
// Transform-only animation (translateY), safe-area aware, always in
// the DOM so showing it never causes layout work.
// ------------------------------------------------------------------
function StickyHeader({
  visible,
  title,
  assessment,
}: {
  visible: boolean;
  title: string;
  assessment: SiteAssessment;
}) {
  const meta = VERDICT_META[assessment.verdict];
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    // Phones get the native share sheet; desktops copy the link.
    if ("share" in navigator) {
      try {
        await navigator.share({ title: `TerraMeasure report: ${title}`, url });
        return;
      } catch {
        // User closed the sheet, or share failed; fall through to copy.
      }
    }
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-0 z-40 transition-transform duration-200 ease-out ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
      style={{ willChange: "transform" }}
    >
      <div className="pt-safe border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {/* Verdict chip: word + color, never color alone */}
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.className}`}
          >
            {assessment.verdict}
          </span>
          <span className="num shrink-0 text-xs text-muted">
            {assessment.score}/100
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            aria-label="Share this report"
            // Keyboard users should reach this only when it is on screen
            tabIndex={visible ? 0 : -1}
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
            {copied ? "Copied" : "Share"}
          </Button>
        </div>
      </div>
    </div>
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

  // MapLibre measures its container the moment it mounts. On this page
  // the map mounts right as the loading skeleton swaps out for the real
  // report, so that first measurement can happen before the layout has
  // settled and the satellite picture ends up filling only part of its
  // card. The cure is to re-measure after mount: mapRef gives us a
  // handle to call map.resize(), and a ResizeObserver on the card keeps
  // the map honest if the card's size ever changes again (fonts
  // finishing, the window resizing, phone rotation).
  const mapRef = useRef<MapRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const remeasure = () => mapRef.current?.resize();
    const observer = new ResizeObserver(remeasure);
    observer.observe(box);
    // One delayed re-measure covers the "settled but never resized
    // again" case the observer alone would miss.
    const timer = window.setTimeout(remeasure, 350);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

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
    <div className="report-map overflow-hidden rounded-xl border border-line">
      <div ref={boxRef} className="h-64 sm:h-80">
        <Map
          ref={mapRef}
          id="report-map"
          // Belt and suspenders with the effect above: the moment the
          // map's own style finishes loading, re-check the container.
          onLoad={(e) => e.target.resize()}
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
          {/* The surveyed outline itself: ~15% fill + solid stroke so
              the AOI reads clearly over any imagery */}
          {feature && (
            <Source id="report-shape" type="geojson" data={feature}>
              <Layer
                id="report-shape-fill"
                type="fill"
                paint={{ "fill-color": "#34d399", "fill-opacity": 0.15 }}
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
  const units = useAppStore((s) => s.units);

  const assessment = useMemo(() => assessSite(survey), [survey]);
  const meta = VERDICT_META[assessment.verdict];

  // The one-line reason under the verdict word: the backend's own
  // headline sentence when present, else the worst-factor fallback.
  // Either way, a slope claim carries its error bound inline.
  const reason = withSlopeBound(
    survey.score?.headline_reason ?? fallbackHeadline(assessment, survey),
    survey.avg_slope,
  );

  // ---- Site identity ----
  const center = useMemo(() => {
    const c = centroidOf(vertices);
    if (c) return c;
    // Reports saved without vertices still know the DEM's center.
    if (survey.dem_center_lat) {
      return { lat: survey.dem_center_lat, lon: survey.dem_center_lon };
    }
    return null;
  }, [vertices, survey]);

  // Best available site name, in order: sharer's title (or the parcel
  // address the share flow filled in), else plain coordinates. The
  // geocoder has no reverse mode, so we never pretend to know a name.
  const siteTitle =
    report.title ??
    parcel?.address ??
    (center ? `Near ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}` : "Surveyed site");

  // Outline area, same 2D geometry + honesty math as the live panel.
  const outline = useMemo(() => {
    if (!vertices || vertices.length < 3) return null;
    const areaM2 = polygonAreaM2(vertices);
    const perimM = polygonPerimeterM(vertices);
    return {
      areaM2,
      // Half a DEM cell of slack along every meter of edge.
      areaErrM2: perimM * (survey.cell_size_m / 2),
    };
  }, [vertices, survey.cell_size_m]);

  // Acreage for the identity header: the county's recorded number when
  // we have it, else the drawn outline's area (and we say which).
  const acreage =
    parcel?.acreage ?? (outline ? outline.areaM2 / M2_PER_ACRE : null);
  const acreageSource: "recorded" | "outline" | null =
    parcel?.acreage != null ? "recorded" : outline ? "outline" : null;

  // Browser tab title: the verdict IS the headline.
  useEffect(() => {
    document.title = `TerraMeasure Report: ${assessment.verdict} ${assessment.score}/100`;
    return () => {
      document.title = "TerraMeasure";
    };
  }, [assessment]);

  // ---- Sticky header visibility: on once the banner scrolls off-top ----
  const bannerRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const banner = bannerRef.current;
    if (!banner) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show the mini-header only when the banner left through the
        // TOP of the screen (scrolled past), not while it is still
        // below the fold during initial load.
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);

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

  // ---- Display measurements, converted through lib/units.ts ----
  const area = outline ? areaPair(outline.areaM2, outline.areaErrM2, units) : null;
  const elevRange = elevationPair(
    survey.max_height - survey.min_height,
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
  const padCost = survey.earthwork_cost?.pad_cost;
  const hasPadCost =
    padCost != null &&
    Number.isFinite(padCost.low_usd) &&
    Number.isFinite(padCost.high_usd);

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Sticky mini-header (slides in past the banner) ---- */}
      <StickyHeader visible={stuck} title={siteTitle} assessment={assessment} />

      {/* ---- 0. Site identity: what land is this about ---- */}
      <IdentityHeader
        title={siteTitle}
        parcel={parcel}
        center={center}
        acreage={acreage}
        acreageSource={acreageSource}
      />

      {/* ---- 1. Verdict banner ---- */}
      <section
        ref={bannerRef}
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
              {/* One qualifier under the verdict, never two: the label
                  word steps aside when a headline sentence exists */}
              {assessment.label && !survey.score?.headline_reason
                ? ` (${assessment.label})`
                : ""}
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

      {/* ---- Scope strip: what this verdict does NOT check ---- */}
      <ScopeStrip notChecked={survey.score?.not_checked} />

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
        <SectionCard title="Why this verdict">
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
                    {withSlopeBound(item.note, survey.avg_slope)}
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
      {hasPadCost ? (
        <SectionCard title="Building pad earthwork">
          <div className="num text-2xl font-semibold text-foreground">
            {fmtUsdK(padCost.low_usd)}
            <span className="mx-1 text-muted">to</span>
            {fmtUsdK(padCost.high_usd)}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {padCost.note
              ? cleanUnitText(padCost.note)
              : "Cost to grade a building pad, not the whole site. Not a contractor quote."}
          </p>
          {/* Full-site figure demoted to context, labeled for what it is */}
          <p className="num mt-2 border-t border-line pt-2 text-[11px] text-muted">
            Theoretical full-site balance: {fmtUsdK(assessment.costLow)} to{" "}
            {fmtUsdK(assessment.costHigh)}
          </p>
        </SectionCard>
      ) : (
        <SectionCard title="Estimated earthwork cost">
          <div className="num text-2xl font-semibold text-foreground">
            {fmtUsdK(assessment.costLow)}
            <span className="mx-1 text-muted">to</span>
            {fmtUsdK(assessment.costHigh)}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {survey.earthwork_cost?.note
              ? cleanUnitText(survey.earthwork_cost.note)
              : "Rough planning range from cut and fill volume, not a contractor quote."}
          </p>
        </SectionCard>
      )}

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
        <div className="flex justify-end pb-1">
          <UnitsToggle />
        </div>
        <div>
          {area && (
            <MetricRow
              label="Area"
              value={area.value}
              unit={area.unit}
              error={`± ${area.err}`}
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
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Elevation source: {survey.source}
          {survey.dem_data_vintage ? ` (${survey.dem_data_vintage})` : ""},{" "}
          {elevValue(survey.cell_size_m, units)} {elevUnit(units)} grid,
          vertical accuracy about ±
          {elevValue(survey.vertical_error_m, units, 1)} {elevUnit(units)}.
          {survey.dem_source_note
            ? ` ${cleanUnitText(survey.dem_source_note)}`
            : ""}
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
        <Link to="/map" className="mt-4 inline-block">
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
      <Link to="/map" className="mt-6 inline-block">
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
    // A 404 means "this report does not exist" and asking again will not
    // change that, so never retry client errors (4xx). Anything else
    // (server hiccup, cold start) gets the default one retry.
    retry: (failureCount, err) =>
      !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
      failureCount < 1,
  });

  const notFound =
    !slug || (error instanceof ApiError && error.status === 404);

  return (
    <div className="min-h-dvh bg-background">
      {/* Slim header so a stranger knows whose document this is */}
      <header className="pt-safe border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Wordmark />
          <Link to="/map">
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
