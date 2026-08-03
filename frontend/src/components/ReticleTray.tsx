// components/ReticleTray.tsx
// The button tray pinned to the bottom of the screen during reticle
// drawing. It replaces the normal mobile bottom bar and holds:
//
//   [ Undo ]   [ + Add Point / Close Shape ]   [ Done ]
//
// plus, directly above it, the live readout strip (running distance, then
// live area + perimeter as the shape takes form). When a vertex is tapped
// on the map the tray swaps to editing controls: Move Here / Delete / Cancel.
//
// It also owns the two "are you sure?" action sheets (clear all, discard)
// and the Android-back / iOS-edge-swipe escape hatch, which works through
// the browser history: entering draw mode pushes a history entry, and the
// "popstate" event (fired when the user goes back) is our cue.

import { useEffect, useMemo, useRef, useState } from "react";
import { Undo2, Check, Trash2, X, MapPin } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import {
  polygonAreaM2,
  polygonPerimeterM,
  pathLengthM,
  fmt,
  fmtLength,
  type LatLon,
} from "@/lib/geo";
import { ActionSheet } from "@/components/ui/actionSheet";

// Long-press threshold for the Undo button (per the mobile UX spec).
const LONG_PRESS_MS = 600;

/** A tiny haptic tick where supported (Android Chrome). iOS has no API,
 *  so every haptic is paired with a visual pulse and never load-bearing. */
function hapticTick() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
}

interface ReticleTrayProps {
  /** Called when the user closes the shape; the page submits the survey. */
  onFinish: () => void;
}

