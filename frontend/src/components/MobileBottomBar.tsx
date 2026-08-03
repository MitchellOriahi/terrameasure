// components/MobileBottomBar.tsx
// The phone-only action bar floating above the safe area:
//   Layers (left) | Survey, the big primary CTA (center) | Saved (right)
//
// "Survey" arms the polygon draw tool (tap again to cancel). Per the
// mobile UX spec the primary CTA is 56px tall; the side buttons are 44px.

import { useNavigate } from "react-router-dom";
import { Layers, Pentagon, Bookmark, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";

export function MobileBottomBar() {
  const navigate = useNavigate();
  const drawMode = useAppStore((s) => s.drawMode);
  const setDrawMode = useAppStore((s) => s.setDrawMode);
  const layersPanelOpen = useAppStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useAppStore((s) => s.setLayersPanelOpen);

  const drawing = drawMode !== "none";

  return (
    <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-3">
      <div className="pointer-events-auto mx-auto flex max-w-sm items-center justify-between gap-3">
        {/* Layers */}
        <button
          type="button"
          onClick={() => setLayersPanelOpen(!layersPanelOpen)}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-foreground"
          aria-label="Overlays"
        >
          <Layers size={20} />
        </button>

        {/* Survey: the one big green button */}
        <button
          type="button"
          onClick={() => setDrawMode(drawing ? "none" : "polygon")}
          className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${
            drawing
              ? "bg-surface-2 text-foreground"
              : "bg-accent text-black active:bg-accent-bright"
          }`}
          aria-label={drawing ? "Cancel drawing" : "Start a survey"}
        >
          {drawing ? <X size={18} /> : <Pentagon size={18} />}
          {drawing ? "Cancel" : "Survey"}
        </button>

        {/* Saved (placeholder destination for now) */}
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-foreground"
          aria-label="Saved sites"
        >
          <Bookmark size={20} />
        </button>
      </div>
    </div>
  );
}
