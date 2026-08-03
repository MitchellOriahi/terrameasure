// components/results/ElevationChart.tsx
// The elevation profile: ground height along the site's diagonal.
// Plain inline SVG, no chart library: one line, a soft area fill under it,
// recessive gridlines, and a hover readout (move your finger or mouse
// across it and the nearest sample's numbers appear).
//
// Chart hygiene applied here: 2px line, quiet grid, labels in text colors
// (never the series color), single series so no legend needed.

import { useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/geo";

interface ElevationChartProps {
  /** Pairs of [distance_m, height_m] from the backend */
  profile: [number, number][];
  /** DEM vertical error in meters, shown as context under the chart */
  verticalError: number;
}

const W = 320; // internal SVG coordinate width (scales to fit its box)
const H = 120;
const PAD = { top: 10, right: 8, bottom: 18, left: 40 };

export function ElevationChart({ profile, verticalError }: ElevationChartProps) {
  // Index of the sample the pointer is nearest to (null = no hover)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert screen px to SVG coordinate space
    const x = ((e.clientX - rect.left) / rect.width) * W;
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

  const hover = hoverIdx !== null ? profile[hoverIdx] : null;
  const hoverPt = hoverIdx !== null ? pts[hoverIdx] : null;

  return (
    <div>
      {/* Hover readout line above the chart, so nothing overlaps the plot */}
      <div className="num flex h-5 items-center justify-end text-[11px] text-muted">
        {hover
          ? `${fmt(hover[0])} m along, ${fmt(hover[1], 1)} m elevation`
          : "hover the profile for exact values"}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`Elevation profile from ${fmt(hMin, 1)} to ${fmt(hMax, 1)} meters over ${fmt(dMax)} meters`}
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
          {fmt(hMax, 0)}m
        </text>
        <text
          x={PAD.left - 4}
          y={H - PAD.bottom + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {fmt(hMin, 0)}m
        </text>
        <text
          x={W - PAD.right}
          y={H - 5}
          textAnchor="end"
          fontSize="9"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {fmt(dMax)}m diagonal
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
        {/* Hover marker: vertical guide + dot on the line */}
        {hoverPt && (
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
          </g>
        )}
      </svg>
      <div className="num mt-1 text-[10px] text-muted">
        heights ± {verticalError.toFixed(1)} m (source data limit)
      </div>
    </div>
  );
}