export function ReticleTray({ onFinish }: ReticleTrayProps) {
  const vertices = useAppStore((s) => s.reticleVertices);
  const center = useAppStore((s) => s.reticleCenter);
  const snap = useAppStore((s) => s.snapToFirst);
  const selected = useAppStore((s) => s.selectedVertexIndex);

  const addReticleVertex = useAppStore((s) => s.addReticleVertex);
  const undoReticleVertex = useAppStore((s) => s.undoReticleVertex);
  const clearReticleVertices = useAppStore((s) => s.clearReticleVertices);
  const moveReticleVertex = useAppStore((s) => s.moveReticleVertex);
  const deleteReticleVertex = useAppStore((s) => s.deleteReticleVertex);
  const setSelectedVertexIndex = useAppStore((s) => s.setSelectedVertexIndex);

  const [clearSheetOpen, setClearSheetOpen] = useState(false);
  const [discardSheetOpen, setDiscardSheetOpen] = useState(false);

  // ---- Escape hatch via browser history ----
  // Mounting the tray = entering draw mode, so we push one history entry.
  // When the user presses Android back (or edge-swipes on iOS), the
  // browser pops that entry and fires "popstate". With no points placed
  // we exit silently; with points we push the entry back (so the user is
  // still "inside" draw mode) and ask before throwing work away.
  // exitingRef marks OUR OWN history.back() calls so the handler ignores them.
  const exitingRef = useRef(false);
  useEffect(() => {
    window.history.pushState({ tmReticle: true }, "");
    const onPop = () => {
      if (exitingRef.current) return;
      const s = useAppStore.getState();
      if (s.reticleVertices.length >= 1) {
        window.history.pushState({ tmReticle: true }, "");
        setDiscardSheetOpen(true);
      } else {
        s.stopReticle();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Leave draw mode AND consume the history entry we pushed on entry,
   *  so a later back press does not mysteriously do nothing. */
  function exitConsumingHistory() {
    exitingRef.current = true;
    window.history.back();
  }

  // ---- Live readout math ----
  // While aiming, the crosshair acts as a provisional next corner, so the
  // number moves as the map moves (the dopamine loop from the spec). Once
  // snapped to the first vertex, or while editing, we show only the placed
  // corners so the number does not double-count the closing point.
  const readout = useMemo(() => {
    const provisional: LatLon[] =
      selected === null && center && !snap ? [...vertices, center] : vertices;
    if (vertices.length >= 3 && provisional.length >= 3) {
      const acres = polygonAreaM2(provisional) / 4046.86;
      const perim = fmtLength(polygonPerimeterM(provisional));
      return `${fmt(acres, 2)} ac · ${perim.value} ${perim.unit}`;
    }
    if (vertices.length >= 1 && provisional.length >= 2) {
      const d = fmtLength(pathLengthM(provisional));
      return `${d.value} ${d.unit}`;
    }
    return null;
  }, [vertices, center, snap, selected]);

  // ---- Undo: short press pops one point, long press asks to clear all ----
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  function undoPointerDown() {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      if (useAppStore.getState().reticleVertices.length > 0) {
        setClearSheetOpen(true);
      }
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  function undoPointerUp() {
    cancelLongPress();
    // Only treat it as a normal tap if the long press did NOT fire
    if (!longPressFired.current) undoReticleVertex();
  }

  // ---- Primary actions ----
  function handleAddPoint() {
    if (snap) {
      // Crosshair is on top of the first corner: this tap closes the shape
      finishShape();
      return;
    }
    if (!center) return;
    addReticleVertex(center);
    hapticTick();
  }

  function finishShape() {
    if (useAppStore.getState().reticleVertices.length < 3) return;
    exitConsumingHistory();
    onFinish();
  }

  function handleMoveHere() {
    if (selected === null || !center) return;
    moveReticleVertex(selected, center);
    hapticTick();
    setSelectedVertexIndex(null);
  }

  const editing = selected !== null;

  return (
    <>
      <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-3">
        <div className="pointer-events-auto mx-auto max-w-sm">
          {/* ---- Live readout strip (kept narrow so it never sits on top
                of the zoom buttons at the right edge) ---- */}
          {readout && (
            <div className="glass num mx-auto mb-2 w-max px-4 py-1.5 text-center text-sm text-foreground">
              {readout}
            </div>
          )}

          {editing ? (
            /* ---- Vertex editing tray: Move Here / Delete / Cancel ---- */
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMoveHere}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-black shadow-lg active:bg-accent-bright"
              >
                <MapPin size={16} />
                Move Here
              </button>
              <button
                type="button"
                onClick={() => selected !== null && deleteReticleVertex(selected)}
                className="flex h-12 items-center justify-center gap-1.5 rounded-full bg-nogo/15 px-4 text-sm font-semibold text-nogo active:bg-nogo/25"
              >
                <Trash2 size={16} />
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedVertexIndex(null)}
                aria-label="Cancel editing"
                className="glass flex h-12 w-12 items-center justify-center rounded-full text-foreground"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            /* ---- Normal drawing tray: Undo / Add Point / Done ---- */
            <div className="flex items-center gap-3">
              {/* Undo, with a running vertex-count badge */}
              <button
                type="button"
                onPointerDown={undoPointerDown}
                onPointerUp={undoPointerUp}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onContextMenu={(e) => e.preventDefault()}
                disabled={vertices.length === 0}
                aria-label="Undo last point (hold to clear all)"
                className="glass relative flex h-11 w-11 select-none items-center justify-center rounded-full text-foreground disabled:opacity-40"
                style={{ touchAction: "manipulation" }}
              >
                <Undo2 size={20} />
                {vertices.length > 0 && (
                  <span className="num absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-black">
                    {vertices.length}
                  </span>
                )}
              </button>

              {/* The one big button. Label flips to Close Shape on snap. */}
              <button
                type="button"
                onClick={handleAddPoint}
                className={`h-14 flex-1 rounded-full text-sm font-semibold shadow-lg transition-colors ${
                  snap
                    ? "bg-accent-bright text-black"
                    : "bg-accent text-black active:bg-accent-bright"
                }`}
              >
                {snap ? "Close Shape" : "+ Add Point"}
              </button>

              {/* Done appears once a valid polygon exists (3+ corners).
                  An invisible spacer holds its spot before that, so the
                  big button never jumps sideways. */}
              {vertices.length >= 3 ? (
                <button
                  type="button"
                  onClick={finishShape}
                  aria-label="Finish survey"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-black shadow-lg active:bg-accent-bright"
                >
                  <Check size={20} />
                </button>
              ) : (
                <div className="h-11 w-11" aria-hidden />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Confirm: long-press Undo ---- */}
      {clearSheetOpen && (
        <ActionSheet
          title="Clear all points?"
          actions={[
            {
              label: "Clear",
              destructive: true,
              onPress: () => {
                clearReticleVertices();
                setClearSheetOpen(false);
              },
            },
          ]}
          onCancel={() => setClearSheetOpen(false)}
        />
      )}

      {/* ---- Confirm: back button / edge swipe with work in progress ---- */}
      {discardSheetOpen && (
        <ActionSheet
          title="Discard survey?"
          actions={[
            {
              label: "Discard",
              destructive: true,
              onPress: () => {
                setDiscardSheetOpen(false);
                exitConsumingHistory();
                useAppStore.getState().stopReticle();
              },
            },
          ]}
          onCancel={() => setDiscardSheetOpen(false)}
        />
      )}
    </>
  );
}
