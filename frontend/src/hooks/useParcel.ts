// hooks/useParcel.ts
// The "tap the map, whose land is this?" flow.
//
// When the user taps the map while NOT drawing, MapPage calls
// lookupParcel(lat, lon). We ask the backend GET /parcel, and then:
//   status "ok"          : store the parcel (map draws its boundary,
//                          the Parcel Card appears)
//   status "no_coverage" : small toast, we have no data for that county
//   status "unavailable" : small toast, county server did not answer
//
// While one lookup is in flight, further taps are simply ignored, so an
// impatient double-tap cannot fire two requests.

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchParcel } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

// How long the little toast pill stays on screen.
const TOAST_MS = 3500;

export function useParcel() {
  const setParcel = useAppStore((s) => s.setParcel);
  const setParcelLoading = useAppStore((s) => s.setParcelLoading);
  const setToast = useAppStore((s) => s.setToast);

  // Timer handle so a new toast replaces the old one cleanly.
  const toastTimer = useRef<number | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }

  const mutation = useMutation({
    mutationFn: ({ lat, lon }: { lat: number; lon: number }) =>
      fetchParcel(lat, lon),
    onMutate: () => setParcelLoading(true),
    onSettled: () => setParcelLoading(false),
    onSuccess: (parcel) => {
      if (parcel.status === "ok") {
        // "ok" can also mean "the county answered, but no parcel contains
        // this point" (a road, water, public land). Every field is null
        // then; showing the card would be a wall of "not published" with
        // no boundary and no Survey button. A toast is the honest UI.
        if (parcel.parcel_id === null && parcel.boundary === null) {
          showToast("No parcel at this exact point (road, water, or public land)");
          return;
        }
        setParcel(parcel);
      } else if (parcel.status === "no_coverage") {
        showToast("No parcel data here yet (pilot counties only)");
      } else {
        showToast("Parcel lookup temporarily unavailable");
      }
    },
    // A network failure gets the same honest message as "unavailable".
    onError: () => showToast("Parcel lookup temporarily unavailable"),
  });

  function lookupParcel(lat: number, lon: number) {
    // Ignore taps while a lookup is already running (debounce rule).
    if (mutation.isPending) return;
    mutation.mutate({ lat, lon });
  }

  return { lookupParcel, isLooking: mutation.isPending };
}
