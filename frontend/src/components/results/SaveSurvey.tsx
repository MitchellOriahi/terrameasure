// components/results/SaveSurvey.tsx
// The "Save" action in the results view, next to Share report.
//
// THE RULE HERE: saving always works, for everyone, immediately.
//
// It used to require two invisible things at once: being signed in, and
// the cloud database having a "surveys" table. When either was missing
// the button just said "could not save", which from the outside looks
// exactly like a broken button. So the order is now inverted:
//
//   1. Write the survey to THIS DEVICE (lib/savedSurveys.ts). Instant,
//      no account, no server, works offline. This is the real save.
//   2. THEN, only if the person is signed in, try to push a copy to the
//      cloud so it follows them to their other devices. If that fails
//      for any reason (table not created yet, no signal), the survey is
//      still saved and we say plainly where it lives.
//
// The user is never blocked and never lied to about where their work is.

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bookmark, Check, Loader2, CloudOff } from "lucide-react";
import type { SurveyResponse } from "@/lib/api";
import { polygonAreaM2, type LatLon } from "@/lib/geo";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { assessSite } from "@/lib/verdict";
import { addSavedSurvey, markSynced } from "@/lib/savedSurveys";
import { Button } from "@/components/ui/button";

const M2_PER_ACRE = 4046.86;

interface SaveSurveyProps {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}

// idle -> saving -> saved. There is no "error" state any more, because a
// device save cannot really fail; the cloud half reports itself through
// the `synced` flag instead.
type SaveState = "idle" | "saving" | "saved";

export function SaveSurvey({ survey, vertices }: SaveSurveyProps) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const [state, setState] = useState<SaveState>("idle");
  // Did a copy make it to the cloud? Only meaningful once state = saved.
  const [synced, setSynced] = useState(false);

  async function handleSave() {
    setState("saving");

    // Where is this survey? The centroid (average corner) of the drawn
    // shape; if somehow there is no outline, the DEM's center works too.
    let lat = survey.dem_center_lat;
    let lon = survey.dem_center_lon;
    if (vertices && vertices.length > 0) {
      lat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
      lon = vertices.reduce((s, v) => s + v.lon, 0) / vertices.length;
    }

    const areaAcres =
      vertices && vertices.length >= 3
        ? polygonAreaM2(vertices) / M2_PER_ACRE
        : null;

    // The same verdict the panel is showing, frozen at save time.
    const assessment = assessSite(survey);

    // ---- Step 1: the real save, on this device ----
    // The saved row keeps whatever the site is already called: the name
    // the user typed in the identity header, else the place we looked
    // up, so the Saved list reads like places rather than coordinates.
    const store = useAppStore.getState();
    const name =
      store.siteName.trim() ||
      store.surveyParcel?.address ||
      store.place?.label ||
      null;

    const entry = addSavedSurvey({
      title: name,
      lat,
      lon,
      score: assessment.score,
      verdict: assessment.verdict,
      areaAcres,
      source: survey.source,
      synced: false,
      vertices: vertices ? vertices.map((v) => ({ lat: v.lat, lon: v.lon })) : null,
    });
    setState("saved");

    // ---- Step 2: the optional cloud copy ----
    if (status === "signed-in" && user) {
      try {
        const { error } = await supabase.from("surveys").insert({
          user_id: user.id,
          lat,
          lon,
          score: survey.score?.value ?? null,
          area_acres: areaAcres,
          source: survey.source,
          surveyed_at: entry.savedAt,
        });
        if (!error) {
          markSynced(entry.id);
          setSynced(true);
        }
        // An error here means the cloud table is not set up yet (see
        // docs/supabase_setup.sql) or the network dropped. Either way the
        // survey is already saved locally, so there is nothing to fix and
        // nothing to alarm the user about; the caption says "on this
        // device" and that is the truth.
      } catch {
        // Same story for a thrown network error.
      }
    }
  }

  /** Send the user to sign in, remembering where they were so they land
      right back on this survey. */
  function goSignIn() {
    navigate("/auth", { state: { from: location.pathname } });
  }

  if (state === "saved") {
    return (
      <div className="rounded-xl border border-go/40 bg-go/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Check className="shrink-0 text-go" size={16} />
          <span className="text-xs text-foreground">
            {synced ? "Saved to your account." : "Saved on this device."}
          </span>
          <Link
            to="/saved"
            className="ml-auto shrink-0 text-xs font-medium text-accent-bright underline-offset-2 hover:underline"
          >
            View saved
          </Link>
        </div>
        {/* Anonymous visitors get one quiet nudge, never a blocker */}
        {status !== "signed-in" && (
          <button
            type="button"
            onClick={goSignIn}
            className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-snug text-muted hover:text-foreground"
          >
            <CloudOff size={11} className="shrink-0" />
            Sign in to keep your saves across devices
          </button>
        )}
      </div>
    );
  }

  return (
    <Button
      variant="glass"
      size="sm"
      onClick={handleSave}
      disabled={state === "saving"}
    >
      {state === "saving" ? (
        <Loader2 className="animate-spin" size={14} />
      ) : (
        <Bookmark size={14} />
      )}
      {state === "saving" ? "Saving" : "Save"}
    </Button>
  );
}
