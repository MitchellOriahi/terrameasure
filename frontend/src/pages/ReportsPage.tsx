// pages/ReportsPage.tsx
// "Saved": everything this device is holding on to, in two sections.
//
//   1. Saved surveys    - sites you tapped Save on. Tapping one reopens
//                         it: the map flies there, redraws your exact
//                         outline and runs the survey again, so you get
//                         the whole results panel back, not a screenshot.
//   2. Shared reports   - the public /r/{slug} links you created.
//
// Why both live on ONE page: from the outside they are the same idea
// ("my stuff"), and a phone bottom bar has room for one Saved button,
// not two. Reached at /saved and at /reports (the older link).
//
// Where the data comes from: localStorage on this device
// (lib/savedSurveys.ts and lib/myReports.ts). Nothing here needs an
// account. Signed-in people also get a cloud copy of saved surveys, but
// the device list is always the one shown here so the page works
// offline, instantly, for everyone.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
  RotateCw,
  X,
} from "lucide-react";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { copyText } from "@/components/results/ShareReport";
import {
  loadMyReports,
  removeMyReport,
  type MyReportEntry,
} from "@/lib/myReports";
import {
  loadSavedSurveys,
  removeSavedSurvey,
  type SavedSurveyEntry,
} from "@/lib/savedSurveys";
import { fmt } from "@/lib/geo";

/** "2026-08-03T18:22:00Z" -> "Aug 3, 2026" (blank when unreadable). */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The small colored GO / CAUTION / NO-GO pill. Tailwind color tokens
    (go, caution, nogo) come from index.css. Unknown verdicts (very old
    entries) simply render nothing. */
function VerdictChip({ verdict }: { verdict: string | null }) {
  if (verdict === "GO") {
    return (
      <span className="rounded-full bg-go/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-go">
        GO
      </span>
    );
  }
  if (verdict === "CAUTION") {
    return (
      <span className="rounded-full bg-caution/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-caution">
        CAUTION
      </span>
    );
  }
  if (verdict === "NO-GO") {
    return (
      <span className="rounded-full bg-nogo/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-nogo">
        NO-GO
      </span>
    );
  }
  return null;
}

