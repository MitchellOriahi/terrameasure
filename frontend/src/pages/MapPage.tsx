// pages/MapPage.tsx
// The home screen: the full-bleed map plus everything floating on it.
// This component is the conductor; the real work happens in the pieces
// it composes (MapView, TopBar, panels, the survey hook).
//
// No sign-in is ever required here: drawing and surveying work for
// everyone, always.

import { AlertTriangle, Loader2 } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { TopBar } from "@/components/TopBar";
import {
  LayersPanelDesktop,
  LayersSheetMobile,
} from "@/components/LayersPanel";
import { Sheet } from "@/components/ui/sheet";
import { MobileBottomBar } from "@/components/MobileBottomBar";
import {
  ResultsContent,
  UncertifiedLabel,
} from "@/components/results/ResultsContent";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSurvey, loadingMessage } from "@/hooks/useSurvey";

export function MapPage() {
  const isMobile = useIsMobile();
  const survey = useAppStore((s) => s.survey);
  const drawnVertices = useAppStore((s) => s.drawnVertices);
  const resultsOpen = useAppStore((s) => s.resultsOpen);
  const setResultsOpen = useAppStore((s) => s.setResultsOpen);
  const clearSurvey = useAppStore((s) => s.clearSurvey);
  const drawMode = useAppStore((s) => s.drawMode);

  const { runSurvey, isLoading, error, reset, elapsed } = useSurvey();

  const showResults = survey !== null && resultsOpen && !isLoading;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      {/* The map fills everything; panels float above it. The map-shell
          class pins it and hands all touch gestures to MapLibre. */}
      <div className="map-shell">
        <MapView onShapeFinished={(v) => runSurvey(v)} />
      </div>

      <TopBar />

      {/* Overlays panel: floating on desktop, shared Sheet on mobile */}
      {isMobile ? <LayersSheetMobile /> : <LayersPanelDesktop />}

      {/* Phone action bar (hidden while a sheet is up, to keep one clear
          focus per moment on a small screen) */}
      {isMobile && !showResults && <MobileBottomBar />}

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
    </div>
  );
}
