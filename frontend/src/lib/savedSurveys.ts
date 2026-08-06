// lib/savedSurveys.ts
// "Surveys I saved on THIS device", remembered in localStorage.
//
// Why this file exists: tapping Save used to do nothing useful unless
// you were signed in AND the cloud database happened to have a surveys
// table. Two invisible conditions, and when either was missing the
// button just showed an error. Saving your own work should never depend
// on somebody else's server being configured.
//
// So the rule now is: SAVING ALWAYS WORKS. It writes here, on the
// device, instantly. If the person also happens to be signed in and the
// cloud table exists, SaveSurvey.tsx additionally pushes a copy up so
// the survey follows them to their phone. The cloud is a bonus, never a
// requirement.
//
// Everything is wrapped in try/catch because localStorage can be blocked
// (private browsing, locked-down browsers). Losing the memory of a save
// is a small annoyance; throwing an exception in the middle of the
// results panel is not acceptable.

/** One saved survey, kept small on purpose (a full survey response with
    its DEM grid is far too big to stash 50 of in localStorage). */
export interface SavedSurveyEntry {
  /** Local id, unique on this device. Cloud rows keep their own ids. */
  id: string;
  /** What the user called it, or null. */
  title: string | null;
  /** Site centroid, so the map can fly back here. */
  lat: number;
  lon: number;
  /** Headline numbers at the time of saving. */
  score: number | null;
  verdict: string | null;
  areaAcres: number | null;
  /** Which elevation source produced it ("USGS 3DEP (1m lidar)", ...). */
  source: string | null;
  /** ISO timestamp of the save. */
  savedAt: string;
  /** True once a copy reached the cloud, so the UI can be honest about
      whether this survey exists anywhere but this browser. */
  synced: boolean;
  /** The drawn outline, so reopening can redraw the exact shape. */
  vertices: { lat: number; lon: number }[] | null;
}

const STORAGE_KEY = "terrameasure_saved_surveys";

// Cap the list so localStorage never fills up. Each entry is roughly a
// few hundred bytes (vertices dominate), so 60 is comfortably small.
const MAX_ENTRIES = 60;

/** Read the saved list, newest first. Returns [] on any problem. */
export function loadSavedSurveys(): SavedSurveyEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only rows that still look like a survey. Anything written by
    // an older build that no longer matches is quietly dropped.
    return parsed.filter(
      (e): e is SavedSurveyEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as SavedSurveyEntry).id === "string" &&
        typeof (e as SavedSurveyEntry).lat === "number" &&
        typeof (e as SavedSurveyEntry).lon === "number",
    );
  } catch {
    return [];
  }
}

/** A unique-enough id without pulling in a uuid library: the clock plus
    a short random tail (two saves in the same millisecond still differ). */
function newId(): string {
  const tail = Math.random().toString(36).slice(2, 8);
  return `local-${Date.now()}-${tail}`;
}

/**
 * Save a survey on this device and return the stored entry.
 *
 * Near-duplicate guard: saving the same spot twice within about 25
 * metres REPLACES the older entry instead of stacking up rows that all
 * say the same thing. People tap Save twice when they are not sure it
 * worked; that should not litter the list.
 */
export function addSavedSurvey(
  entry: Omit<SavedSurveyEntry, "id" | "savedAt"> & { savedAt?: string },
): SavedSurveyEntry {
  const stored: SavedSurveyEntry = {
    ...entry,
    id: newId(),
    savedAt: entry.savedAt ?? new Date().toISOString(),
  };
  try {
    const list = loadSavedSurveys().filter(
      (e) => !sameSpot(e, stored.lat, stored.lon),
    );
    list.unshift(stored);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(list.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Storage blocked or full. The caller still gets its entry back and
    // shows "Saved", which is true for this session; we simply cannot
    // promise it survives a reload. Never throw from a save.
  }
  return stored;
}

/** Are these effectively the same site? (About 25 m at any latitude.) */
function sameSpot(e: SavedSurveyEntry, lat: number, lon: number): boolean {
  const dLat = Math.abs(e.lat - lat) * 111_320;
  const dLon =
    Math.abs(e.lon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) < 25;
}

/** Mark one saved survey as "a copy reached the cloud". */
export function markSynced(id: string): void {
  try {
    const list = loadSavedSurveys().map((e) =>
      e.id === id ? { ...e, synced: true } : e,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Cosmetic flag only; ignore.
  }
}

/** Delete one saved survey from this device and return the new list. */
export function removeSavedSurvey(id: string): SavedSurveyEntry[] {
  const list = loadSavedSurveys().filter((e) => e.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // If writing fails the row reappears next visit; harmless.
  }
  return list;
}

/** How many surveys are saved here (used for the little count badge). */
export function savedSurveyCount(): number {
  return loadSavedSurveys().length;
}
