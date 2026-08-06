// components/results/SiteIdentity.tsx
// The header of a site assessment: WHAT land is this, and what does the
// person looking at it want to say about it.
//
// Why it exists: a verdict with no address is not a document. Someone
// opening a shared link needs to know which piece of ground they are
// reading about before a single number means anything, so this block
// sits above the verdict and states:
//
//   name (editable) . county and state . coordinates . acreage . parcel id
//
// The name and the notes are the user's own words. They are stored in
// the app state as you type, travel into any shared report, and can be
// rewritten on the report page afterwards. The measurements below them
// can never be edited by anyone: a report whose numbers can be typed
// over would not be worth sharing.

import { useState } from "react";
import { Check, MapPin, Pencil, StickyNote } from "lucide-react";
import type { ParcelResponse, PlaceInfo } from "@/lib/api";
import { fmt, polygonAreaM2, type LatLon } from "@/lib/geo";
import { useAppStore } from "@/store/appStore";

const M2_PER_ACRE = 4046.86;

/**
 * The best name we can put on a site before the user types one.
 * In order: the parcel's street address, the town and county from the
 * reverse lookup, then nothing (the caller shows coordinates instead).
 */
export function defaultSiteName(
  place: PlaceInfo | null,
  parcel: ParcelResponse | null,
): string {
  if (parcel?.address) return parcel.address;
  if (place?.label) return place.label;
  if (place?.county && place.state) return `${place.county}, ${place.state}`;
  return "";
}

/** "Jefferson County, Colorado", or whichever half we actually know. */
export function countyStateLine(place: PlaceInfo | null): string {
  if (!place) return "";
  const parts = [place.county, place.state].filter(Boolean);
  return parts.join(", ");
}

interface SiteIdentityProps {
  vertices: LatLon[] | null;
  centerLat: number;
  centerLon: number;
}

export function SiteIdentity({
  vertices,
  centerLat,
  centerLon,
}: SiteIdentityProps) {
  const place = useAppStore((s) => s.place);
  const parcel = useAppStore((s) => s.surveyParcel);
  const siteName = useAppStore((s) => s.siteName);
  const setSiteName = useAppStore((s) => s.setSiteName);
  const siteNotes = useAppStore((s) => s.siteNotes);
  const setSiteNotes = useAppStore((s) => s.setSiteNotes);

  const [editingName, setEditingName] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Centroid of the drawn shape when we have one, DEM centre otherwise.
  const lat =
    vertices && vertices.length > 0
      ? vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
      : centerLat;
  const lon =
    vertices && vertices.length > 0
      ? vertices.reduce((s, v) => s + v.lon, 0) / vertices.length
      : centerLon;

  const acres =
    vertices && vertices.length >= 3
      ? polygonAreaM2(vertices) / M2_PER_ACRE
      : null;

  const fallbackName = defaultSiteName(place, parcel);
  const shownName =
    siteName.trim() || fallbackName || `Site at ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const county = countyStateLine(place);

  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
      {/* ---- Name, editable in place ---- */}
      {editingName ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={siteName}
            maxLength={160}
            placeholder={fallbackName || "Name this site"}
            onChange={(e) => setSiteName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditingName(false);
            }}
            className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-foreground outline-none focus:border-accent/60"
            aria-label="Site name"
          />
          <button
            type="button"
            onClick={() => setEditingName(false)}
            aria-label="Done editing the site name"
            className="shrink-0 text-accent-bright"
          >
            <Check size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="group flex w-full items-start gap-2 text-left"
          aria-label="Edit the site name"
        >
          <MapPin className="mt-0.5 shrink-0 text-accent" size={15} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-snug text-foreground">
              {shownName}
            </span>
          </span>
          <Pencil
            size={13}
            className="mt-0.5 shrink-0 text-muted group-hover:text-foreground"
          />
        </button>
      )}

      {/* ---- The facts that identify the land ---- */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-[23px] text-[11px]">
        {county && (
          <div className="col-span-2 flex gap-1.5">
            <dt className="text-muted">County</dt>
            <dd className="text-foreground/90">{county}</dd>
          </div>
        )}
        <div className="col-span-2 flex gap-1.5">
          <dt className="text-muted">Centre</dt>
          <dd className="num text-foreground/90">
            {lat.toFixed(5)}, {lon.toFixed(5)}
          </dd>
        </div>
        {acres !== null && (
          <div className="flex gap-1.5">
            <dt className="text-muted">Area</dt>
            <dd className="num text-foreground/90">{fmt(acres, 2)} ac</dd>
          </div>
        )}
        {/* Parcel id only when a county actually gave us one. An empty
            row would read as "we looked and there is none", which is a
            different and wrong claim. */}
        {parcel?.parcel_id && (
          <div className="flex gap-1.5">
            <dt className="text-muted">Parcel</dt>
            <dd className="num truncate text-foreground/90">
              {parcel.parcel_id}
            </dd>
          </div>
        )}
      </dl>

      {/* ---- Your notes: free text that travels with the report ---- */}
      {notesOpen || siteNotes ? (
        <div className="mt-3 border-t border-line pt-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted">
              Your notes
            </span>
            <textarea
              value={siteNotes}
              maxLength={4000}
              rows={3}
              autoFocus={notesOpen && !siteNotes}
              onChange={(e) => setSiteNotes(e.target.value)}
              placeholder="Access off the county road, power at the north fence, seller says the creek runs year round."
              className="panel-scroll resize-y rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:outline-none"
            />
          </label>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">
            Notes are yours: they ride along on any report you share, and
            you can rewrite them later.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="mt-2 flex items-center gap-1.5 pl-[23px] text-[11px] text-muted hover:text-foreground"
        >
          <StickyNote size={12} />
          Add your own notes
        </button>
      )}
    </div>
  );
}
