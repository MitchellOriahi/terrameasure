// components/CoachMarks.tsx
// A one-time guided tour of the map screen: a dimmed backdrop with a
// bright "spotlight" ring around one control at a time, plus one line of
// text. No library; just absolutely positioned divs and getBoundingClientRect.
//
// When it runs:
//   - Only after the welcome card has been dismissed (never on top of it).
//   - Only once, ever: finishing OR skipping writes a localStorage flag
//     (terrameasure_coach_v1) and the tour never comes back.
//
// Desktop shows 3 steps (draw tools, overlays button, results area).
// Mobile shows a single step pointing at the big Survey button.
//
// How the spotlight works: one div is positioned exactly over the target
// control, and its box-shadow is a huge 9999px dark halo. That halo IS
// the dimmed backdrop, and the div's own area stays clear, so the target
// appears "cut out" of the darkness. The div ignores pointer events, so
// the app underneath stays fully clickable; any click outside the text
// bubble simply ends the tour (that is the "skippable" promise).

import { useCallback, useEffect, useState } from "react";
import { useWelcomeStore, hasSeenWelcome } from "@/store/welcomeStore";
import { useIsMobile } from "@/hooks/useIsMobile";

// Versioned like the welcome flag: bump to _v2 to re-show after a redesign.
const DONE_KEY = "terrameasure_coach_v1";

function isDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    // Private-browsing mode etc: treat as done so the tour cannot nag
    // someone on every single page load.
    return true;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Storage unavailable; nothing else to do.
  }
}

// One step of the tour. `target` is a CSS selector for the control to
// spotlight; null means "use a fixed screen region instead" (the results
// panel does not exist in the DOM until a survey runs, so we spotlight
// the area where it WILL appear).
interface Step {
  target: string | null;
  text: string;
}

const DESKTOP_STEPS: Step[] = [
  { target: '[data-coach="draw"]', text: "Draw your site boundary here" },
  { target: '[data-coach="layers"]', text: "Toggle flood, wetlands, parcels" },
  { target: null, text: "Your verdict appears here" },
];

const MOBILE_STEPS: Step[] = [
  { target: '[data-coach="survey"]', text: "Start here: survey any spot" },
];

// A plain rectangle in screen pixels (a serializable DOMRect stand-in).
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the results panel will appear on desktop (right edge, under
    the top bar). Mirrors the aside in MapPage: right-4 top-20 w-96. */
function resultsAreaRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.max(12, vw - 384 - 16),
    top: 80,
    width: 384,
    height: Math.min(420, vh - 160),
  };
}

export function CoachMarks() {
  const isMobile = useIsMobile();
  const welcomeOpen = useWelcomeStore((s) => s.open);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const steps = isMobile ? MOBILE_STEPS : DESKTOP_STEPS;

  const finish = useCallback(() => {
    markDone();
    setVisible(false);
  }, []);

  // ---- When to start ----
  // Wait until the welcome card is out of the way, then start after a
  // short beat so the two overlays never overlap visually. For a
  // returning visitor (welcome long dismissed, tour flag not yet set,
  // e.g. this feature shipped after their first visit) this fires on
  // mount, which is exactly the intended "first time seeing the tour".
  useEffect(() => {
    if (visible || isDone()) return;
    if (welcomeOpen || !hasSeenWelcome()) return;
    const t = window.setTimeout(() => setVisible(true), 700);
    return () => window.clearTimeout(t);
  }, [welcomeOpen, visible]);

  // If the welcome card reopens (the "?" help button) it teaches the same
  // things better than we can; step aside for good.
  useEffect(() => {
    if (visible && welcomeOpen) finish();
  }, [visible, welcomeOpen, finish]);

  // ---- Measuring the current target ----
  // Poll briefly: the target button may not be mounted the instant the
  // tour starts (e.g. the mobile bottom bar re-appearing). Re-measure on
  // resize too, so the ring tracks orientation changes.
  useEffect(() => {
    if (!visible) return;
    const current = steps[step];
    if (!current) return;

    let tries = 0;
    const measure = () => {
      if (current.target === null) {
        setRect(resultsAreaRect());
        return true;
      }
      const el = document.querySelector(current.target);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return false; // mounted but hidden; keep waiting
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      return true;
    };

    // Note: we deliberately do NOT clear the previous rect here. Keeping
    // it until the new measurement lands lets the ring visibly glide from
    // one control to the next (the transition-all on the ring div).
    if (!measure()) {
      // Not there yet: retry every 300ms, but give up after ~3 seconds
      // rather than wait forever for a control that never mounts.
      const iv = window.setInterval(() => {
        tries += 1;
        if (measure() || tries > 10) {
          window.clearInterval(iv);
          if (tries > 10) finish();
        }
      }, 300);
      return () => window.clearInterval(iv);
    }
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, step, steps, finish]);

  // ---- Skippable by doing anything else ----
  // The dim layer does not block clicks (pointer-events: none), so if the
  // user just starts using the app, the first press anywhere outside the
  // tour bubble quietly ends the tour. Escape works too.
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest("[data-coach-ui]")) return; // our own buttons
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    // Capture phase so we see the press even if something stops bubbling.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [visible, finish]);

  if (!visible || !rect) return null;

  const current = steps[step];
  const last = step === steps.length - 1;

  // Ring geometry: 8px of breathing room around the target.
  const PAD = 8;
  const ring = {
    left: rect.left - PAD,
    top: rect.top - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Bubble placement: below the ring when the target is in the upper
  // half of the screen, above it otherwise (the mobile Survey button
  // sits at the very bottom). Clamped so it never leaves the viewport.
  const BUBBLE_W = 260;
  const targetCenterY = rect.top + rect.height / 2;
  const placeAbove = targetCenterY > window.innerHeight * 0.6;
  const bubbleLeft = Math.min(
    Math.max(12, ring.left),
    window.innerWidth - BUBBLE_W - 12,
  );
  const bubblePos = placeAbove
    ? { left: bubbleLeft, bottom: window.innerHeight - ring.top + 12 }
    : { left: bubbleLeft, top: ring.top + ring.height + 12 };

  return (
    <>
      {/* The spotlight ring. Its giant box-shadow is the dim backdrop;
          pointer-events-none keeps the whole app usable underneath. */}
      <div
        className="pointer-events-none fixed z-30 rounded-2xl border-2 border-accent-bright transition-all duration-300"
        style={{
          ...ring,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
        }}
        aria-hidden
      />

      {/* The one-line explanation plus tour controls. data-coach-ui marks
          it as "ours" so the outside-press listener leaves it alone. */}
      <div
        data-coach-ui
        role="dialog"
        aria-label="Quick tour"
        className="glass pointer-events-auto fixed z-30 p-3"
        style={{ width: BUBBLE_W, ...bubblePos }}
      >
        <p className="text-sm leading-snug text-foreground">{current.text}</p>
        <div className="mt-2.5 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="min-h-9 rounded-lg px-2 text-xs text-muted hover:text-foreground"
          >
            Skip tour
          </button>
          <span className="text-[10px] text-muted">
            {steps.length > 1 ? `${step + 1} of ${steps.length}` : ""}
          </span>
          <button
            type="button"
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="min-h-9 rounded-lg bg-accent px-3 text-xs font-semibold text-black hover:bg-accent-bright"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
