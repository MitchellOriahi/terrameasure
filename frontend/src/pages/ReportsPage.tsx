// pages/ReportsPage.tsx
// "Your reports": every share link this device has created, newest
// first, with Open / Copy / Remove actions.
//
// Where does the list come from? localStorage (see lib/myReports.ts).
// ShareReport.tsx writes an entry there each time a share link is
// created. Shared reports are anonymous server-side, so the device is
// the only place that knows which ones are "yours". The page says this
// honestly; signed-in sync across devices is a later upgrade.

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
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

/** "2026-08-03T18:22:00Z" -> "Aug 3, 2026" (same helper style as the
    profile page; blank when the timestamp is unreadable). */
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
  // Read localStorage ONCE on first render (the lazy useState form).
  // After that, state is the source of truth; remove updates both.
  const [reports, setReports] = useState<MyReportEntry[]>(() =>
    loadMyReports(),
  );

  // Which row just had its link copied (slug), for the brief checkmark.
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  async function handleCopy(slug: string) {
    const ok = await copyText(`${window.location.origin}/r/${slug}`);
    if (ok) {
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug(null), 2000);
    }
  }

  function handleRemove(slug: string) {
    // Removes the row from THIS device's list only. The public link
    // itself keeps working; the row text below the button says so.
    setReports(removeMyReport(slug));
  }

  /** Best display name for a row: the user's title, else coordinates,
      else a plain fallback. */
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
                <FileText className="text-accent-bright" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">
                  Your reports
                </h1>
                <p className="text-xs text-muted">
                  Share links you have created
                </p>
              </div>
            </div>
            {/* Honest scope note: v1 is device-local on purpose */}
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              Reports are listed on this device. Sign-in sync coming later.
            </p>
          </div>

          {/* ---- Empty state ---- */}
          {reports.length === 0 && (
            <div className="glass p-6 text-center">
              <p className="text-sm leading-relaxed text-muted">
                Nothing here yet. Run a survey on the map, then tap
                <span className="text-foreground"> Share report</span> in the
                results. Every link you create shows up on this list.
              </p>
              <div className="mt-5">
                <Link to="/map">
                  <Button variant="primary" size="sm" tabIndex={-1}>
                    Run a survey
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* ---- The list, newest first (stored in that order) ---- */}
          {reports.length > 0 && (
            <div className="glass p-4">
              <ul className="flex flex-col">
                {reports.map((r) => (
                  <li
                    key={r.slug}
                    className="border-b border-line px-2 py-3 last:border-b-0"
                  >
                    {/* Row top: name + verdict + score */}
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 shrink-0 text-accent" size={14} />
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
                        onClick={() => handleRemove(r.slug)}
                      >
                        <X size={13} />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {/* What Remove actually does: local list only */}
              <p className="mt-3 px-2 text-[10px] leading-relaxed text-muted">
                Remove only takes a report off this list. The shared link
                itself keeps working for anyone who has it.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
