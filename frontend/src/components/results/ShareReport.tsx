// components/results/ShareReport.tsx
// The "Share report" flow inside the results view.
//
// What it does: one tap POSTs the current survey (plus the parcel it
// came from, if any, and the drawn outline) to the backend, which
// answers with a short slug. We then show the full public link
// (origin + "/r/{slug}") with a Copy button, and a native Share button
// on devices that have one (phones mostly).
//
// Because ResultsContent renders this, it automatically appears in both
// homes: the desktop side panel and the mobile bottom sheet.
//
// The free-tier backend can cold-start (up to ~50s), so while the POST
// is in flight we run the same elapsed-seconds timer trick as useSurvey
// and reuse its friendly loading messages.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Share2, Loader2, AlertTriangle } from "lucide-react";
import { createReport, type SurveyResponse } from "@/lib/api";
import type { LatLon } from "@/lib/geo";
import { loadingMessage } from "@/hooks/useSurvey";
import { addMyReport } from "@/lib/myReports";
import { assessSite } from "@/lib/verdict";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";

/**
 * Put text on the clipboard, with a fallback for older browsers.
 * navigator.clipboard needs a secure context (https or localhost);
 * the fallback uses the ancient hidden-textarea + execCommand trick.
 * Exported so the report page's sticky header can share the same trick.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface ShareReportProps {
  survey: SurveyResponse;
  vertices: LatLon[] | null;
}

export function ShareReport({ survey, vertices }: ShareReportProps) {
  // The parcel this survey was started from (null for hand-drawn shapes).
  const surveyParcel = useAppStore((s) => s.surveyParcel);

  // "Copied!" feedback flag, reset after a moment.
  const [copied, setCopied] = useState(false);

  // The optional report name the sharer types. A named report reads
  // like a document ("Smith property, Travis County") instead of a
  // bare coordinate pair on the public page.
  const [title, setTitle] = useState("");

  // Placeholder suggestion built from the site's centroid, so even the
  // default hints at a real place. Falls back to plain copy when the
  // survey somehow has no vertices.
  const centroid =
    vertices && vertices.length > 0
      ? {
          lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
          lon: vertices.reduce((s, v) => s + v.lon, 0) / vertices.length,
        }
      : null;
  const titlePlaceholder = centroid
    ? `Site near ${centroid.lat.toFixed(5)}, ${centroid.lon.toFixed(5)}`
    : "Name this report (optional)";

  // Elapsed seconds while the POST is in flight (drives the cold-start
  // messaging, same pattern as useSurvey).
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createReport({
        survey,
        parcel: surveyParcel,
        vertices,
        // Best available name, in order: what the user typed, then the
        // parcel's street address. The backend stores it and the report
        // page shows it as the site title.
        title: title.trim() || (surveyParcel?.address ?? undefined),
      }),
    // The link was created: jot it down in localStorage so the /reports
    // page can list "your reports on this device". addMyReport swallows
    // its own storage errors, so this can never break the share flow.
    onSuccess: (data) => {
      const assessment = assessSite(survey);
      addMyReport({
        slug: data.slug,
        title: title.trim() || (surveyParcel?.address ?? null),
        createdAt: data.created_at,
        verdict: assessment.verdict,
        score: assessment.score,
        lat: centroid?.lat ?? null,
        lon: centroid?.lon ?? null,
      });
    },
  });

  const { isPending } = mutation;
  useEffect(() => {
    if (isPending) {
      setElapsed(0);
      timerRef.current = window.setInterval(
        () => setElapsed((e) => e + 1),
        1000,
      );
    } else if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [isPending]);

  // The full public link, once the backend has answered.
  const shareUrl = mutation.data
    ? `${window.location.origin}${mutation.data.url_path}`
    : null;

  async function handleCopy() {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleNativeShare() {
    if (!shareUrl) return;
    navigator
      .share({ title: "TerraMeasure site report", url: shareUrl })
      .catch(() => {
        // The user closed the share sheet; nothing to do.
      });
  }

  // ---- State 3: link ready. Show it with Copy (and native Share). ----
  if (shareUrl) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-deep/40 px-4 py-3">
        <div className="text-[11px] uppercase tracking-widest text-muted">
          Public report link
        </div>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="num mt-1 block break-all text-xs text-accent-bright underline-offset-2 hover:underline"
        >
          {shareUrl}
        </a>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" size="sm" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {/* Native share only exists on some devices (phones mostly) */}
          {"share" in navigator && (
            <Button variant="ghost" size="sm" onClick={handleNativeShare}>
              <Share2 size={14} />
              Share
            </Button>
          )}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          Anyone with this link can view the report. No login needed.
        </p>
      </div>
    );
  }

  // ---- State 2: creating the link (with honest cold-start copy) ----
  if (isPending) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
        <Loader2 className="shrink-0 animate-spin text-accent" size={16} />
        <span className="text-xs text-muted">{loadingMessage(elapsed)}</span>
      </div>
    );
  }

  // ---- State 1: name it (optional) + the button ----
  return (
    <div className="flex flex-col gap-2">
      {/* Small optional name so the public page has a real title */}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          Name this report (optional)
        </span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          className="rounded-lg border border-line bg-surface-2/60 px-3 py-1.5 text-xs text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:outline-none"
        />
      </label>
      <Button variant="primary" size="sm" onClick={() => mutation.mutate()}>
        <Share2 size={14} />
        Share report
      </Button>
      {mutation.error && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-nogo">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {mutation.error.message} Tap Share report to try again.
        </p>
      )}
    </div>
  );
}
