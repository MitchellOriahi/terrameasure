// pages/LandingPage.tsx
// The marketing front door at "/". The map app itself lives at "/map".
//
// Purpose: a first-time visitor should understand, in one screen, what
// TerraMeasure is (a site feasibility pre-screen for land), what they
// get (a go or no-go verdict with real numbers), and how to start
// (one big "Open the map" button).
//
// Design notes:
//   - Same design language as the app: dark warm charcoal, glass cards,
//     one emerald accent, Inter for text, JetBrains Mono for numbers.
//   - Deliberately ZERO map libraries and zero images on this page. All
//     the visuals (contour rings, glow, the sample verdict card) are
//     pure CSS, so the page loads instantly on a phone.
//   - Lazy-loaded from App.tsx, so the map bundle never pays for it.

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Gauge,
  Map as MapIcon,
  Ruler,
  Share2,
  ShieldCheck,
  Smartphone,
  Waves,
} from "lucide-react";

// ------------------------------------------------------------------
// Small building blocks
// ------------------------------------------------------------------

/** The brand diamond glyph, scalable for hero vs nav use. */
function Diamond({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
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

/** The Terra(diamond)Measure wordmark. Local copy (rather than importing
    the TopBar's) so this page stays fully self-contained. */
function Mark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex select-none items-center gap-0.5 font-semibold tracking-tight text-foreground ${className}`}
    >
      Terra
      <Diamond />
      Measure
    </span>
  );
}

/** One card in the "what you get" grid. */
function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Gauge;
  title: string;
  body: string;
}) {
  return (
    <div className="lp-reveal glass flex flex-col gap-3 p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-deep text-accent-bright">
        <Icon size={18} />
      </span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** One numbered step in "how it works". */
function Step({
  num,
  title,
  body,
}: {
  num: number;
  title: string;
  body: string;
}) {
  return (
    <div className="lp-reveal glass flex flex-col gap-3 p-6">
      <span className="num flex h-9 w-9 items-center justify-center rounded-full bg-accent-deep text-sm font-semibold text-accent-bright">
        {num}
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** A row inside the sample verdict card: label left, mono value right. */
function MockRow({
  label,
  value,
  bound,
}: {
  label: string;
  value: string;
  bound: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-sm text-foreground">
        {value} <span className="text-[11px] text-muted">{bound}</span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// The page
// ------------------------------------------------------------------

export default function LandingPage() {
  // This div is the page's scroll container (the app root is height
  // locked for the map, so the landing page scrolls inside itself).
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll-reveal: elements tagged .lp-reveal fade up the first time
  // they enter the viewport. IntersectionObserver is the browser API
  // for "tell me when this element becomes visible", so we never run
  // code on every scroll frame. Reduced-motion users skip the effect.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>(".lp-reveal");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach((el) => el.classList.add("lp-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-in");
            io.unobserve(entry.target);
          }
        }
      },
      { root, threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="h-dvh overflow-y-auto overflow-x-hidden bg-background text-foreground"
      style={{ scrollBehavior: "smooth" }}
    >
      {/* Page-local styles: the reveal transition and the animated
          contour rings behind the hero. Scoped with an lp- prefix so
          nothing leaks into the rest of the app. */}
      <style>{`
        .lp-reveal { opacity: 0; transform: translateY(18px); transition: opacity .7s ease, transform .7s ease; }
        .lp-reveal.lp-in { opacity: 1; transform: none; }
        @keyframes lp-ring {
          0%   { transform: translate(-50%, -50%) scale(0.55); opacity: 0; }
          15%  { opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(1.45); opacity: 0; }
        }
        .lp-ring {
          position: absolute; left: 50%; top: 38%;
          border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
          border-radius: 9999px;
          transform: translate(-50%, -50%);
          animation: lp-ring 7s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-ring { animation: none; opacity: 0.12; transform: translate(-50%, -50%); }
        }
      `}</style>

      {/* ============================================================
          NAV: sticky, slim, glassy
         ============================================================ */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link to="/" aria-label="TerraMeasure home">
            <Mark className="text-[15px]" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#how-it-works"
              className="hidden rounded-lg px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <Link
              to="/news"
              className="hidden rounded-lg px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              News
            </Link>
            <Link
              to="/auth"
              className="rounded-lg px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/map"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-black transition-colors hover:bg-accent-bright"
            >
              Open the map
              <ArrowRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      {/* ============================================================
          HERO
         ============================================================ */}
      <section className="relative overflow-hidden">
        {/* Decoration layer: an emerald glow, a faint dot grid, and
            slowly expanding contour rings (a nod to topo maps). All
            pure CSS, all behind the content, none of it interactive. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 18%, rgba(16,185,129,0.13), transparent 65%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          />
          {/* Three staggered rings reads as gentle terrain contours */}
          <div className="lp-ring h-[420px] w-[420px]" />
          <div
            className="lp-ring h-[420px] w-[420px]"
            style={{ animationDelay: "2.3s" }}
          />
          <div
            className="lp-ring h-[420px] w-[420px]"
            style={{ animationDelay: "4.6s" }}
          />
        </div>

        <div className="relative mx-auto max-w-3xl px-6 pb-16 pt-20 text-center sm:pb-24 sm:pt-28">
          {/* Eyebrow badge */}
          <div className="lp-reveal lp-in mx-auto inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent-deep/40 px-4 py-1.5 text-[11px] font-medium tracking-wide text-accent-bright">
            <Diamond size={9} />
            Site feasibility pre-screen for land
          </div>

          {/* Headline: the promise, then the speed */}
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            <span className="block text-foreground">
              Should you build on that land?
            </span>
            <span className="block bg-linear-to-r from-accent-bright to-accent bg-clip-text text-transparent">
              Find out in about a minute.
            </span>
          </h1>

          {/* The one-paragraph explanation */}
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Pick any spot in the US. TerraMeasure reads government terrain,
            flood, and wetland data and hands you a go or no-go verdict:
            slope, buildable area, risk flags, and an earthwork cost range.
            Free, no equipment, no site visit.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/map"
              className="group inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent px-7 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition-colors hover:bg-accent-bright sm:w-auto"
            >
              Open the map
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-12 w-full max-w-xs items-center justify-center rounded-xl border border-line bg-surface/70 px-7 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 sm:w-auto"
            >
              See how it works
            </a>
          </div>

          {/* Trust row */}
          <p className="mt-6 text-[11px] tracking-wide text-muted">
            Free forever
            <span className="mx-2 text-line">·</span>
            No sign-up needed
            <span className="mx-2 text-line">·</span>
            Works on your phone
          </p>

          {/* Sample verdict card: shows the product's actual output
              shape (verdict, score, numbers WITH error bounds) without
              loading a single map tile. Clearly labeled as an example. */}
          <div className="lp-reveal mx-auto mt-14 w-full max-w-sm text-left">
            <p className="mb-2 text-center text-[10px] uppercase tracking-[0.2em] text-muted">
              Example verdict
            </p>
            <div className="glass p-4">
              <div className="flex items-center justify-between rounded-lg border border-go/25 bg-go/10 px-3 py-2.5">
                <span className="text-sm font-semibold text-go">
                  GO · Buildable site
                </span>
                <span className="num text-base font-semibold text-go">
                  82<span className="text-xs opacity-70">/100</span>
                </span>
              </div>
              <div className="mt-2 px-1">
                <MockRow label="Average slope" value="4.2°" bound="±0.6°" />
                <MockRow label="Buildable area" value="86%" bound="±5%" />
                <MockRow
                  label="Earthwork estimate"
                  value="$18k to $34k"
                  bound=""
                />
                <MockRow label="FEMA flood zone" value="None" bound="" />
              </div>
              <p className="mt-3 border-t border-line pt-3 text-center text-[10px] leading-relaxed text-muted">
                Preliminary, uncertified · Error bounds on every number
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          HOW IT WORKS: the three steps
         ============================================================ */}
      <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <div className="lp-reveal text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent-bright">
            How it works
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
            Three steps, about a minute.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            No GPS receiver, no drone, no site visit. Everything runs on
            public government data.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Step
            num={1}
            title="Pick a spot or parcel"
            body="Search an address, tap a parcel to load its real boundary, or draw any shape by hand. Anywhere in the US."
          />
          <Step
            num={2}
            title="We analyze the site"
            body="Slope and buildable ground from USGS elevation data, plus wetland, flood, and water checks from federal hazard maps. All automatic."
          />
          <Step
            num={3}
            title="Get your verdict"
            body="A go or no-go verdict with a plain-English score breakdown, an earthwork cost range in dollars, and a report link you can share."
          />
        </div>
      </section>

      {/* ============================================================
          WHAT YOU GET: the feature grid
         ============================================================ */}
      <section className="mx-auto max-w-5xl px-6 pb-16 sm:pb-20">
        <div className="lp-reveal text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent-bright">
            What you get
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
            A decision, not just a map.
          </h2>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={Gauge}
            title="Verdict and score"
            body="GO, CAUTION, or NO-GO with a factor-by-factor breakdown. No black-box scoring: every point is explained."
          />
          <FeatureCard
            icon={MapIcon}
            title="Real parcel data"
            body="Tap a parcel for its true boundary and acreage in pilot counties, or draw your own boundary anywhere on the map."
          />
          <FeatureCard
            icon={Waves}
            title="Wetland, flood, and water checks"
            body="National Wetlands Inventory and FEMA flood zones, flagged on the map and folded into the score."
          />
          <FeatureCard
            icon={Banknote}
            title="Earthwork cost range"
            body="Cut and fill volumes turned into a dollar range, so a lot that only looks flat in photos never burns you."
          />
          <FeatureCard
            icon={Share2}
            title="Shareable reports"
            body="Every survey gets a public link: verdict, numbers, and error bounds, readable on any device, no login required."
          />
          <FeatureCard
            icon={Smartphone}
            title="Works on your phone"
            body="Install it like an app and pre-screen a site from the truck, the office, or the listing photos, in about a minute."
          />
        </div>
      </section>

      {/* ============================================================
          HONESTY STRIP: the trust position, stated plainly
         ============================================================ */}
      <section className="border-y border-line bg-surface/40">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-12 sm:grid-cols-3 sm:py-14">
          <div className="lp-reveal flex flex-col gap-2">
            <ShieldCheck className="text-accent-bright" size={20} />
            <h3 className="text-sm font-semibold text-foreground">
              Preliminary and uncertified
            </h3>
            <p className="text-xs leading-relaxed text-muted">
              This is a pre-screen, not a survey. A licensed Professional
              Land Surveyor seals the real thing; we get you to that
              conversation faster.
            </p>
          </div>
          <div className="lp-reveal flex flex-col gap-2">
            <Ruler className="text-accent-bright" size={20} />
            <h3 className="text-sm font-semibold text-foreground">
              Error bounds on every number
            </h3>
            <p className="text-xs leading-relaxed text-muted">
              Every measurement carries its uncertainty and names its data
              source. That honesty is the whole product.
            </p>
          </div>
          <div className="lp-reveal flex flex-col gap-2">
            <CircleDollarSign className="text-accent-bright" size={20} />
            <h3 className="text-sm font-semibold text-foreground">
              Free to use
            </h3>
            <p className="text-xs leading-relaxed text-muted">
              The core verdict is never paywalled. No card, no trial timer,
              no surprise billing.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================
          FINAL CTA
         ============================================================ */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-24">
        <div className="lp-reveal">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Check your first site now.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            No sign-up. Open the map, tap a parcel or draw a boundary, and
            read your verdict.
          </p>
          <Link
            to="/map"
            className="group mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-8 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition-colors hover:bg-accent-bright"
          >
            Open the map
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </section>

      {/* ============================================================
          FOOTER
         ============================================================ */}
      <footer className="border-t border-line">
        <div className="pb-safe mx-auto max-w-5xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <Mark className="text-sm" />
            <nav className="flex items-center gap-5 text-xs text-muted">
              <Link to="/map" className="transition-colors hover:text-foreground">
                Open the map
              </Link>
              <Link to="/news" className="transition-colors hover:text-foreground">
                Land news
              </Link>
              <Link to="/auth" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </nav>
          </div>
          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted sm:text-left">
            All TerraMeasure outputs are preliminary and uncertified. A
            licensed Professional Land Surveyor (PLS) must prepare and seal
            any legally binding survey.
          </p>
          <p className="mt-2 text-center text-[11px] text-muted sm:text-left">
            © 2026 TerraMeasure · Preliminary assessments only
          </p>
        </div>
      </footer>
    </div>
  );
}
