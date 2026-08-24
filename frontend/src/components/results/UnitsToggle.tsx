// components/results/UnitsToggle.tsx
// The compact ft/m switch. Two tiny segments, one shared preference:
// clicking a side writes the choice into the app store (which also
// persists it to localStorage), and every number in the app converts
// because they all format through lib/units.ts.
//
// Used in two homes: the live results panel and the shared report page.

import { useAppStore } from "@/store/appStore";
import type { UnitSystem } from "@/lib/units";

export function UnitsToggle() {
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);

  // Each segment: key, short label, and a spoken-out title for hover/AT.
  const segments: [UnitSystem, string, string][] = [
    ["imperial", "ft", "Feet, acres, cubic yards"],
    ["metric", "m", "Meters, cubic meters"],
  ];

  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border border-line"
      role="group"
      aria-label="Measurement units"
    >
      {segments.map(([key, label, title]) => (
        <button
          key={key}
          type="button"
          title={title}
          aria-pressed={units === key}
          onClick={() => setUnits(key)}
          className={`num min-h-9 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
            units === key
              ? "bg-accent-deep text-accent-bright"
              : "bg-transparent text-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
