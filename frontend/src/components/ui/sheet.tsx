// components/ui/sheet.tsx
// THE mobile panel primitive. Results, Layers, and any future mobile
// panel all use this one component (per the mobile UX spec: no ad hoc
// one-off mobile panels).
//
// It is a bottom sheet with three snap heights:
//   peek : 88px, just the handle and header showing
//   half : 45% of the viewport
//   full : 92% of the viewport (a sliver of map stays visible)
//
// The drag is transform-only (translateY), which the GPU animates
// without touching layout, so it stays smooth on phones. While a finger
// drags we follow it 1:1; on release we snap to the nearest height.
// Dragging well below "peek" dismisses the sheet if onDismiss is given.

import { useRef, useState, type ReactNode } from "react";

export type SheetSnap = "peek" | "half" | "full";

function snapHeightPx(snap: SheetSnap, vh: number): number {
  switch (snap) {
    case "peek":
      return 88;
    case "half":
      return 0.45 * vh;
    case "full":
      return 0.92 * vh;
  }
}

interface SheetProps {
  header: ReactNode; // always visible, even at peek; also the drag handle
  children: ReactNode; // scrollable body
  initialSnap?: SheetSnap;
  /** Called when the user flings the sheet down past the peek height. */
  onDismiss?: () => void;
}

export function Sheet({
  header,
  children,
  initialSnap = "half",
  onDismiss,
}: SheetProps) {
  const [snap, setSnap] = useState<SheetSnap>(initialSnap);
  // Extra pixels applied while a drag is live; 0 when settled
  const [dragOffset, setDragOffset] = useState(0);
  const dragStart = useRef<{ y: number; fromPx: number } | null>(null);
  // A state mirror of "is dragging" so the transition style updates
  const [dragging, setDragging] = useState(false);

  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const coveredPx = snapHeightPx(snap, vh);

  function onPointerDown(e: React.PointerEvent) {
    dragStart.current = { y: e.clientY, fromPx: coveredPx };
    setDragging(true);
    // Keep receiving move events even when the finger leaves the handle
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    // Dragging up (smaller clientY) grows the sheet
    setDragOffset(dragStart.current.y - e.clientY);
  }

  function onPointerUp() {
    if (!dragStart.current) return;
    const finalPx = dragStart.current.fromPx + dragOffset;
    dragStart.current = null;
    setDragging(false);
    setDragOffset(0);

    // Flung well below peek height? Treat it as "close this".
    if (onDismiss && finalPx < 44) {
      onDismiss();
      return;
    }
    // Otherwise snap to whichever height is nearest
    let best: SheetSnap = "half";
    let bestDist = Infinity;
    (["peek", "half", "full"] as SheetSnap[]).forEach((s) => {
      const d = Math.abs(snapHeightPx(s, vh) - finalPx);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    });
    setSnap(best);
  }

  const sheetHeight = snapHeightPx("full", vh);
  const translate = Math.max(0, sheetHeight - coveredPx - dragOffset);

  return (
    <div
      className="glass fixed inset-x-2 bottom-0 z-30 flex flex-col rounded-b-none"
      style={{
        height: sheetHeight,
        transform: `translateY(${translate}px)`,
        // Follow the finger instantly during a drag, animate the snap after
        transition: dragging ? "none" : "transform 250ms ease",
      }}
    >
      {/* Handle + header: the drag target. touch-none stops the browser
          from stealing the gesture for page scroll. */}
      <div
        className="shrink-0 cursor-grab touch-none px-4 pb-1 pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
        {header}
      </div>
      {/* Scrollable body with safe-area padding for the home indicator */}
      <div className="panel-scroll pb-safe min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {children}
      </div>
    </div>
  );
}
