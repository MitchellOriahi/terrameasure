// components/results/ScopeStrip.tsx
// The honesty strip that sits DIRECTLY under the verdict banner, in
// both the live results panel and the shared report page.
//
// Why it exists: the score checks terrain and water (slope, flood,
// wetlands, open water) and nothing else. A big green GO can still be
// a bad buy if zoning, septic, or legal access kills the build. This
// strip scopes the verdict so nobody can say we hid that.
//
// The list comes from the backend (score.not_checked) when the server
// sends it; older backends get a fixed, accurate fallback list. We
// never fabricate: the fallback names exactly the factors the engine
// truly does not check today.

const FALLBACK_NOT_CHECKED = [
  "zoning",
  "septic and soils",
  "legal access",
  "utilities",
];

export function ScopeStrip({ notChecked }: { notChecked?: string[] }) {
  // Use the server's list when it exists and is non-empty.
  const items =
    notChecked && notChecked.length > 0 ? notChecked : FALLBACK_NOT_CHECKED;

  return (
    <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] leading-snug text-muted">
      <span className="font-semibold uppercase tracking-wider text-foreground/70">
        Not checked:
      </span>{" "}
      {items.join(", ")}. Verify before purchase.
    </div>
  );
}
