// components/ReticleOverlay.tsx
// The screen-fixed part of reticle drawing: the crosshair itself, the
// first-use hint pill, and the "zoom in" precision chip.
//
// None of this touches the map. The crosshair is just a DOM element pinned
// at 42% from the top of the screen; ReticleLayers pads the camera so the
// map's center point sits at that exact spot. Everything here ignores
// pointer events, so pans and pinches pass straight through to the map.

import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { getCompletedSurveyCount } from "@/lib/hints";

// Below this zoom level a screen pixel covers several meters of ground,
// so corner placement gets sloppy. We nudge rather than block.
const PRECISION_ZOOM = 16;

/** The 28px crosshair: four 2px arms with a gap and a small center dot. */
function Crosshair({ pulseKey }: { pulseKey: number }) {
  return (
    // Outer element handles positioning; inner one handles the pulse, so
    // the two transforms (translate vs scale) never fight each other.
    <div
      className="pointer-events-none fixed left-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ top: "42%" }}
      aria-hidden
    >
      {/* key change replays the 120ms scale pulse on each placed point */}
      <div key={pulseKey} className="reticle-cross reticle-pulse">
        <span className="reticle-arm" style={{ left: 13, top: 0, width: 2, height: 9 }} />
        <span className="reticle-arm" style={{ left: 13, bottom: 0, width: 2, height: 9 }} />
        <span className="reticle-arm" style={{ top: 13, left: 0, width: 9, height: 2 }} />
        <span className="reticle-arm" style={{ top: 13, right: 0, width: 9, height: 2 }} />
        <span className="reticle-arm" style={{ left: 13, top: 13, width: 2, height: 2 }} />
      </div>
    </div>
  );
}

export function ReticleOverlay() {
  const vertexCount = useAppStore((s) => s.reticleVertices.length);
  const pulse = useAppStore((s) => s.reticlePulse);
  // Selecting just a boolean means this component only re-renders when the
  // answer flips, not on every tiny zoom change.
  const lowZoom = useAppStore((s) => s.reticleZoom < PRECISION_ZOOM);

  // Show the teaching pill only before the first vertex, and never again
  // once this browser has completed two surveys. useMemo keeps the
  // localStorage read to once per mode entry instead of every render.
  const isNewcomer = useMemo(() => getCompletedSurveyCount() < 2, []);
  const showHint = vertexCount === 0 && isNewcomer;

  return (
    <>
      {showHint && (
        <div className="glass pointer-events-none fixed left-1/2 top-24 z-20 w-max max-w-[90vw] -translate-x-1/2 px-4 py-2 text-center text-xs text-foreground">
          Move the map to aim, then tap Add Point
        </div>
      )}

      <Crosshair pulseKey={pulse} />

      {lowZoom && (
        <div
          className="glass pointer-events-none fixed left-1/2 z-20 w-max -translate-x-1/2 px-3 py-1.5 text-[11px] text-muted"
          style={{ top: "calc(42% + 28px)" }}
        >
          Zoom in for better precision
        </div>
      )}
    </>
  );
}
