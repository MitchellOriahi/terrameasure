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
  Check,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageShell,
  PageHeader,
  Section,
  EmptyNote,
} from "@/components/ui/pageChrome";
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
      <span className="tm-display border border-go/50 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-go">
        GO
      </span>
    );
  }
  if (verdict === "CAUTION") {
    return (
      <span className="tm-display border border-caution/50 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-caution">
        CAUTION
      </span>
    );
  }
  if (verdict === "NO-GO") {
    return (
      <span className="tm-display border border-nogo/50 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-nogo">
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
    <PageShell>
      <PageHeader
        label="Saved"
        title="Your surveys and links"
        note="This list lives on this device, so it works with no account and no signal. Signing in also keeps a cloud copy of saved surveys."
      />

      {/* ================= Saved surveys ================= */}
      <Section heading="Saved surveys" count={surveys.length}>
        {surveys.length === 0 ? (
          <EmptyNote>
            Nothing saved yet. Run a survey on the map and tap
            <span className="text-foreground"> Save</span> in the results to
            keep it here.
          </EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {surveys.map((s) => (
              <li
                key={s.id}
                className="border-t border-line py-4 first:border-t-0 first:pt-0"
              >
                <div className="flex items-start gap-3">
                  <MapPin className="mt-1 shrink-0 text-accent" size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-sm font-semibold text-foreground">
                        {surveyTitle(s)}
                      </span>
                      <VerdictChip verdict={s.verdict} />
                      {s.score !== null && (
                        <span className="num text-[11px] tabular-nums text-accent-bright">
                          {Math.round(s.score)}/100
                        </span>
                      )}
                    </div>
                    <span className="num mt-1 block text-[11px] text-muted">
                      {fmtDate(s.savedAt)}
                      {s.areaAcres !== null
                        ? ` / ${fmt(s.areaAcres, 2)} ac`
                        : ""}
                      {s.synced ? " / synced" : " / this device"}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 pl-7">
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
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Reopen redraws your outline and measures it again with today's
            data, so the numbers are never stale.
          </p>
        )}
      </Section>

      {/* ================= Shared report links ================= */}
      <Section heading="Shared reports" count={reports.length}>
        {reports.length === 0 ? (
          <EmptyNote>
            No share links yet. In the results, tap
            <span className="text-foreground"> Share report</span> to create a
            public link anyone can open without signing in.
          </EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {reports.map((r) => (
              <li
                key={r.slug}
                className="border-t border-line py-4 first:border-t-0 first:pt-0"
              >
                <div className="flex items-start gap-3">
                  <FileText className="mt-1 shrink-0 text-accent" size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-sm font-semibold text-foreground">
                        {rowTitle(r)}
                      </span>
                      <VerdictChip verdict={r.verdict} />
                      {r.score !== null && (
                        <span className="num text-[11px] tabular-nums text-accent-bright">
                          {Math.round(r.score)}/100
                        </span>
                      )}
                    </div>
                    <span className="num mt-1 block text-[11px] text-muted">
                      {fmtDate(r.createdAt)}
                      {r.title && r.lat !== null && r.lon !== null
                        ? ` / ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 pl-7">
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
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Remove only takes a report off this list. The shared link itself
            keeps working for anyone who has it.
          </p>
        )}
      </Section>

      {/* One way back to work from an empty page */}
      {surveys.length === 0 && reports.length === 0 && (
        <div className="pt-8">
          <Link to="/map">
            <Button variant="primary" size="md" tabIndex={-1}>
              Run a survey
            </Button>
          </Link>
        </div>
      )}
    </PageShell>
  );
}
