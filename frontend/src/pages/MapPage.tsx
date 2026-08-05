// pages/MapPage.tsx
// The home screen: the full-bleed map plus everything floating on it.
// This component is the conductor; the real work happens in the pieces
// it composes (MapView, TopBar, panels, the survey hook).
//
// No sign-in is ever required here: drawing and surveying work for
// everyone, always.

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMap } from "@vis.gl/react-maplibre";
import { AlertTriangle, Loader2 } from "lucide-react";
import { restoreDraftOnce } from "@/lib/mapState";
import { MapView } from "@/components/map/MapView";
import { ParcelCard } from "@/components/ParcelCard";
import { TopBar } from "@/components/TopBar";
import {
  LayersPanelDesktop,
  LayersSheetMobile,
} from "@/components/LayersPanel";
import { Sheet } from "@/components/ui/sheet";
import { MobileBottomBar } from "@/components/MobileBottomBar";
import { ReticleOverlay } from "@/components/ReticleOverlay";
import { ReticleTray } from "@/components/ReticleTray";
import { WelcomeOverlay } from "@/components/WelcomeOverlay";
import { bumpCompletedSurveyCount } from "@/lib/hints";
import type { LatLon } from "@/lib/geo";
import { safeFlyTo } from "@/lib/mapCamera";
import {
  ResultsContent,
  UncertifiedLabel,
} from "@/components/results/ResultsContent";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSurvey, loadingMessage } from "@/hooks/useSurvey";
import { useParcel } from "@/hooks/useParcel";

