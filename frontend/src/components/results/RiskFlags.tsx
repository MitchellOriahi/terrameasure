// components/results/RiskFlags.tsx
// Risk flags: what the federal context layers found on this site.
// Extracted into its own file because two screens render it: the live
// results panel (ResultsContent) and the public shared-report page.
//
// Three honest rules:
//   1. An "unavailable" source is SHOWN as unavailable, never hidden.
//      Unknown is not the same as clear.
//   2. Lots of open water (over 30% of the site) gets the loud red row.
//   3. Every row names its data source.

import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { SurveyContext } from "@/lib/api";

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

export function RiskFlags({ context }: { context: SurveyContext }) {
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
