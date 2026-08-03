// components/results/MetricRow.tsx
// One row in the results list: label on the left, value + error on the
// right. The value uses the mono font (the "instrument readout" rule),
// everything else uses the UI font.
//
// Honesty rule from CLAUDE.md: never show a bare number. Every row either
// shows a real "±" error bound or an explicit qualifier like "est." so the
// reader always knows how much to trust the figure.

interface MetricRowProps {
  label: string;
  value: string;
  unit: string;
  /** Formatted error bound, e.g. "± 0.8". Pass a qualifier like "est." via
      `qualifier` when no numeric bound exists. */
  error?: string;
  qualifier?: string;
  /** Small gray context line under the label, e.g. "slope under 8 degrees" */
  note?: string;
}

export function MetricRow({
  label,
  value,
  unit,
  error,
  qualifier,
  note,
}: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {note && <div className="text-[11px] text-muted">{note}</div>}
      </div>
      <div className="text-right shrink-0">
        <span className="num text-base font-semibold text-foreground">
          {value}
        </span>
        <span className="ml-1 text-xs text-muted">{unit}</span>
        <div className="num text-[11px] text-muted">
          {error ? `${error} ${unit}` : (qualifier ?? "est.")}
        </div>
      </div>
    </div>
  );
}
