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
import {
  loadUnitSystem,
  saveUnitSystem,
  type UnitSystem,
} from "@/lib/units";

export type Basemap = "map" | "satellite";
export type DrawMode = "none" | "polygon" | "rectangle";

// What image is draped over the surveyed ground while in Site 3D mode.
// "satellite" means no extra image: the satellite basemap itself is
// already stretched over the terrain, and its live tiles are sharper
// than any snapshot we could pin on top.
export type Site3dDrape = "satellite" | "slope" | "contours";

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

  // ---- Reticle drawing (the mobile crosshair survey mode) ----
  // On phones we never place points by tapping the map (fingers are too
  // fat for corner-level precision). Instead a fixed crosshair sits over
  // the map, the user pans the map underneath it, and "Add Point" drops a
  // vertex at the crosshair. All of that mode's state lives here so the
  // map layers, the crosshair overlay, and the button tray (three separate
  // components) all stay in sync automatically.
  reticleActive: boolean;
  /** Enter reticle mode (also disarms desktop drawing and any parcel card). */
  startReticle: () => void;
  /** Leave reticle mode and forget the in-progress sketch. */
  stopReticle: () => void;
  // The corners placed so far, in order.
  reticleVertices: LatLon[];
  addReticleVertex: (v: LatLon) => void;
  undoReticleVertex: () => void;
  clearReticleVertices: () => void;
  moveReticleVertex: (index: number, v: LatLon) => void;
  deleteReticleVertex: (index: number) => void;
  // Which vertex is selected for editing (Move Here / Delete), or null.
  selectedVertexIndex: number | null;
  setSelectedVertexIndex: (i: number | null) => void;
  // Live camera readings, streamed in on every map move so the readout
  // strip and rubber-band line can follow the crosshair in real time.
  reticleCenter: LatLon | null;
  setReticleCenter: (c: LatLon | null) => void;
  reticleZoom: number;
  setReticleZoom: (z: number) => void;
  // True while the crosshair hovers within snapping range of vertex #1,
  // which flips "Add Point" into "Close Shape".
  snapToFirst: boolean;
  setSnapToFirst: (b: boolean) => void;
  // A counter that bumps every time a point is placed or moved; the
  // crosshair overlay watches it to replay its little pulse animation.
  reticlePulse: number;

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
  // The parcel the CURRENT survey was started from (via "Survey this
  // parcel"), or null when the user drew the shape by hand. The parcel
  // card itself closes when a survey runs, so without this field the
  // share-report flow would have no way to include the parcel facts.
  surveyParcel: ParcelResponse | null;
  setSurveyParcel: (p: ParcelResponse | null) => void;

  // ---- Units preference (imperial ft/acres/yd³ vs metric) ----
  // Defaults to imperial for the US audience; persisted in localStorage
  // (key "terrameasure_units") so the choice survives reloads. Every
  // user-facing number reads this one value so the whole app flips at once.
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;

  // ---- Site 3D mode (the "View site in 3D" experience) ----
  // True while the main map is showing the surveyed area as a tilted,
  // orbiting 3D scene. All the entering/leaving choreography (saving the
  // 2D camera, enabling terrain safely, framing the site) lives in
  // lib/site3d.ts; the store only holds the flags the UI reads.
  site3d: boolean;
  setSite3d: (on: boolean) => void;
  // Which image is stretched over the surveyed ground (see Site3dDrape).
  site3dDrape: Site3dDrape;
  setSite3dDrape: (d: Site3dDrape) => void;
  // How much to stretch heights vertically. 1 = true scale; a little
  // more makes gentle terrain readable at a glance.
  site3dExaggeration: number;
  setSite3dExaggeration: (x: number) => void;
  // Is the camera slowly circling the site right now? Any manual map
  // gesture pauses it; the control card can resume it.
  site3dOrbiting: boolean;
  setSite3dOrbiting: (b: boolean) => void;

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

  // ---- Reticle drawing ----
  reticleActive: false,
  startReticle: () =>
    set({
      reticleActive: true,
      reticleVertices: [],
      selectedVertexIndex: null,
      snapToFirst: false,
      // Also clear anything that would visually compete with drawing
      drawMode: "none",
      parcel: null,
    }),
  stopReticle: () =>
    set({
      reticleActive: false,
      reticleVertices: [],
      selectedVertexIndex: null,
      snapToFirst: false,
      reticleCenter: null,
    }),

  reticleVertices: [],
  addReticleVertex: (v) =>
    set((s) => ({
      reticleVertices: [...s.reticleVertices, v],
      reticlePulse: s.reticlePulse + 1,
    })),
  undoReticleVertex: () =>
    set((s) => ({
      reticleVertices: s.reticleVertices.slice(0, -1),
      selectedVertexIndex: null,
      snapToFirst: false,
    })),
  clearReticleVertices: () =>
    set({ reticleVertices: [], selectedVertexIndex: null, snapToFirst: false }),
  moveReticleVertex: (index, v) =>
    set((s) => ({
      reticleVertices: s.reticleVertices.map((old, i) =>
        i === index ? v : old,
      ),
      reticlePulse: s.reticlePulse + 1,
    })),
  deleteReticleVertex: (index) =>
    set((s) => ({
      reticleVertices: s.reticleVertices.filter((_, i) => i !== index),
      selectedVertexIndex: null,
    })),

  selectedVertexIndex: null,
  setSelectedVertexIndex: (i) => set({ selectedVertexIndex: i }),

  reticleCenter: null,
  setReticleCenter: (c) => set({ reticleCenter: c }),
  reticleZoom: 16, // seeded high so the "zoom in" chip never flashes early
  setReticleZoom: (z) => set({ reticleZoom: z }),

  snapToFirst: false,
  setSnapToFirst: (b) => set({ snapToFirst: b }),

  reticlePulse: 0,

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

  surveyParcel: null,
  setSurveyParcel: (p) => set({ surveyParcel: p }),

  units: loadUnitSystem(),
  setUnits: (u) => {
    saveUnitSystem(u); // remember for next visit
    set({ units: u });
  },

  // ---- Site 3D mode ----
  site3d: false,
  setSite3d: (on) => set({ site3d: on }),
  site3dDrape: "satellite",
  setSite3dDrape: (d) => set({ site3dDrape: d }),
  site3dExaggeration: 1.4, // a touch above true scale reads best
  setSite3dExaggeration: (x) => set({ site3dExaggeration: x }),
  site3dOrbiting: false,
  setSite3dOrbiting: (b) => set({ site3dOrbiting: b }),

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
      surveyParcel: null,
    }),
}));
