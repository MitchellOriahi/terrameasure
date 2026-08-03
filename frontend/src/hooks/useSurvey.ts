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
import { surveyPolygon } from "@/lib/api";
import type { LatLon } from "@/lib/geo";
import { useAppStore } from "@/store/appStore";

export function useSurvey() {
  const setSurvey = useAppStore((s) => s.setSurvey);

  // Elapsed seconds since the request started (drives the loading copy)
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const mutation = useMutation({
    mutationFn: (vertices: LatLon[]) => surveyPolygon(vertices),
    onSuccess: (data) => setSurvey(data),
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

  return {
    runSurvey: mutation.mutate,
    isLoading: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    elapsed,
  };
}

/** Pick the loading message based on how long we have been waiting. */
export function loadingMessage(elapsed: number): string {
  if (elapsed < 6) return "Contacting the survey engine...";
  if (elapsed < 15)
    return "Waking up the survey engine (the free tier naps when idle)...";
  if (elapsed < 35)
    return "Still waking up. Cold starts can take up to 50 seconds, hang tight...";
  return "Almost there. Fetching elevation data and running measurements...";
}
