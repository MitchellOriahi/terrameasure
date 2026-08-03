// components/TopBar.tsx
// The floating command bar across the top of the map:
//   wordmark | search | draw tools | basemap + 3D | layers | nav links
//
// On phones it stacks into two rows (logo + search on top, tool chips
// below) so every control keeps a 44px touch target.

import { Link, useLocation } from "react-router-dom";
import {
  Pentagon,
  Square,
  Layers,
  Mountain,
  FileText,
  Crosshair,
  Newspaper,
  User,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { SearchBox } from "./SearchBox";

/** The Terra(diamond)Measure wordmark, per the brand direction. */
export function Wordmark() {
  return (
    <Link
      to="/"
      className="flex select-none items-center gap-0.5 text-[15px] font-semibold tracking-tight text-foreground"
      aria-label="TerraMeasure home"
    >
      Terra
      {/* The diamond glyph: a small rotated square in brand green */}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <rect
          x="2.5"
          y="2.5"
          width="7"
          height="7"
          rx="1"
          transform="rotate(45 6 6)"
          fill="var(--accent)"
        />
      </svg>
      Measure
    </Link>
  );
}

const NAV_LINKS = [
  { to: "/reports", icon: FileText, label: "Reports" },
  { to: "/photo", icon: Crosshair, label: "Ground Truth" },
  { to: "/news", icon: Newspaper, label: "News" },
  { to: "/profile", icon: User, label: "Profile" },
];

export function TopBar() {
  const location = useLocation();
  const drawMode = useAppStore((s) => s.drawMode);
  const setDrawMode = useAppStore((s) => s.setDrawMode);
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const terrain3d = useAppStore((s) => s.terrain3d);
  const toggleTerrain3d = useAppStore((s) => s.toggleTerrain3d);
  const layersPanelOpen = useAppStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useAppStore((s) => s.setLayersPanelOpen);

  return (
    <header className="pt-safe pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {/* Row 1: wordmark + search */}
        <div className="glass flex h-11 shrink-0 items-center px-3.5">
          <Wordmark />
        </div>
        <SearchBox />

        {/* Row 2 (wraps below on narrow screens): tools */}
        <div className="flex items-center gap-2">
          {/* Draw tools: pressing again cancels the mode */}
          <Button
            size="icon"
            data-active={drawMode === "polygon"}
            aria-label="Draw a polygon to survey"
            title="Draw polygon"
            onClick={() =>
              setDrawMode(drawMode === "polygon" ? "none" : "polygon")
            }
          >
            <Pentagon size={18} />
          </Button>
          <Button
            size="icon"
            data-active={drawMode === "rectangle"}
            aria-label="Draw a rectangle to survey"
            title="Draw rectangle"
            onClick={() =>
              setDrawMode(drawMode === "rectangle" ? "none" : "rectangle")
            }
          >
            <Square size={18} />
          </Button>

          {/* Basemap switcher: a two-option segmented control */}
          <div className="glass flex h-11 items-center p-1">
            {(["map", "satellite"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasemap(b)}
                className={`h-full rounded-lg px-3 text-xs font-medium capitalize transition-colors ${
                  basemap === b
                    ? "bg-accent-deep text-accent-bright"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {b === "map" ? "Map" : "Satellite"}
              </button>
            ))}
          </div>

          {/* 3D terrain toggle */}
          <Button
            size="icon"
            data-active={terrain3d}
            aria-label="Toggle 3D terrain"
            title="3D terrain"
            onClick={toggleTerrain3d}
          >
            <Mountain size={18} />
          </Button>

          {/* Layers panel toggle */}
          <Button
            size="icon"
            data-active={layersPanelOpen}
            aria-label="Toggle overlays panel"
            title="Overlays"
            onClick={() => setLayersPanelOpen(!layersPanelOpen)}
          >
            <Layers size={18} />
          </Button>

          {/* Nav links to the other screens (hidden on the smallest
              phones; those screens are reachable from any placeholder
              page's links too) */}
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to} aria-label={label} title={label}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="glass"
                  data-active={location.pathname === to}
                  tabIndex={-1}
                >
                  <Icon size={16} />
                </Button>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
