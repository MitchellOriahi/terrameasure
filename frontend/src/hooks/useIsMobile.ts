// hooks/useIsMobile.ts
// One question, answered reactively: "are we on a phone-sized screen?"
//
// We use the browser's matchMedia API (the JavaScript twin of a CSS media
// query). React 18+ gives us useSyncExternalStore, which is the officially
// blessed way to subscribe to a browser value like this: it re-renders the
// component whenever the media query flips (e.g. rotating an iPad).

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 768px)";

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
