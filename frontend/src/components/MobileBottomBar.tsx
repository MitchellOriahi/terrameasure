// components/MobileBottomBar.tsx
// The phone-only action bar floating above the safe area:
//   Layers (left) | Survey, the big primary CTA (center) | Saved (right)
//
// "Survey" enters reticle draw mode (crosshair aiming, no map tapping);
// while drawing, this whole bar is replaced by the ReticleTray, so the
// button never needs a "cancel" state. Per the mobile UX spec the primary
// CTA is 56px tall; the side buttons are 44px.

import { useNavigate } from "react-router-dom";
import { Layers, Pentagon, Bookmark } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";

export function MobileBottomBar() {
  const navigate = useNavigate();
  const startReticle = useAppStore((s) => s.startReticle);
  const layersPanelOpen = useAppStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useAppStore((s) => s.setLayersPanelOpen);
  const authStatus = useAuthStore((s) => s.status);

  // Saved surveys live on the profile page; anonymous users go to the
  // sign-in page first (and come right back here after).
  function openSaved() {
    if (authStatus === "signed-in") {
      navigate("/profile");
    } else {
      navigate("/auth", { state: { from: "/profile" } });
    }
  }

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
          onClick={startReticle}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-black shadow-lg transition-colors active:bg-accent-bright"
          aria-label="Start a survey"
        >
          <Pentagon size={18} />
          Survey
        </button>

        {/* Saved surveys (profile page; sign-in first when anonymous) */}
        <button
          type="button"
          onClick={openSaved}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-foreground"
          aria-label="Saved surveys"
        >
          <Bookmark size={20} />
        </button>
      </div>
    </div>
  );
}
