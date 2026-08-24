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
import { addMyReport, rememberEditToken } from "@/lib/myReports";
import { addSavedSurvey } from "@/lib/savedSurveys";
import { polygonAreaM2 } from "@/lib/geo";
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
  // The site's identity: the place we looked up, plus whatever the user
  // named it and wrote about it in the header block above.
  const place = useAppStore((s) => s.place);
  const siteName = useAppStore((s) => s.siteName);
  const siteNotes = useAppStore((s) => s.siteNotes);

  // "Copied!" feedback flag, reset after a moment.
  const [copied, setCopied] = useState(false);
  // Did a failed share get rescued into a device save? Drives the extra
  // reassurance line under the error.
  const [rescued, setRescued] = useState(false);

  // The optional report name the sharer types. Starts from whatever the
  // site is already called in the header, so nobody types it twice.
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
  // The best name we already have, in order: what the user typed in the
  // identity header, the parcel's address, the place we looked up.
  const knownName =
    siteName.trim() || surveyParcel?.address || place?.label || "";
  const titlePlaceholder =
    knownName ||
    (centroid
      ? `Site near ${centroid.lat.toFixed(5)}, ${centroid.lon.toFixed(5)}`
      : "Name this report (optional)");

  /** The report's final title: what was typed here, else the site name. */
  const finalTitle = title.trim() || knownName || null;

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
        title: finalTitle ?? undefined,
        // The human half of the report: the site's name, the user's own
        // notes, and the county and state we looked up. Without this the
        // shared page cannot say where the land is.
        site: {
          name: finalTitle ?? undefined,
          notes: siteNotes.trim() || undefined,
          place: place
            ? {
                place: place.place ?? undefined,
                county: place.county ?? undefined,
                state: place.state ?? undefined,
                country: place.country ?? undefined,
                label: place.label || undefined,
              }
            : undefined,
        },
      }),
    // A share link can fail for reasons the user cannot do anything
    // about (storage outage, no signal). Losing the survey on top of
    // that would be our fault, so when sharing fails we quietly keep the
    // survey on the device and say so. The person still has their work.
    onError: () => {
      try {
        const assessment = assessSite(survey);
        addSavedSurvey({
          title: finalTitle,
          lat: centroid?.lat ?? survey.dem_center_lat,
          lon: centroid?.lon ?? survey.dem_center_lon,
          score: assessment.score,
          verdict: assessment.verdict,
          areaAcres:
            vertices && vertices.length >= 3
              ? polygonAreaM2(vertices) / 4046.86
              : null,
          source: survey.source,
          synced: false,
          vertices: vertices
            ? vertices.map((v) => ({ lat: v.lat, lon: v.lon }))
            : null,
        });
        setRescued(true);
      } catch {
        // Storage blocked too. The results are still on screen; nothing
        // more we can do, and the message below still tells the truth.
      }
    },
    // The link was created: jot it down in localStorage so the Saved
    // page can list "your reports on this device", along with the edit
    // key that lets this browser rewrite the wording later. addMyReport
    // swallows its own storage errors, so this can never break sharing.
    onSuccess: (data) => {
      const assessment = assessSite(survey);
      addMyReport({
        slug: data.slug,
        title: finalTitle,
        createdAt: data.created_at,
        verdict: assessment.verdict,
        score: assessment.score,
        lat: centroid?.lat ?? null,
        lon: centroid?.lon ?? null,
      });
      if (data.edit_token) rememberEditToken(data.slug, data.edit_token);
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
        <div className="rounded-lg border border-nogo/30 bg-nogo/5 px-3 py-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-nogo">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {mutation.error.message}
          </p>
          {rescued && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
              <Check size={12} className="mt-0.5 shrink-0 text-go" />
              Saved to this device so you do not lose it. Reopen it any time
              from Saved, and share it once the link service is back.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-muted">
            Tap Share report to try again.
          </p>
        </div>
      )}
    </div>
  );
}
