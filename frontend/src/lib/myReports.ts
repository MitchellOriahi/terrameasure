// lib/myReports.ts
// "Reports I created on THIS device", remembered in localStorage.
//
// Why localStorage and not the database? Shared reports are anonymous
// on purpose (anyone can create one, no login), so the server has no
// idea which reports are "yours". The simplest honest v1: the moment
// this browser creates a share link, we jot it down locally so the
// /reports page can list it later. Signed-in sync across devices is a
// later upgrade; the page says so out loud.
//
// Everything here is wrapped in try/catch because localStorage can be
// blocked (private browsing, strict settings). Remembering a report is
// a convenience; it must NEVER break the share flow itself.

/** One remembered report: just enough to draw a list row and link out. */
export interface MyReportEntry {
  /** The short code in the public URL (/r/{slug}). Unique per report. */
  slug: string;
  /** The name the user gave it, or null for "untitled". */
  title: string | null;
  /** ISO timestamp of when the share link was created. */
  createdAt: string;
  /** "GO" | "CAUTION" | "NO-GO" at the time of sharing, or null. */
  verdict: string | null;
  /** Site score 0 to 100 at the time of sharing, or null. */
  score: number | null;
  /** Site centroid, so an untitled report still names a real place. */
  lat: number | null;
  lon: number | null;
}

const STORAGE_KEY = "terrameasure_my_reports";

// Cap the list so localStorage never bloats. 100 reports is far more
// than anyone browses; older entries simply fall off the end.
const MAX_ENTRIES = 100;

/** Read the remembered list (newest first). Empty array on any problem. */
export function loadMyReports(): MyReportEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only rows that at least have a usable slug; anything else is
    // corrupt data from an old build and gets quietly dropped.
    return parsed.filter(
      (e): e is MyReportEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as MyReportEntry).slug === "string" &&
        (e as MyReportEntry).slug.length > 0,
    );
  } catch {
    return [];
  }
}

/** Remember a newly created report (newest first, capped, de-duplicated). */
export function addMyReport(entry: MyReportEntry): void {
  try {
    // If the same slug is somehow already listed, replace it instead of
    // duplicating the row.
    const list = loadMyReports().filter((e) => e.slug !== entry.slug);
    list.unshift(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage blocked or full: the share link still works, we just
    // cannot list it later. Never throw.
  }
}

/**
 * Forget one report ON THIS DEVICE. The public /r/{slug} page itself is
 * untouched; anyone with the link can still open it. Returns the updated
 * list so the UI can re-render without re-reading storage.
 */
export function removeMyReport(slug: string): MyReportEntry[] {
  const list = loadMyReports().filter((e) => e.slug !== slug);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // If saving fails the row may reappear next visit; harmless.
  }
  return list;
}
