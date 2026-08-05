// components/LayersPanel.tsx
// The data-layer toggles ("OVERLAYS"): parcels, wetlands, flood zones,
// contours, hillshade. One shared list component, two homes:
//   desktop : floating glass panel on the left edge of the map
//   mobile  : the shared Sheet primitive (same one Results uses)
//
// Each row: checkbox, color swatch, name, info line, and a status dot.
// Toggles are optimistic: the checkbox flips instantly and the map layer
// mounts in the background; nothing blocks on network.

import { X } from "lucide-react";
import { useAppStore, type LayerKey } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

// Static description of each layer row. "live" means a real tile/WMS
// service is wired up; the rest are honest placeholders.
const LAYER_DEFS: {
  key: LayerKey;
  name: string;
  swatch: string;
  info: string;
  live: boolean;
}[] = [
  {
    key: "parcels",
    name: "Parcels",
    swatch: "#8b7dd8",
    info: "Tap the map (when not drawing) to look up a parcel. Pilot counties only.",
    live: true,
  },
  {
    key: "wetlands",
    name: "Wetlands",
    swatch: "#4fa8c9",
    info: "USFWS National Wetlands Inventory. Zoom in to see coverage.",
    live: true,
  },
  {
    key: "flood",
    name: "Flood zones",
    swatch: "#5b8dd6",
    info: "FEMA flood hazard areas. Zoom in to see coverage.",
    live: true,
  },
  {
    key: "contours",
    name: "Contours",
    swatch: "#c9a227",
    info: "Elevation lines for your surveyed site. Run a survey first.",
    live: true,
  },
  {
    key: "hillshade",
    name: "Hillshade",
    swatch: "#9b968e",
    info: "Terrain shading that makes hills and valleys pop.",
    live: true,
  },
];

/** The little status dot at the end of each row. Color plus a title
    tooltip, so the state is never communicated by color alone. */
function StatusDot({ on, live }: { on: boolean; live: boolean }) {
  const state = !live ? "coming soon" : on ? "on" : "off";
  const color = !live
    ? "bg-caution/70"
    : on
      ? "bg-go"
      : "bg-line";
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${color}`}
      title={state}
      aria-label={state}
    />
  );
}

export function LayersList() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const survey = useAppStore((s) => s.survey);

  return (
    <ul className="flex flex-col">
      {LAYER_DEFS.map((def) => {
        // Contours only have something to show after a survey exists.
        const disabled =
          !def.live || (def.key === "contours" && survey === null);
        return (
          <li key={def.key}>
            {/* The whole row is a label, so tapping anywhere toggles it.
                min-h keeps the touch target 44px+ on phones. */}
            <label
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/70 ${
                disabled ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={layers[def.key]}
                disabled={disabled}
                onChange={() => toggleLayer(def.key)}
              />
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: def.swatch }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">
                  {def.name}
                  {!def.live && (
                    <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                      soon
                    </span>
                  )}
                </span>
                <span className="block text-[11px] leading-tight text-muted">
                  {def.info}
                </span>
              </span>
              <StatusDot on={layers[def.key]} live={def.live} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Desktop: floating panel pinned to the left edge under the top bar. */
export function LayersPanelDesktop() {
  const open = useAppStore((s) => s.layersPanelOpen);
  const setOpen = useAppStore((s) => s.setLayersPanelOpen);
  if (!open) return null;
  return (
    <aside className="glass absolute left-4 top-20 z-20 w-72 p-3">
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Overlays
        </h2>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Close overlays panel"
          onClick={() => setOpen(false)}
        >
          <X size={14} />
        </Button>
      </div>
      <LayersList />
    </aside>
  );
}

/** Mobile: the shared Sheet primitive, opening at half height. */
export function LayersSheetMobile() {
  const open = useAppStore((s) => s.layersPanelOpen);
  const setOpen = useAppStore((s) => s.setLayersPanelOpen);
  if (!open) return null;
  return (
    <Sheet
      initialSnap="half"
      onDismiss={() => setOpen(false)}
      header={
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Overlays
          </h2>
          {/* Full 44px icon size here: this close button is tapped with
              a thumb, unlike its desktop twin above. */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close overlays panel"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </Button>
        </div>
      }
    >
      <LayersList />
    </Sheet>
  );
}
