// components/results/ElevationChart.tsx
// The elevation profile: ground height along the site's diagonal.
// Plain inline SVG, no chart library: one line, a soft area fill under
// it, recessive gridlines, and a scrub readout.
//
// Scrubbing works with a MOUSE and with a FINGER: we use pointer events
// (the browser API that unifies mouse and touch) and capture the
// pointer on press, so dragging across the chart keeps updating the
// readout even on phones. A small bubble follows the nearest sample.
//
// Units: axes and readout follow the app-wide units preference
// (imperial feet by default, metric via the toggle), converted through
// lib/units.ts so this chart can never disagree with the metric rows.
//
// Chart hygiene applied here: 2px line, quiet grid, labels in text
// colors (never the series color), single series so no legend needed.

import { useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/geo";
import { elevValue, elevUnit, mToFt } from "@/lib/units";
import { useAppStore } from "@/store/appStore";

interface ElevationChartProps {
  /** Pairs of [distance_m, height_m] from the backend */
  profile: [number, number][];
  /** DEM vertical error in meters, shown as context under the chart */
  verticalError: number;
}

const W = 320; // internal SVG coordinate width (scales to fit its box)
const H = 120;
// left is sized for the widest label imperial produces (e.g. "5,572ft"):
// feet numbers run longer than meters, and a clipped axis label is worse
// than a slightly narrower plot.
const PAD = { top: 10, right: 8, bottom: 18, left: 48 };

export function ElevationChart({ profile, verticalError }: ElevationChartProps) {
  // Which measurement system the whole app is showing right now.
  const units = useAppStore((s) => s.units);

  // Index of the sample the pointer is nearest to (null = no scrub)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // "pointer: coarse" is the media query for fingers-not-mice (phones,
  // tablets). We only need it for the helper copy, checked once.
  const coarsePointer = useMemo(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(pointer: coarse)").matches),
    [],
  );

  // Precompute the scaled points once per profile.
  const geom = useMemo(() => {
    if (profile.length < 2) return null;
    const dists = profile.map((p) => p[0]);
    const heights = profile.map((p) => p[1]);
    const dMax = Math.max(...dists) || 1;
    let hMin = Math.min(...heights);
    let hMax = Math.max(...heights);
    // Flat ground would make hMin == hMax and divide by zero; pad it.
    if (hMax - hMin < 1) {
      hMin -= 0.5;
      hMax += 0.5;
    }
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const pts = profile.map(([d, h]) => ({
      x: PAD.left + (d / dMax) * plotW,
      y: PAD.top + (1 - (h - hMin) / (hMax - hMin)) * plotH,
    }));
    return { pts, hMin, hMax, dMax, plotW };
  }, [profile]);

  if (!geom) {
    return (
      <div className="py-4 text-center text-xs text-muted">
        Not enough profile samples to chart.
      </div>
    );
  }

  const { pts, hMin, hMax, dMax } = geom;
  const lineD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  // Area fill: the line path, closed down to the bottom of the plot.
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD.bottom} L${pts[0].x.toFixed(1)},${H - PAD.bottom} Z`;

  // Translate a pointer position into the nearest sample index.
  function scrubTo(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert screen px to SVG coordinate space
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHoverIdx(best);
  }

  // Press (mouse down OR finger down): capture the pointer so the drag
  // keeps talking to us even if the finger wanders off the SVG, then
  // start scrubbing immediately at the press point.
  function handleDown(e: React.PointerEvent<SVGSVGElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers refuse capture in edge cases; scrubbing still
      // works while the pointer stays over the chart.
    }
    scrubTo(e.clientX);
  }

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    // Mouse hover has no buttons pressed; touch move arrives while
    // captured. Either way, follow the pointer.
    scrubTo(e.clientX);
  }

  function handleLeave(e: React.PointerEvent<SVGSVGElement>) {
    // Mouse users expect hover to clear when the cursor leaves. A
    // finger is different: after a tap the browser fires a synthetic
    // "leave" as the finger lifts, and clearing there would make "tap
    // for exact values" show nothing. So touch readouts PERSIST until
    // the next tap moves them.
    if (e.pointerType === "mouse") setHoverIdx(null);
  }

  const hover = hoverIdx !== null ? profile[hoverIdx] : null;
  const hoverPt = hoverIdx !== null ? pts[hoverIdx] : null;

  // Readout text in the current units, e.g. "312 ft along · 5,281 ft elev".
  const eu = elevUnit(units);
  const readout = hover
    ? `${elevValue(hover[0], units)} ${eu} along · ${elevValue(hover[1], units, 1)} ${eu} elev`
    : null;

  // The bubble: a rounded rect + text near the marker, flipped to the
  // left side when the marker is close to the right edge so the bubble
  // never gets clipped. Sized generously for the widest readout.
  const BUBBLE_W = 150;
  const BUBBLE_H = 16;
  let bubbleX = 0;
  if (hoverPt) {
    bubbleX = hoverPt.x + 8;
    if (bubbleX + BUBBLE_W > W - PAD.right) bubbleX = hoverPt.x - 8 - BUBBLE_W;
    if (bubbleX < 0) bubbleX = 0;
  }
  const bubbleY = PAD.top + 2;

  // Vertical accuracy in display units, e.g. "± 1.6 ft".
  const errText = `± ${units === "imperial" ? fmt(mToFt(verticalError), 1) : verticalError.toFixed(1)} ${eu}`;

  return (
    <div>
      {/* Helper copy above the chart, phrased for the input you have */}
      <div className="num flex h-5 items-center justify-end text-[11px] text-muted">
        {readout ??
          (coarsePointer
            ? "Tap or drag the profile for exact values"
            : "Hover the profile for exact values")}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerCancel={handleLeave}
        onPointerLeave={handleLeave}
        role="img"
        aria-label={`Elevation profile from ${elevValue(hMin, units, 1)} to ${elevValue(hMax, units, 1)} ${eu} over ${elevValue(dMax, units)} ${eu}`}
      >
        {/* Quiet gridlines at min and max height */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top}
          y2={PAD.top}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--border)"
        />
        {/* Axis labels wear text colors, not the series color */}
        <text
          x={PAD.left - 4}
          y={PAD.top + 4}
          textAnchor="end"
          fontSize="9"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {elevValue(hMax, units)}{eu}
        </text>
        <text
          x={PAD.left - 4}
          y={H - PAD.bottom + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {elevValue(hMin, units)}{eu}
        </text>
        <text
          x={W - PAD.right}
          y={H - 5}
          textAnchor="end"
          fontSize="9"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {elevValue(dMax, units)}{eu} diagonal
        </text>

        {/* Soft area fill under the line */}
        <path d={areaD} fill="var(--accent)" opacity="0.12" />
        {/* The elevation line itself */}
        <path
          d={lineD}
          fill="none"
          stroke="var(--accent-bright)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Scrub marker: vertical guide + dot on the line + readout bubble */}
        {hoverPt && readout && (
          <g>
            <line
              x1={hoverPt.x}
              x2={hoverPt.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--border)"
            />
            <circle
              cx={hoverPt.x}
              cy={hoverPt.y}
              r="4"
              fill="var(--accent-bright)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
            {/* The bubble */}
            <rect
              x={bubbleX}
              y={bubbleY}
              width={BUBBLE_W}
              height={BUBBLE_H}
              rx="4"
              fill="var(--surface)"
              stroke="var(--border)"
            />
            <text
              x={bubbleX + BUBBLE_W / 2}
              y={bubbleY + 11}
              textAnchor="middle"
              fontSize="8.5"
              fill="var(--foreground)"
              fontFamily="var(--font-mono)"
            >
              {readout}
            </text>
          </g>
        )}
      </svg>
      {/* What this line is and is not: the diagonal is a sample, so the
          site's true extremes can sit off to either side of it. */}
      <p className="mt-1 text-[10px] leading-snug text-muted">
        Tap or drag the line for exact values. Elevation along the site
        diagonal; site min/max may occur off this line.
      </p>
      <div className="num mt-0.5 text-[10px] text-muted">
        heights {errText} (source data limit)
      </div>
    </div>
  );
}
