// components/TopBar.tsx
// The floating command bar across the top of the map:
//   wordmark | search | draw tools | basemap + 3D | layers | nav links
//
// On phones it stacks into two rows (logo + search on top, tool chips
// below) so every control keeps a 44px touch target.

import { Link, useLocation } from "react-router-dom";
import { useMap } from "@vis.gl/react-maplibre";
import {
  Pentagon,
  Square,
  Layers,
  Mountain,
  FileText,
  Crosshair,
  HelpCircle,
  Newspaper,
  User,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { useWelcomeStore } from "@/store/welcomeStore";
import { getCompletedSurveyCount } from "@/lib/hints";
import { Button } from "@/components/ui/button";
import { SearchBox } from "./SearchBox";

/** The account entry in the top bar: a small initial-in-a-circle when
    signed in (links to the profile), a quiet person icon labeled
    "Sign in" when anonymous (links to /auth). Deliberately subtle;
    accounts are optional in this app. */
export function ProfileButton() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === "signed-in" && user) {
    return (
      <Link to="/profile" aria-label="Your profile" title={user.name}>
        <Button
          size="iconSm"
          variant="ghost"
          className="glass"
          data-active={location.pathname === "/profile"}
          tabIndex={-1}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-deep text-[10px] font-semibold text-accent-bright">
            {user.name.charAt(0).toUpperCase()}
          </span>
        </Button>
      </Link>
    );
  }

  // Anonymous (or still checking): a plain sign-in entry. Never a nag.
  return (
    <Link
      to="/auth"
      state={{ from: location.pathname }}
      aria-label="Sign in"
      title="Sign in"
    >
      <Button size="iconSm" variant="ghost" className="glass" tabIndex={-1}>
        <User size={16} />
      </Button>
    </Link>
  );
}

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
];

export function TopBar() {
  const location = useLocation();
  // Handle to the map (via MapProvider) so the 3D toggle can tilt the
  // camera. Terrain alone is invisible from straight above; without a
  // tilt the button looks like it does nothing.
  const { main: map } = useMap();
  const drawMode = useAppStore((s) => s.drawMode);
  const setDrawMode = useAppStore((s) => s.setDrawMode);
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const terrain3d = useAppStore((s) => s.terrain3d);
  const toggleTerrain3d = useAppStore((s) => s.toggleTerrain3d);
  const layersPanelOpen = useAppStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useAppStore((s) => s.setLayersPanelOpen);

  // For the beginner hint pill under the draw tools (desktop only; the
  // mobile reticle mode carries its own hint). Subscribing to these
  // slices means the pill disappears the moment a survey starts.
  const survey = useAppStore((s) => s.survey);
  const drawnVertices = useAppStore((s) => s.drawnVertices);
  const welcomeOpen = useWelcomeStore((s) => s.open);
  const setWelcomeOpen = useWelcomeStore((s) => s.setOpen);

  // Show "draw an area" only to a genuine newcomer: nothing drawn yet,
  // no results up, no tool armed, welcome card out of the way, and this
  // browser has never completed a survey (the localStorage counter).
  // Once the first survey is submitted the counter bumps, so the pill
  // is gone permanently on every later visit.
  const showDrawHint =
    !welcomeOpen &&
    drawMode === "none" &&
    survey === null &&
    drawnVertices === null &&
    getCompletedSurveyCount() < 1;

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
          {/* Draw tools: pressing again cancels the mode. The relative
              wrapper anchors the newcomer hint pill right beneath them. */}
          <div className="relative flex items-center gap-2">
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

            {/* First-use nudge, desktop only (max-md:hidden): points a
                newcomer at these two buttons until their first survey.
                Purely decorative, so clicks pass straight through it. */}
            {showDrawHint && (
              <div className="glass pointer-events-none absolute left-0 top-full mt-2 hidden w-max items-center gap-2 px-3 py-1.5 text-[11px] text-foreground md:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />
                Draw an area to survey it
              </div>
            )}
          </div>

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

          {/* 3D terrain toggle. Turning 3D on also tilts the camera
              (pitch 60) so the relief is actually visible; turning it
              off levels the view back to straight-down 2D. */}
          <Button
            size="icon"
            data-active={terrain3d}
            aria-label="Toggle 3D terrain"
            title="3D terrain"
            onClick={() => {
              // ORDER MATTERS here. MapLibre 6 renders a BLACK SCREEN
              // if an ANIMATED camera move runs while terrain is on,
              // and also when terrain is switched on mid-animation
              // (see lib/mapCamera.ts). What is proven to work:
              // enable terrain on the flat map, then tilt with an
              // INSTANT jump once the terrain has finished loading.
              toggleTerrain3d();
              if (!map) return;
              if (!terrain3d) {
                // Turning ON. "idle" fires when the map has finished
                // all pending work, including loading the elevation
                // tiles, so the jump lands on a ready 3D scene.
                map.once("idle", () => map.jumpTo({ pitch: 60 }));
              } else {
                // Turning OFF: terrain drops instantly (safe), then a
                // normal animation levels the now-flat map back to 2D.
                map.easeTo({ pitch: 0, duration: 900, essential: true });
              }
            }}
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

          {/* Help: reopens the welcome card (with the demo survey) any
              time. Small on purpose; it should be findable, not loud.
              Visible on every screen size, unlike the nav links. */}
          <Button
            size="iconSm"
            variant="ghost"
            className="glass"
            aria-label="Help and quick tour"
            title="Help"
            data-active={welcomeOpen}
            onClick={() => setWelcomeOpen(true)}
          >
            <HelpCircle size={16} />
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
            {/* Account entry: avatar initial when signed in, sign-in
                link when not */}
            <ProfileButton />
          </nav>
        </div>
      </div>
    </header>
  );
}
