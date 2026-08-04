// components/results/SaveSurvey.tsx
// The "Save" action in the results view, next to Share report.
//
// Signed in: one tap inserts a small summary row into the Supabase
// "surveys" table (RLS makes sure it lands under this user only), and
// the button flips to a "Saved" confirmation.
//
// Anonymous: tapping Save opens a bottom action sheet offering to sign
// in first (with a way back to this exact survey). We never auto-save
// and never block; skipping the sheet costs the user nothing.

import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bookmark, Check, Loader2, AlertTriangle } from "lucide-react";
import type { SurveyResponse } from "@/lib/api";
import { polygonAreaM2, type LatLon } from "@/lib/geo";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { ActionSheet } from "@/components/ui/actionSheet";

const M2_PER_ACRE = 4046.86;

interface SaveSurveyProps {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveSurvey({ survey, vertices }: SaveSurveyProps) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const [state, setState] = useState<SaveState>("idle");
  const [askSignIn, setAskSignIn] = useState(false);

  async function handleSave() {
    // Not signed in? Offer sign-in, never force it.
    if (status !== "signed-in" || !user) {
      setAskSignIn(true);
      return;
    }
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

    const { error } = await supabase.from("surveys").insert({
      user_id: user.id,
      lat,
      lon,
      score: survey.score?.value ?? null,
      area_acres: areaAcres,
      source: survey.source,
      surveyed_at: new Date().toISOString(),
    });

    setState(error ? "error" : "saved");
  }

  /** Send the anonymous user to sign in, remembering where they were so
      they land right back here (survey state lives in the store and the
      OAuth draft stash, so nothing is lost). */
  function goSignIn() {
    setAskSignIn(false);
    navigate("/auth", { state: { from: location.pathname } });
  }

  return (
    <>
      {state === "saved" ? (
        <div className="flex items-center gap-2 rounded-xl border border-go/40 bg-go/10 px-4 py-2.5">
          <Check className="shrink-0 text-go" size={16} />
          <span className="text-xs text-foreground">
            Saved to your profile.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
          {state === "error" && (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-nogo">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Could not save right now. Tap Save to try again.
            </p>
          )}
        </div>
      )}

      {/* The contextual sign-in ask, as a bottom sheet per the UX spec
          (never a centered modal) */}
      {askSignIn && (
        <ActionSheet
          title="Sign in to save this survey"
          actions={[{ label: "Sign in", onPress: goSignIn }]}
          onCancel={() => setAskSignIn(false)}
        />
      )}
    </>
  );
}