export default function ReportsPage() {
  const navigate = useNavigate();

  // Read localStorage ONCE on first render (the lazy useState form).
  // After that, state is the source of truth; removing updates both.
  const [surveys, setSurveys] = useState<SavedSurveyEntry[]>(() =>
    loadSavedSurveys(),
  );
  const [reports, setReports] = useState<MyReportEntry[]>(() =>
    loadMyReports(),
  );

  // Which report row just had its link copied (slug), for the checkmark.
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  async function handleCopy(slug: string) {
    const ok = await copyText(`${window.location.origin}/r/${slug}`);
    if (ok) {
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug(null), 2000);
    }
  }

  /**
   * Reopen a saved survey. When we kept the outline, hand the vertices to
   * the map so it redraws the shape and re-runs the measurement (fresh
   * numbers, full results panel). Older entries with no outline can still
   * fly the map to the spot.
   */
  function handleReopen(s: SavedSurveyEntry) {
    if (s.vertices && s.vertices.length >= 3) {
      navigate("/map", { state: { reopen: { vertices: s.vertices } } });
    } else {
      navigate("/map", { state: { flyTo: { lat: s.lat, lon: s.lon } } });
    }
  }

  /** Best display name for a saved survey row. */
  function surveyTitle(s: SavedSurveyEntry): string {
    if (s.title) return s.title;
    return `Site at ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
  }

  /** Best display name for a shared-report row. */
  function rowTitle(r: MyReportEntry): string {
    if (r.title) return r.title;
    if (r.lat !== null && r.lon !== null) {
      return `Site near ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`;
    }
    return "Untitled report";
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Slim header, same pattern as the profile page */}
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
      </header>

      <main className="panel-scroll flex-1 overflow-y-auto p-6 pb-safe">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {/* ---- Title card ---- */}
          <div className="glass p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-deep">
                <Bookmark className="text-accent-bright" size={20} />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
                  Saved
                </h1>
                <p className="text-xs text-muted">
                  Your surveys and share links
                </p>
              </div>
            </div>
            {/* Honest scope note: v1 is device-local on purpose */}
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              This list lives on this device, so it works with no account
              and no signal. Signing in also keeps a cloud copy of saved
              surveys.
            </p>
          </div>

          {/* ================= Saved surveys ================= */}
          <div className="glass p-4">
            <div className="mb-2 flex items-center gap-2 px-2">
              <Bookmark className="text-accent-bright" size={15} />
              <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                Saved surveys
              </h2>
              <span className="num ml-auto text-[11px] text-muted">
                {surveys.length}
              </span>
            </div>

            {surveys.length === 0 ? (
              <p className="px-2 py-2 text-xs leading-relaxed text-muted">
                Nothing saved yet. Run a survey on the map and tap
                <span className="text-foreground"> Save</span> in the results
                to keep it here.
              </p>
            ) : (
              <ul className="flex flex-col">
                {surveys.map((s) => (
                  <li
                    key={s.id}
                    className="border-b border-line px-2 py-3 last:border-b-0"
                  >
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="mt-0.5 shrink-0 text-accent"
                        size={14}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm text-foreground">
                            {surveyTitle(s)}
                          </span>
                          <VerdictChip verdict={s.verdict} />
                          {s.score !== null && (
                            <span className="num text-[11px] text-accent-bright">
                              {Math.round(s.score)}/100
                            </span>
                          )}
                        </div>
                        <span className="num mt-0.5 block text-[11px] text-muted">
                          {fmtDate(s.savedAt)}
                          {s.areaAcres !== null
                            ? ` · ${fmt(s.areaAcres, 2)} ac`
                            : ""}
                          {s.synced ? " · synced" : " · this device"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => handleReopen(s)}
                      >
                        <RotateCw size={13} />
                        Reopen
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Delete ${surveyTitle(s)}`}
                        onClick={() => setSurveys(removeSavedSurvey(s.id))}
                      >
                        <X size={13} />
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {surveys.length > 0 && (
              <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted">
                Reopen redraws your outline and measures it again with
                today's data, so the numbers are never stale.
              </p>
            )}
          </div>

          {/* ================= Shared report links ================= */}
          <div className="glass p-4">
            <div className="mb-2 flex items-center gap-2 px-2">
              <FileText className="text-accent-bright" size={15} />
              <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                Shared reports
              </h2>
              <span className="num ml-auto text-[11px] text-muted">
                {reports.length}
              </span>
            </div>

            {reports.length === 0 ? (
              <p className="px-2 py-2 text-xs leading-relaxed text-muted">
                No share links yet. In the results, tap
                <span className="text-foreground"> Share report</span> to
                create a public link anyone can open without signing in.
              </p>
            ) : (
              <ul className="flex flex-col">
                {reports.map((r) => (
                  <li
                    key={r.slug}
                    className="border-b border-line px-2 py-3 last:border-b-0"
                  >
                    {/* Row top: name + verdict + score */}
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="mt-0.5 shrink-0 text-accent"
                        size={14}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm text-foreground">
                            {rowTitle(r)}
                          </span>
                          <VerdictChip verdict={r.verdict} />
                          {r.score !== null && (
                            <span className="num text-[11px] text-accent-bright">
                              {Math.round(r.score)}/100
                            </span>
                          )}
                        </div>
                        <span className="num mt-0.5 block text-[11px] text-muted">
                          {fmtDate(r.createdAt)}
                          {r.title && r.lat !== null && r.lon !== null
                            ? ` · ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`
                            : ""}
                        </span>
                      </div>
                    </div>

                    {/* Row actions: Open / Copy / Remove */}
                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <Link to={`/r/${r.slug}`}>
                        <Button variant="ghost" size="sm" tabIndex={-1}>
                          <ExternalLink size={13} />
                          Open
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => handleCopy(r.slug)}
                      >
                        {copiedSlug === r.slug ? (
                          <Check size={13} className="text-go" />
                        ) : (
                          <Copy size={13} />
                        )}
                        {copiedSlug === r.slug ? "Copied" : "Copy link"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Remove ${rowTitle(r)} from this list`}
                        onClick={() => setReports(removeMyReport(r.slug))}
                      >
                        <X size={13} />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {reports.length > 0 && (
              <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted">
                Remove only takes a report off this list. The shared link
                itself keeps working for anyone who has it.
              </p>
            )}
          </div>

          {/* One way back to work from an empty page */}
          {surveys.length === 0 && reports.length === 0 && (
            <div className="text-center">
              <Link to="/map">
                <Button variant="primary" size="sm" tabIndex={-1}>
                  Run a survey
                </Button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
