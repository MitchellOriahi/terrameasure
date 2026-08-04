// lib/mapState.ts
// Surviving a full page reload without losing the user's place.
//
// Why this exists: signing in with Google leaves our app entirely (the
// browser goes to Google's site and comes back). That reload would throw
// away the map camera and any half-drawn shape. The mobile UX spec says
// the OAuth round trip must return to the EXACT map state, so before the
// redirect we tuck everything into sessionStorage, and on the way back
// the map and the store pick it up again.
//
// sessionStorage (not localStorage) because this is a same-tab, short
// lived stash; it should not follow the user around forever.

import type { LatLon } from "@/lib/geo";
import { useAppStore } from "@/store/appStore";

const CAMERA_KEY = "tm_map_camera";
const DRAFT_KEY = "tm_draw_draft";

// Every storage call is wrapped in try/catch: private browsing modes can
// make storage throw, and losing the camera is never worth a crash.

// ---- Camera (where the map is looking) ----

export interface CameraState {
  lat: number;
  lon: number;
  zoom: number;
}

/** Called by MapView on every move-end, so the latest camera is always
    stashed and any reload (OAuth or accidental) restores it. */
export function saveCamera(camera: CameraState): void {
  try {
    sessionStorage.setItem(CAMERA_KEY, JSON.stringify(camera));
  } catch {
    // Storage blocked: skip silently.
  }
}

/** The stashed camera, or null when there is none (first visit). */
export function loadCamera(): CameraState | null {
  try {
    const raw = sessionStorage.getItem(CAMERA_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CameraState;
    if (
      typeof c.lat === "number" &&
      typeof c.lon === "number" &&
      typeof c.zoom === "number"
    ) {
      return c;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Draft geometry (a shape mid-draw or already drawn) ----

interface DraftState {
  drawnVertices: LatLon[] | null;
  reticleVertices: LatLon[];
  reticleActive: boolean;
}

/** Snapshot the in-progress drawing state right before an OAuth
    redirect leaves the page. */
export function saveDraft(): void {
  const s = useAppStore.getState();
  const draft: DraftState = {
    drawnVertices: s.drawnVertices,
    reticleVertices: s.reticleVertices,
    reticleActive: s.reticleActive,
  };
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: skip silently.
  }
}

/** Restore (and forget) any stashed draft. MapPage calls this once on
    mount; on a normal in-app visit there is nothing stashed and this is
    a no-op. */
export function restoreDraftOnce(): void {
  let draft: DraftState | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw) as DraftState;
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    return;
  }
  if (!draft) return;

  const store = useAppStore.getState();
  if (draft.drawnVertices && draft.drawnVertices.length >= 3) {
    store.setDrawnVertices(draft.drawnVertices);
  }
  if (draft.reticleActive) {
    // Re-enter reticle mode, then re-place the corners that were down.
    store.startReticle();
    for (const v of draft.reticleVertices) {
      useAppStore.getState().addReticleVertex(v);
    }
  }
}
