// components/ui/pageChrome.tsx
// The furniture every non-map screen is built from.
//
// Why this exists: Saved, Ground Truth, News, Profile and Auth had each
// grown their own header and their own stack of floating rounded cards.
// They worked, but they read as five different products, and none of
// them looked like the front door. One set of pieces, used everywhere,
// is what makes an app feel like it was designed rather than assembled.
//
// The language, borrowed from the drawing sheets this trade actually
// uses: a title block at the top of the page naming what you are looking
// at, sections separated by hairlines instead of floating cards, and
// mono lettering for anything measured or labelled.

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";

/**
 * The page frame: the slim app bar, then a centred column.
 *
 * `wide` is for pages that hold real content width (a report), against
 * the default reading column for lists and forms.
 */
export function PageShell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
      </header>

      <main className="panel-scroll flex-1 overflow-y-auto px-5 pb-safe">
        <div
          className={`mx-auto w-full ${wide ? "max-w-3xl" : "max-w-xl"} pb-16`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * The title block: what this page is, in the same voice as the front
 * door. A hairline under it does the work a card border used to do,
 * without boxing the content in.
 */
export function PageHeader({
  label,
  title,
  note,
  action,
}: {
  /** The small mono line above the title ("Saved", "Field log"). */
  label: string;
  title: string;
  /** One honest sentence about what this page is for. */
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="border-b border-line pb-6 pt-9">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="h-px w-6 bg-accent/60" />
            <span className="tm-label text-accent-bright">{label}</span>
          </div>
          <h1 className="tm-display mt-4 text-[2rem] text-foreground sm:text-[2.6rem]">
            {title}
          </h1>
        </div>
        {action && <div className="shrink-0 pt-1">{action}</div>}
      </div>
      {note && (
        <p className="mt-4 max-w-lg text-[13.5px] leading-relaxed text-muted">
          {note}
        </p>
      )}
    </header>
  );
}

/**
 * A section of a page: a mono heading, an optional count, and content
 * under a hairline. Replaces the floating rounded card, which stacked
 * up into a page that looked like a list of unrelated boxes.
 */
export function Section({
  heading,
  count,
  children,
  action,
}: {
  heading: string;
  /** Shown right-aligned against the heading, for list lengths. */
  count?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-b border-line py-7 last:border-b-0">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="tm-label text-foreground/70">{heading}</h2>
        {typeof count === "number" && (
          <span className="num text-[11px] tabular-nums text-muted">
            {count}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * The empty state. Bordered rather than floating, so an empty page
 * still looks like part of the same document.
 */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-line px-4 py-5 text-[13px] leading-relaxed text-muted">
      {children}
    </div>
  );
}
