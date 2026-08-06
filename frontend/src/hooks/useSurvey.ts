// hooks/useSurvey.ts
// The one hook that runs a survey.
//
// TanStack Query gives us useMutation: a helper for "fire a POST, track
// whether it is loading / failed / succeeded". We wrap it so components
// only need to call runSurvey(vertices) and read simple flags.
//
// The free-tier backend (Render free plan) goes to sleep when idle and
// can take up to ~50 seconds to wake. So this hook also runs a little
// timer while the request is in flight, and exposes elapsed seconds so
// the UI can switch to a friendly "waking up the engine" message instead
// of looking frozen.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { reverseGeocode, surveyPolygon } from "@/lib/api";
import type { LatLon } from "@/lib/geo";
import { useAppStore } from "@/store/appStore";

export function useSurvey() {
  const setSurvey = useAppStore((s) => s.setSurvey);

  // Elapsed seconds since the request started (drives the loading copy)
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const mutation = useMutation({
    mutationFn: (vertices: LatLon[]) => surveyPolygon(vertices),
    onSuccess: (data) => {
      setSurvey(data);
      // Name the place, in the background. A report has to say WHERE the
      // land is (county and state is how land is described in the US),
      // and the survey response only knows coordinates. This runs after
      // the results are already on screen, so a slow or failed lookup
      // never delays the answer the user is waiting for.
      reverseGeocode(data.dem_center_lat, data.dem_center_lon)
        .then((place) => {
          // Guard against a stale answer: if the user has already run
          // another survey, this place belongs to the old one.
          const current = useAppStore.getState().survey;
          if (current === data) useAppStore.getState().setPlace(place);
        })
        .catch(() => {
          // No place name available. The report falls back to
          // coordinates, which we always have.
        });
    },
  });

  // Start/stop the elapsed-seconds ticker with the request lifecycle.
  const { isPending } = mutation;
  useEffect(() => {
    if (isPending) {
      setElapsed(0);
      timerRef.current = window.setInterval(
        () => setElapsed((e) => e + 1),
        1000,
      );
    } else if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [isPending]);

  // Never two surveys at once: the draw tools stay usable while a survey
  // is in flight, so without this guard a second shape would fire a second
  // request, and whichever response landed LAST would win, possibly
  // showing the first shape's numbers against the second shape's outline.
  function runSurvey(vertices: LatLon[]) {
    if (mutation.isPending) return;
    mutation.mutate(vertices);
  }

  return {
    runSurvey,
    isLoading: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    elapsed,
  };
}

/** Pick the loading message based on how long we have been waiting.
 *
 * Three honest stages, tuned for trust rather than cuteness:
 *   1. Say WHY the wait exists (free hosting sleeps between uses) and
 *      calm the one fear that matters: the drawn boundary is not lost.
 *   2. Say WHAT is actually happening (real government elevation data
 *      is being fetched, this is not a stuck spinner).
 *   3. Set the finish-line expectation so nobody bails at second 50.
 * The thresholds roughly track reality: a cold Render dyno takes up to
 * ~50s to wake, then the DEM download and the math take the rest.
 */
export function loadingMessage(elapsed: number): string {
  if (elapsed < 20)
    return "Waking the survey engine (free tier sleeps between uses). Your boundary is safe.";
  if (elapsed < 45)
    return "Downloading USGS lidar elevation for your site...";
  return "Crunching slope, water, and flood checks: nearly there.";
}
