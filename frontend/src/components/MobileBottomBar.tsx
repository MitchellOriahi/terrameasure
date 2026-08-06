// components/MobileBottomBar.tsx
// The phone-only action bar floating above the safe area:
//
//   Layers | Basemap | Survey (the big primary CTA) | Saved
//
// Everything a phone user needs lives DOWN HERE in thumb range (the
// one-thumb rule from the mobile UX spec): the top of a 6.7 inch screen
// is a two-hand reach. That is also why the basemap toggle sits here and
// not in the top bar like on desktop.
//
// Every side button shows an icon PLUS a tiny text label. Phones have no
// hover, so tooltips cannot explain an icon; the label has to be visible.
//
// "Survey" enters reticle draw mode (crosshair aiming, no map tapping);
// while drawing, this whole bar is replaced by the ReticleTray, so the
// button never needs a "cancel" state. Per the mobile UX spec the primary
// CTA is 56px tall; the side buttons are 48px (above the 44px minimum).

import { useNavigate } from "react-router-dom";
import {
  Layers,
  Pentagon,
  Bookmark,
  Map as MapIcon,
  Satellite,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";

/** One small labeled side button: icon on top, tiny label underneath.
    48px tall and 56px wide, comfortably past the 44px touch minimum. */
function SideButton({
  icon: Icon,
  label,
  ariaLabel,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`glass flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl ${
        active ? "text-accent-bright" : "text-foreground"
      }`}
    >
      <Icon size={18} />
      <span className="text-[9px] font-medium leading-none text-muted">
        {label}
      </span>
    </button>
  );
}

export function MobileBottomBar() {
  const navigate = useNavigate();
  const startReticle = useAppStore((s) => s.startReticle);
  const layersPanelOpen = useAppStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useAppStore((s) => s.setLayersPanelOpen);
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);

  // Saved surveys live on the /saved page, which needs no account: the
  // list is kept on the device. (It used to bounce anonymous people to a
  // sign-in wall, which made saving look broken to anyone who had not
  // made an account.)
  function openSaved() {
    navigate("/saved");
  }

  // The basemap chip shows the CURRENT view and tapping flips to the
  // other one. Two basemaps means a single toggle beats a submenu.
  const onSatellite = basemap === "satellite";

  return (
    <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-3">
      <div className="pointer-events-auto mx-auto flex max-w-sm items-center justify-between gap-2">
        {/* Layers */}
        <SideButton
          icon={Layers}
          label="Layers"
          ariaLabel="Overlays"
          active={layersPanelOpen}
          onClick={() => setLayersPanelOpen(!layersPanelOpen)}
        />

        {/* Basemap: compact toggle chip (moved down from the top bar so
            it is reachable one-handed) */}
        <SideButton
          icon={onSatellite ? Satellite : MapIcon}
          label={onSatellite ? "Satellite" : "Map"}
          ariaLabel={
            onSatellite
              ? "Switch to street map view"
              : "Switch to satellite imagery"
          }
          onClick={() => setBasemap(onSatellite ? "map" : "satellite")}
        />

        {/* Survey: the one big green button. data-coach anchors the
            mobile coach mark ("Start here"). */}
        <button
          type="button"
          onClick={startReticle}
          data-coach="survey"
          className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-black shadow-lg transition-colors active:bg-accent-bright"
          aria-label="Start a survey"
        >
          <Pentagon size={18} />
          Survey
        </button>

        {/* Saved surveys and share links (no account needed) */}
        <SideButton
          icon={Bookmark}
          label="Saved"
          ariaLabel="Saved surveys"
          onClick={openSaved}
        />
      </div>
    </div>
  );
}
