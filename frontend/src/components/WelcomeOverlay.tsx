// components/WelcomeOverlay.tsx
// First-run onboarding for the map screen, in three parts:
//
//   1. The welcome card: auto-opens on a person's very first visit
//      (localStorage flag, see store/welcomeStore.ts), and can be
//      reopened any time from the "?" button in the TopBar.
//      Desktop: a centered dialog. Mobile: a bottom-sheet style card.
//
//   2. "Try a demo survey": flies the map to real Colorado terrain,
//      drops a preset boundary, and runs a genuine survey through the
//      exact same code path a hand-drawn shape uses (MapPage hands us
//      that path via the onRunDemo prop). Nothing is faked.
//
//   3. A small caption pill while the demo survey is in flight, so the
//      user knows the numbers about to appear are real.

import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-maplibre";
import { Compass, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  useWelcomeStore,
  hasSeenWelcome,
  markWelcomeSeen,
} from "@/store/welcomeStore";
import type { LatLon } from "@/lib/geo";

// ------------------------------------------------------------------
// Demo survey constants
// ------------------------------------------------------------------

// A hilly spot near Golden, Colorado (the Green Mountain area). Chosen
// because the terrain has real relief, so slope, buildable area, and
// earthwork numbers all come back interesting rather than flat zeros.
const DEMO_CENTER = { lat: 39.75, lon: -105.22 };
const DEMO_ZOOM = 15;

// Four corners of a slightly irregular boundary (a few dozen acres),
// deliberately not a perfect rectangle so it reads as "hand drawn".
const DEMO_VERTICES: LatLon[] = [
  { lat: 39.7524, lon: -105.2238 },
  { lat: 39.7527, lon: -105.2168 },
  { lat: 39.7478, lon: -105.2159 },
  { lat: 39.7472, lon: -105.223 },
];

// How long the fly-over lasts (ms). We submit the survey just after it
// ends, so the user watches the map arrive, sees the boundary appear,
// and then sees the loading card: the same rhythm as doing it by hand.
const DEMO_FLY_MS = 1900;

// The three steps, one line each, mirroring the landing page.
const STEPS = [
  "Pick a spot: search an address, tap a parcel, or draw a boundary.",
  "We analyze terrain, water, and flood risk from government data.",
  "Get a go or no-go verdict, a cost range, and a shareable report.",
];

// ------------------------------------------------------------------
// Small pieces
// ------------------------------------------------------------------

/** The brand diamond, same glyph as the TopBar wordmark. */
function Diamond() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect
        x="2.5"
        y="2.5"
        width="7"
        height="7"
        rx="1"
        transform="rotate(45 6 6)"
        fill="var(--accent)"
      />
    </svg>
  );
}

// ------------------------------------------------------------------
// The overlay itself
// ------------------------------------------------------------------

interface WelcomeOverlayProps {
  /** MapPage hands us its shape-submission path; calling this with the
      demo polygon runs a real survey exactly like a hand-drawn one. */
  onRunDemo: (vertices: LatLon[]) => void;
  /** True while a survey request is in flight (from MapPage's hook);
      drives the "Running a real survey..." caption. */
  surveyLoading: boolean;
}

export function WelcomeOverlay({
  onRunDemo,
  surveyLoading,
}: WelcomeOverlayProps) {
  const isMobile = useIsMobile();
  const open = useWelcomeStore((s) => s.open);
  const setOpen = useWelcomeStore((s) => s.setOpen);
  const { main: map } = useMap();

  // Demo bookkeeping: the caption shows from the moment the demo starts
  // until the survey that it kicked off comes back (success or failure).
  const [demoRunning, setDemoRunning] = useState(false);
  const sawLoadingRef = useRef(false); // "the request actually started"
  const timeoutRef = useRef<number | null>(null);

  // Auto-open exactly once per browser: first visit only.
  useEffect(() => {
    if (!hasSeenWelcome()) setOpen(true);
  }, [setOpen]);

  // Watch the loading flag: once it has gone up and come back down, the
  // demo survey is finished, so the caption can leave.
  useEffect(() => {
    if (!demoRunning) return;
    if (surveyLoading) {
      sawLoadingRef.current = true;
    } else if (sawLoadingRef.current) {
      setDemoRunning(false);
      sawLoadingRef.current = false;
    }
  }, [surveyLoading, demoRunning]);

  // If the user navigates away mid-fly, cancel the pending submission.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  /** Any dismissal counts as "seen": the card never auto-opens again
      (the "?" button in the TopBar can always bring it back). */
  function dismiss() {
    markWelcomeSeen();
    setOpen(false);
  }

  function startDemo() {
    dismiss();
    setDemoRunning(true);
    sawLoadingRef.current = false;
    // Fly to the demo terrain. "essential: true" tells MapLibre this
    // motion matters even when the OS asks for reduced motion.
    map?.flyTo({
      center: [DEMO_CENTER.lon, DEMO_CENTER.lat],
      zoom: DEMO_ZOOM,
      duration: DEMO_FLY_MS,
      essential: true,
    });
    // Submit just after the fly-over lands (works even if the map handle
    // was not ready: the survey still runs, we just skip the flight).
    timeoutRef.current = window.setTimeout(() => {
      onRunDemo(DEMO_VERTICES);
    }, DEMO_FLY_MS + 200);
  }

  return (
    <>
      {/* ---- Demo caption: small, honest, self-removing ---- */}
      {demoRunning && (
        <div
          className="glass pointer-events-none fixed bottom-24 left-1/2 z-30 w-max max-w-[90vw] -translate-x-1/2 px-4 py-2 text-center text-xs text-foreground"
          role="status"
        >
          Running a real survey on sample terrain...
        </div>
      )}

      {/* ---- The welcome card ---- */}
      {open && (
        <div
          className={`fixed inset-0 z-50 flex ${
            isMobile ? "items-end" : "items-center justify-center p-4"
          }`}
        >
          {/* Dimmed backdrop: clicking it dismisses, same as "Explore" */}
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={dismiss}
            aria-hidden
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to TerraMeasure"
            className={`glass relative flex w-full flex-col gap-4 p-6 ${
              isMobile ? "rounded-b-none border-b-0" : "max-w-md"
            }`}
            style={
              isMobile
                ? {
                    // Reuse the app's existing bottom-sheet slide-up
                    // animation (keyframes live in index.css), and pad
                    // past the iPhone home indicator.
                    animation: "sheet-up 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                    paddingBottom:
                      "calc(env(safe-area-inset-bottom, 0px) + 24px)",
                  }
                : undefined
            }
          >
            {/* Header row: title + close */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1 text-lg font-semibold tracking-tight text-foreground">
                  Welcome to Terra
                  <Diamond />
                  Measure
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  The site feasibility pre-screen for land: free, no
                  equipment, about a minute per site.
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close welcome"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {/* The three steps, one line each */}
            <ol className="flex flex-col gap-2.5">
              {STEPS.map((text, i) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="num mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-deep text-xs font-semibold text-accent-bright">
                    {i + 1}
                  </span>
                  <span className="text-[13px] leading-relaxed text-foreground">
                    {text}
                  </span>
                </li>
              ))}
            </ol>

            {/* The two ways forward */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                className="flex-1"
                onClick={startDemo}
              >
                <Play size={16} />
                Try a demo survey
              </Button>
              <Button variant="glass" className="flex-1" onClick={dismiss}>
                <Compass size={16} />
                Explore on my own
              </Button>
            </div>

            {/* The honesty footnote, always present */}
            <p className="text-[11px] leading-relaxed text-muted">
              Results are preliminary and uncertified: a licensed surveyor
              seals real surveys.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