export function MapPage() {
  const isMobile = useIsMobile();
  const survey = useAppStore((s) => s.survey);
  const drawnVertices = useAppStore((s) => s.drawnVertices);
  const resultsOpen = useAppStore((s) => s.resultsOpen);
  const setResultsOpen = useAppStore((s) => s.setResultsOpen);
  const clearSurvey = useAppStore((s) => s.clearSurvey);
  const drawMode = useAppStore((s) => s.drawMode);
  const reticleActive = useAppStore((s) => s.reticleActive);

  const { runSurvey, isLoading, error, reset, elapsed } = useSurvey();
  const { lookupParcel } = useParcel();
  const parcel = useAppStore((s) => s.parcel);
  const toast = useAppStore((s) => s.toast);

  // If the user went off to Google sign-in mid-draw, the shape they were
  // drawing was stashed in sessionStorage before the redirect. Put it
  // back exactly once; on a normal visit this finds nothing and no-ops.
  useEffect(() => {
    restoreDraftOnce();
  }, []);

  // Tapping a saved survey on the profile page navigates here with the
  // coordinates in router state; fly the map there once it is ready.
  const { main: map } = useMap();
  const location = useLocation();
  const navigate = useNavigate();
  const flyTarget = (
    location.state as { flyTo?: { lat: number; lon: number } } | null
  )?.flyTo;
  useEffect(() => {
    if (!map || !flyTarget) return;
    // safeFlyTo animates on a flat map but jumps instantly when 3D
    // terrain is on (animated moves + terrain = black screen bug).
    safeFlyTo(map, {
      center: [flyTarget.lon, flyTarget.lat],
      zoom: 16,
      duration: 1600,
      essential: true,
    });
    // Clear the state so a browser refresh does not re-fly.
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, flyTarget]);

  // Finishing a polygon ends with a click on the map. That same click
  // also reaches the map's onClick handler, and by then drawMode is
  // already back to "none", so it would trigger a bogus parcel lookup.
  // Remember when the last shape finished and ignore taps right after.
  const lastFinishRef = useRef(0);

  function handleShapeFinished(vertices: { lat: number; lon: number }[]) {
    lastFinishRef.current = Date.now();
    // Feed the "stop showing beginner hints" counter. It lives here (the
    // one funnel every survey submission passes through) so desktop
    // drawing, the mobile reticle, and the demo survey all count once.
    bumpCompletedSurveyCount();
    // A hand-drawn shape has no parcel behind it; forget any earlier one
    // so a shared report never carries the wrong parcel's facts.
    useAppStore.getState().setSurveyParcel(null);
    runSurvey(vertices);
  }

  // The mobile reticle flow ends here: grab the placed corners, leave
  // draw mode, then feed the SAME survey path the desktop tools use.
  function handleReticleFinished() {
    const s = useAppStore.getState();
    const vertices = [...s.reticleVertices];
    if (vertices.length < 3) return;
    s.stopReticle();
    s.setDrawnVertices(vertices);
    handleShapeFinished(vertices);
  }

  // "Try a demo survey" from the welcome card lands here: store the
  // preset shape (so it renders on the map exactly like a drawn one),
  // then submit it through the very same path a hand-drawn shape uses.
  function handleDemoRun(vertices: LatLon[]) {
    useAppStore.getState().setDrawnVertices(vertices);
    handleShapeFinished(vertices);
  }

  function handleMapClick(lat: number, lon: number) {
    // Tap-to-parcel only when: the Parcels layer is on, no draw tool is
    // armed, nothing else is mid-flight, and this is not the tail end of
    // a finished drawing gesture.
    const s = useAppStore.getState();
    if (!s.layers.parcels) return;
    if (s.drawMode !== "none") return;
    if (s.reticleActive) return; // taps select vertices in reticle mode
    if (s.parcelLoading || isLoading) return;
    if (Date.now() - lastFinishRef.current < 600) return;
    lookupParcel(lat, lon);
  }

  const showResults = survey !== null && resultsOpen && !isLoading;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      {/* The map fills everything; panels float above it. The map-shell
          class pins it and hands all touch gestures to MapLibre. */}
      <div className="map-shell">
        <MapView
          onShapeFinished={handleShapeFinished}
          onMapClick={handleMapClick}
        />
      </div>

      <TopBar />

      {/* Overlays panel: floating on desktop, shared Sheet on mobile */}
      {isMobile ? <LayersSheetMobile /> : <LayersPanelDesktop />}

      {/* Phone action bar (hidden while a sheet is up or while the
          reticle tray has taken its place, to keep one clear focus per
          moment on a small screen) */}
      {isMobile && !showResults && !reticleActive && <MobileBottomBar />}

      {/* Reticle draw mode: the crosshair overlay plus its button tray */}
      {isMobile && reticleActive && (
        <>
          <ReticleOverlay />
          <ReticleTray onFinish={handleReticleFinished} />
        </>
      )}

      {/* Gentle hint while a draw tool is armed */}
      {drawMode !== "none" && !isLoading && (
        <div className="glass pointer-events-none absolute left-1/2 top-24 z-20 w-max max-w-[90vw] -translate-x-1/2 px-4 py-2 text-center text-xs text-foreground">
          {drawMode === "polygon"
            ? "Tap the map to add corners, double-tap to finish"
            : "Tap one corner, then tap the opposite corner"}
        </div>
      )}

      {/* ---- Survey in flight: the "waking up" progress card ---- */}
      {isLoading && (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm">
          <div className="glass flex flex-col items-center gap-3 p-6 text-center">
            <Loader2 className="animate-spin text-accent" size={28} />
            <p className="text-sm text-foreground">{loadingMessage(elapsed)}</p>
            {/* Indeterminate shimmer bar: honest about not knowing exactly
                how long, but clearly alive */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full w-1/3 rounded-full bg-accent"
                style={{ animation: "slide 1.4s ease-in-out infinite" }}
              />
            </div>
            <span className="num text-[11px] text-muted">
              {elapsed}s elapsed
            </span>
          </div>
          {/* The keyframes for the shimmer, scoped inline for simplicity */}
          <style>{`@keyframes slide { 0% { margin-left: -33%; } 100% { margin-left: 100%; } }`}</style>
        </div>
      )}

      {/* ---- Survey failed: readable error with a retry path ---- */}
      {error && !isLoading && (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm">
          <div className="glass flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-nogo">
              <AlertTriangle size={18} />
              <span className="text-sm font-semibold">Survey failed</span>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              {error.message}
            </p>
            <div className="flex gap-2">
              {drawnVertices && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => runSurvey(drawnVertices)}
                >
                  Try again
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                  clearSurvey();
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Results: right panel on desktop, shared Sheet on mobile ---- */}
      {showResults &&
        (isMobile ? (
          <Sheet
            initialSnap="half"
            onDismiss={() => setResultsOpen(false)}
            header={
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  Site assessment
                </span>
                <UncertifiedLabel />
              </div>
            }
          >
            <ResultsContent survey={survey} vertices={drawnVertices} />
          </Sheet>
        ) : (
          <aside className="absolute bottom-4 right-4 top-20 z-20 w-96">
            <div className="glass flex h-full flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Site assessment
                </h2>
                <UncertifiedLabel />
              </div>
              <div className="panel-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                <ResultsContent survey={survey} vertices={drawnVertices} />
              </div>
            </div>
          </aside>
        ))}

      {/* ---- Parcel Card: appears after tapping a parcel on the map ---- */}
      {parcel && !showResults && !isLoading && (
        <ParcelCard
          parcel={parcel}
          onSurvey={(v) => {
            // Parcel surveys skip handleShapeFinished (they must keep
            // their parcel attached), so count them for the hints here.
            bumpCompletedSurveyCount();
            runSurvey(v);
          }}
        />
      )}

      {/* ---- First-run welcome card + demo survey (auto-opens once;
              the "?" button in the TopBar reopens it any time) ---- */}
      <WelcomeOverlay onRunDemo={handleDemoRun} surveyLoading={isLoading} />

      {/* ---- Tiny toast pill (e.g. "No parcel data here yet") ---- */}
      {toast && (
        <div
          className="glass pointer-events-none absolute bottom-24 left-1/2 z-40 w-max max-w-[90vw] -translate-x-1/2 px-4 py-2 text-center text-xs text-foreground"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
