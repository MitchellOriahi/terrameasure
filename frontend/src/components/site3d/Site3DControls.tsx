// components/site3d/Site3DControls.tsx
// The compact floating control card shown while Site 3D mode is active,
// plus the two background behaviors that make the mode feel alive:
//
//   1. The AUTO-ORBIT: a requestAnimationFrame loop that nudges the
//      camera bearing a fraction of a degree per frame. Each nudge is
//      an INSTANT map.jumpTo. That is deliberate: animated camera moves
//      (easeTo/flyTo) while terrain is on trigger MapLibre v6's
//      black-screen bug (see lib/mapCamera.ts), but many tiny instant
//      jumps render perfectly and look like one smooth rotation.
//   2. PAUSE ON TOUCH: the moment the user grabs the map themselves
//      (drag, pinch, wheel), the orbit stops so it never fights them.
//      The card's play button resumes it.
//
// The card itself: drape chips (what image covers the ground), a
// terrain height slider, orbit play/pause, and Exit. Bottom-center on
// phones (above the home indicator), bottom-right on desktop.

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-maplibre";
import { Mountain, Pause, Play, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import type { Site3dDrape } from "@/store/appStore";
import { exitSite3d } from "@/lib/site3d";
import { Button } from "@/components/ui/button";

// How fast the site spins: degrees of bearing per second. 8 deg/s means
// one full lap in 45 seconds; calm, not a carousel.
const ORBIT_DEG_PER_SEC = 8;

export function Site3DControls() {
  const { main: map } = useMap();
  const survey = useAppStore((s) => s.survey);
  const orbiting = useAppStore((s) => s.site3dOrbiting);
  const setOrbiting = useAppStore((s) => s.setSite3dOrbiting);
  const drape = useAppStore((s) => s.site3dDrape);
  const setDrape = useAppStore((s) => s.setSite3dDrape);
  const exaggeration = useAppStore((s) => s.site3dExaggeration);
  const setExaggeration = useAppStore((s) => s.setSite3dExaggeration);

  // ---- Guard rail: if the survey disappears (cleared some other way)
  // there is nothing to look at; leave 3D mode instead of hanging. ----
  useEffect(() => {
    if (!survey) exitSite3d(map);
  }, [survey, map]);

  // ---- The orbit loop ----
  // Runs only while orbiting is true; pausing tears the loop down and
  // resuming builds a fresh one (that is just how useEffect works, and
  // it conveniently resets the frame clock too).
  useEffect(() => {
    if (!orbiting || !map) return;
    const raw = map.getMap();
    let frameId = 0;
    let stopped = false;
    let last = performance.now();

    const step = (now: number) => {
      if (stopped) return;
      // Time-based, not frame-based: a slow phone at 30fps and a fast
      // monitor at 120fps both orbit at the same degrees-per-second.
      // The cap keeps a background-tab wakeup from causing a big lurch
      // (250ms at 8 deg/s is a 2 degree step, still imperceptible)
      // while letting heavy terrain frames keep close to real time.
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      // The safe move: one tiny instant jump per frame (never easeTo).
      raw.jumpTo({ bearing: raw.getBearing() + ORBIT_DEG_PER_SEC * dt });
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
    };
  }, [orbiting, map]);

  // ---- Repaint nudge after terrain or drape changes ----
  // Re-applying terrain (new exaggeration) or swapping the drape image
  // while the camera is perfectly still can leave ONE stale, black
  // frame on screen: MapLibre only repaints on the next camera move.
  // We saw exactly this in QA (the whole map went black after moving
  // the slider with the orbit paused, and recovered the moment the
  // orbit jumped again). The cure is the same trick as the orbit: an
  // instant, invisible jumpTo (a 0.001 degree bearing nudge) one frame
  // after the change, which forces a clean repaint. Never an easeTo;
  // animated moves with terrain on are the original black-screen bug.
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const frameId = requestAnimationFrame(() => {
      raw.jumpTo({ bearing: raw.getBearing() + 0.001 });
    });
    return () => cancelAnimationFrame(frameId);
  }, [exaggeration, drape, map]);

  // ---- Pause the orbit on any manual map gesture ----
  // We listen to the INPUT events (mouse down, touch, wheel), not the
  // "move" events, because our own per-frame jumps fire move events too
  // and would instantly pause ourselves.
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const pause = () => useAppStore.getState().setSite3dOrbiting(false);
    raw.on("mousedown", pause);
    raw.on("touchstart", pause);
    raw.on("wheel", pause);
    return () => {
      raw.off("mousedown", pause);
      raw.off("touchstart", pause);
      raw.off("wheel", pause);
    };
  }, [map]);

  if (!survey) return null;

  // Which drapes this survey can offer. Satellite is always available
  // (it is the basemap itself, stretched over the terrain); the other
  // two need their image to have come back with the survey.
  const drapeOptions: { key: Site3dDrape; label: string; ok: boolean }[] = [
    { key: "satellite", label: "Satellite", ok: true },
    { key: "slope", label: "Slope", ok: !!survey.slope_map_clean_b64 },
    { key: "contours", label: "Contours", ok: !!survey.contour_map_clean_b64 },
  ];

  return (
    <div
      className="glass pointer-events-auto absolute z-30 flex w-[min(92vw,340px)] flex-col gap-1.5 p-2 max-md:bottom-3 max-md:left-1/2 max-md:-translate-x-1/2 max-md:mb-[env(safe-area-inset-bottom)] md:bottom-4 md:right-4"
      role="group"
      aria-label="Site 3D controls"
    >
      {/* Header: mode name + big exit target */}
      <div className="flex items-center justify-between pl-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-bright">
          Site 3D
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Exit 3D view"
          title="Exit 3D view"
          onClick={() => exitSite3d(map)}
        >
          <X size={18} />
        </Button>
      </div>

      {/* Drape chips: what covers the surveyed ground */}
      <div className="flex gap-1" role="radiogroup" aria-label="Ground overlay">
        {drapeOptions.map(({ key, label, ok }) =>
          ok ? (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={drape === key}
              onClick={() => setDrape(key)}
              className={`h-11 flex-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                drape === key
                  ? "bg-accent-deep text-accent-bright"
                  : "text-muted hover:bg-surface-2/70 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ) : null,
        )}
      </div>

      {/* Terrain height slider: 1x (true scale) to 2.5x. Grabbing it
          pauses the orbit so the terrain re-applies while the camera is
          stationary (the safest condition per the black-screen bug). */}
      <div className="flex h-11 items-center gap-2 px-2">
        <Mountain size={14} className="shrink-0 text-muted" aria-hidden />
        <input
          type="range"
          min={1}
          max={2.5}
          step={0.1}
          value={exaggeration}
          aria-label="Terrain height exaggeration"
          onPointerDown={() => setOrbiting(false)}
          onChange={(e) => setExaggeration(parseFloat(e.target.value))}
          className="h-11 w-full cursor-pointer"
          style={{ accentColor: "var(--accent)" }}
        />
        <span className="num w-9 shrink-0 text-right text-xs text-muted">
          {exaggeration.toFixed(1)}x
        </span>
      </div>

      {/* Orbit control: one clear labeled button */}
      <Button
        size="md"
        aria-label={orbiting ? "Pause orbit" : "Resume orbit"}
        onClick={() => setOrbiting(!orbiting)}
      >
        {orbiting ? <Pause size={16} /> : <Play size={16} />}
        {orbiting ? "Pause orbit" : "Orbit the site"}
      </Button>
    </div>
  );
}
