// components/ParcelCard.tsx
// The card that appears after tapping a parcel on the map: who owns it,
// how big it is, and a button to survey it. One content component, two
// homes (the app-wide pattern):
//   desktop : floating glass card, bottom-left over the map
//   mobile  : the shared Sheet primitive, opening at half height
//
// "Survey this parcel" feeds the parcel's boundary into the exact same
// survey flow as hand-drawing: we convert the GeoJSON ring to lat/lon
// vertices, thin it to a sane count, and hand it to the page's runSurvey.

import { X } from "lucide-react";
import type { ParcelResponse } from "@/lib/api";
import type { LatLon } from "@/lib/geo";
import { fmt } from "@/lib/geo";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useIsMobile";

// County parcel outlines can carry hundreds of vertices (every fence
// jog is a point). The survey engine only needs the overall shape, so
// we cap the ring at this many vertices by keeping every nth point.
const MAX_SURVEY_VERTICES = 120;

/** GeoJSON ring ([lon, lat] pairs, closed) -> thinned LatLon vertices. */
export function boundaryToVertices(p: ParcelResponse): LatLon[] | null {
  const ring = p.boundary?.coordinates?.[0];
  if (!ring || ring.length < 4) return null; // 3 corners + closing point

  // Drop the closing point (GeoJSON repeats the first vertex at the end).
  const open = ring.slice(0, -1);

  // Thin evenly: keep every nth point so at most MAX_SURVEY_VERTICES
  // survive. step is 1 (keep everything) for normal-sized parcels.
  const step = Math.ceil(open.length / MAX_SURVEY_VERTICES);
  const vertices: LatLon[] = [];
  for (let i = 0; i < open.length; i += step) {
    const [lon, lat] = open[i];
    vertices.push({ lat, lon });
  }
  return vertices.length >= 3 ? vertices : null;
}

/** "$1,234,567" or a dash when the county did not publish the number. */
function fmtUsd(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "not published";
  return `$${fmt(v)}`;
}

/** One label/value line of the card. Missing values stay honest. */
function Row({ label, value }: { label: string; value: string | null }) {
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

interface ParcelCardProps {
  parcel: ParcelResponse;
  // The page passes its runSurvey; we pass it the parcel's vertices.
  onSurvey: (vertices: LatLon[]) => void;
}

/** The card body, shared by the desktop card and the mobile sheet. */
function ParcelCardBody({ parcel, onSurvey }: ParcelCardProps) {
  const setParcel = useAppStore((s) => s.setParcel);
  const setDrawnVertices = useAppStore((s) => s.setDrawnVertices);
  const setSurveyParcel = useAppStore((s) => s.setSurveyParcel);

  const vertices = boundaryToVertices(parcel);

  // Show the source as a short host name, not a giant ArcGIS URL.
  let sourceHost: string | null = null;
  try {
    sourceHost = parcel.source ? new URL(parcel.source).hostname : null;
  } catch {
    sourceHost = parcel.source;
  }

  return (
    <div className="flex flex-col gap-1">
      <Row label="Parcel ID" value={parcel.parcel_id} />
      <Row label="Owner" value={parcel.owner} />
      {parcel.address && <Row label="Address" value={parcel.address} />}
      <Row
        label="Acreage"
        value={parcel.acreage !== null ? fmt(parcel.acreage, 2) : null}
      />
      <Row label="Land use" value={parcel.land_use} />
      <Row label="Zoning" value={parcel.zoning} />
      <Row label="Assessed value" value={fmtUsd(parcel.assessed_value)} />

      <p className="mt-1 text-[10px] leading-relaxed text-muted">
        {parcel.county}
        {sourceHost ? `, via ${sourceHost}` : ""}. County records; may lag
        reality.
      </p>

      {vertices && (
        <Button
          variant="primary"
          size="sm"
          className="mt-2"
          onClick={() => {
            // Show the outline as the drawn shape, then run the normal
            // survey flow on it. From here on it is just like the user
            // drew this polygon by hand. We also remember WHICH parcel
            // this survey came from, so a shared report can include
            // the ownership facts alongside the terrain numbers.
            setSurveyParcel(parcel);
            setDrawnVertices(vertices);
            setParcel(null);
            onSurvey(vertices);
          }}
        >
          Survey this parcel
        </Button>
      )}
    </div>
  );
}

/** The full card: floating bottom-left on desktop, Sheet on mobile. */
export function ParcelCard(props: ParcelCardProps) {
  const isMobile = useIsMobile();
  const setParcel = useAppStore((s) => s.setParcel);

  const header = (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-foreground">Parcel</h2>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label="Close parcel card"
        onClick={() => setParcel(null)}
      >
        <X size={16} />
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet
        initialSnap="half"
        onDismiss={() => setParcel(null)}
        header={header}
      >
        <ParcelCardBody {...props} />
      </Sheet>
    );
  }

  return (
    <aside className="glass absolute bottom-8 left-4 z-20 w-80 p-4">
      <div className="mb-2">{header}</div>
      <ParcelCardBody {...props} />
    </aside>
  );
}
