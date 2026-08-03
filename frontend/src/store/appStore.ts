// store/appStore.ts
// The app's shared state, using Zustand.
//
// What is Zustand? A tiny state library: you define one "store" object,
// and any component can read a slice of it with a hook. When a slice
// changes, only the components using that slice re-render. It replaces
// prop-drilling and heavyweight Redux setups for an app this size.
//
// Rule of thumb used here: MAP and UI state (which basemap, which layers
// are on, is the panel open) lives in Zustand. SERVER data (the survey
// response) is fetched through TanStack Query, and only the final result
// is mirrored here so every panel can read it.

import { create } from "zustand";
import type { ParcelResponse, SurveyResponse } from "@/lib/api";
import type { LatLon } from "@/lib/geo";

export type Basemap = "map" | "satellite";
export type DrawMode = "none" | "polygon" | "rectangle";

// The togglable data overlays in the Layers panel.
export type LayerKey =
  | "parcels"
  | "wetlands"
  | "flood"
  | "contours"
  | "hillshade";

interface AppState {
  // ---- Basemap and terrain ----
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
  terrain3d: boolean;
  toggleTerrain3d: () => void;

  // ---- Data layer toggles ----
  layers: Record<LayerKey, boolean>;
  toggleLayer: (key: LayerKey) => void;

  // ---- Drawing ----
  drawMode: DrawMode;
  setDrawMode: (m: DrawMode) => void;
  // The finished shape the user drew, kept as plain vertices. We store it
  // here (not inside terra-draw) so it survives basemap style switches.
  drawnVertices: LatLon[] | null;
  setDrawnVertices: (v: LatLon[] | null) => void;

  // ---- Survey results ----
  survey: SurveyResponse | null;
  setSurvey: (s: SurveyResponse | null) => void;

  // ---- Parcel lookup (tap the map when not drawing) ----
  // The parcel found under the user's tap; non-null shows the Parcel Card
  // and draws the boundary on the map.
  parcel: ParcelResponse | null;
  setParcel: (p: ParcelResponse | null) => void;
  // True while a /parcel request is in flight; extra taps are ignored.
  parcelLoading: boolean;
  setParcelLoading: (loading: boolean) => void;

  // ---- Tiny toast (small transient message pill) ----
  toast: string | null;
  setToast: (msg: string | null) => void;

  // ---- Panels ----
  layersPanelOpen: boolean;
  setLayersPanelOpen: (open: boolean) => void;
  resultsOpen: boolean;
  setResultsOpen: (open: boolean) => void;

  /** Clear the drawn shape and its results (the "start over" action). */
  clearSurvey: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  basemap: "map",
  setBasemap: (b) => set({ basemap: b }),

  terrain3d: false,
  toggleTerrain3d: () => set((s) => ({ terrain3d: !s.terrain3d })),

  layers: {
    // Parcels defaults ON: it controls whether tapping the map (while not
    // drawing) looks up the parcel under your finger.
    parcels: true,
    wetlands: false,
    flood: false,
    contours: false,
    hillshade: false,
  },
  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  drawMode: "none",
  setDrawMode: (m) => set({ drawMode: m }),

  drawnVertices: null,
  setDrawnVertices: (v) => set({ drawnVertices: v }),

  survey: null,
  // A fresh survey takes center stage, so the parcel card steps aside.
  setSurvey: (s) =>
    set(s !== null
      ? { survey: s, resultsOpen: true, parcel: null }
      : { survey: s, resultsOpen: false }),

  parcel: null,
  setParcel: (p) => set({ parcel: p }),
  parcelLoading: false,
  setParcelLoading: (loading) => set({ parcelLoading: loading }),

  toast: null,
  setToast: (msg) => set({ toast: msg }),

  layersPanelOpen: false,
  setLayersPanelOpen: (open) => set({ layersPanelOpen: open }),

  resultsOpen: false,
  setResultsOpen: (open) => set({ resultsOpen: open }),

  clearSurvey: () =>
    set({
      drawnVertices: null,
      survey: null,
      resultsOpen: false,
      drawMode: "none",
      parcel: null,
    }),
}));
