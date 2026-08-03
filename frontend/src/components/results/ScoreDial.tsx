// components/results/ScoreDial.tsx
// The circular site-score gauge. Pure SVG, no chart library needed.
//
// How it works: an SVG circle can be drawn partially using stroke-dasharray
// (the classic "donut chart" trick). We draw a faint full ring as the
// track, then a colored arc on top whose length is score/100 of the
// circumference. The number sits in the middle in the mono font.
// The arc color follows the verdict (GO green, CAUTION amber, NO-GO red),
// and the verdict is ALWAYS also shown as text nearby, never color alone.

import type { Verdict } from "@/lib/verdict";

const VERDICT_COLOR: Record<Verdict, string> = {
  GO: "var(--go)",
  CAUTION: "var(--caution)",
  "NO-GO": "var(--nogo)",
};

interface ScoreDialProps {
  score: number; // 0 to 100
  verdict: Verdict;
  size?: number; // pixel diameter
}

export function ScoreDial({ score, verdict, size = 140 }: ScoreDialProps) {
  const stroke = 10;
  const r = (size - stroke) / 2; // radius, inset so the stroke fits
  const c = 2 * Math.PI * r; // circumference
  const clamped = Math.max(0, Math.min(100, score));
  // Dash pattern: draw "filled" length, then leave the rest blank.
  const filled = (clamped / 100) * c;
  const color = VERDICT_COLOR[verdict];

  return (
    <div
      className="relative inline-block"
      role="img"
      aria-label={`Site score ${clamped} out of 100, verdict ${verdict}`}
    >
      <svg width={size} height={size}>
        {/* Track: the faint full circle behind the arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        {/* The score arc. Rotated -90deg so it starts at 12 o'clock. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 600ms ease" }}
        />
      </svg>
      {/* Centered readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-4xl font-semibold text-foreground">
          {clamped}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted">
          site score
        </span>
      </div>
    </div>
  );
}
