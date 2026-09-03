// pages/LandingPage.tsx
// The front door at "/". The map app itself lives at "/map".
//
// What this page has to do, in order:
//   1. Say what TerraMeasure decides for you (buy it or walk away).
//   2. LET YOU USE IT before asking for anything: the hero holds a real
//      satellite map with a real draggable boundary and a live acreage
//      readout, and a real 3D model of real ground.
//   3. Show what comes back, including the error bounds, because the
//      honesty IS the product.
//   4. Be plain about the limits and the coverage.
//
// Design notes: this is meant to read like a surveyor's spec sheet, not
// a SaaS template. Left-aligned type, hairline rules, mono for numbers,
// one accent colour, no gradient headline, no stock photography. The
// only decoration is the product itself doing its job.
//
// Lazy-loaded from App.tsx, so someone who opens /map directly never
// downloads this page at all.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  Gauge,
  Map as MapIcon,
  Share2,
  Smartphone,
  Waves,
} from "lucide-react";
import { DemoMeasureMap } from "@/components/landing/DemoMeasureMap";
import { SiteMesh3D } from "@/components/results/SiteMesh3D";
import { SAMPLE_SITE, SAMPLE_SITE_VERTICES } from "@/data/sampleSite";

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

/**
 * A section label: an index number, a rule, then the name of the
 * section.
 *
 * The old version was 10px of muted mono, so small it read as a
 * disclaimer rather than a signpost, and every section looked identical
 * from a distance. This one is bigger (12px), brighter, and carries a
 * number, which does two things: it gives the eye something to anchor on
 * while scrolling, and it makes the page feel like a document with parts
 * rather than a scroll of cards. Drafting sheets number their views for
 * the same reason.
 */
function SectionLabel({
  index,
  children,
}: {
  index?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      {index && (
        <span className="lp-display text-3xl tabular-nums text-accent sm:text-4xl">
          {index}
        </span>
      )}
      <span className="mb-1 h-px flex-1 max-w-[3rem] bg-accent/40" />
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-bright sm:text-xs">
        {children}
      </span>
    </div>
  );
}

/** One line of the "what comes back" spec table. */
function SpecRow({
  label,
  value,
  bound,
  note,
}: {
  label: string;
  value: string;
  bound?: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground/90">{label}</span>
        {note && (
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">
            {note}
          </span>
        )}
      </span>
      <span className="num shrink-0 text-sm text-foreground">
        {value}
        {bound && <span className="ml-1 text-[11px] text-muted">{bound}</span>}
      </span>
    </div>
  );
}

/** One card in the "what you get" grid. */
function FeatureCard({
  icon: Icon,
  index,
  title,
  body,
}: {
  icon: typeof Gauge;
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="lp-reveal group border-t-2 border-dashed border-[#111]/15 pt-4">
      <div className="flex items-center gap-2.5">
        <span className="lp-display text-2xl text-[#0d7a44]">{index}</span>
        <Icon size={15} className="text-[#0d7a44]" />
      </div>
      <h3 className="lp-display mt-3 text-[15px] text-[#111]">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-[#111]/65">{body}</p>
    </div>
  );
}

/** One question in the FAQ. Uses the browser's own disclosure element,
    so it works with no JavaScript and is keyboard accessible for free. */
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[15px] font-medium text-foreground">
        {q}
        <ChevronDown
          size={16}
          className="shrink-0 text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-3 max-w-2xl text-[13.5px] leading-[1.65] text-muted">
        {children}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------
// The page
// ------------------------------------------------------------------

export default function LandingPage() {
  // This div is the page's scroll container (the app root is height
  // locked for the map, so the landing page scrolls inside itself).
  const rootRef = useRef<HTMLDivElement>(null);

  // Has the reader scrolled past the hero? Drives the sticky phone CTA
  // at the bottom, which must not exist while the hero's own buttons are
  // still on screen (two competing calls to action, one of them covering
  // content, is worse than none).
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => setPastHero(root.scrollTop > window.innerHeight * 0.9);
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal: elements tagged .lp-reveal fade up the first time
  // they enter the viewport. IntersectionObserver is the browser API for
  // "tell me when this element becomes visible", so we never run code on
  // every scroll frame. Reduced-motion users skip the effect.
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
      { root, threshold: 0.12 },
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
      {/* Page-local styles: the reveal transition and the faint contour
          backdrop. Scoped with an lp- prefix so nothing leaks into the
          rest of the app. */}
      <style>{`
        .lp-reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
        .lp-reveal.lp-in { opacity: 1; transform: none; }

        /* Hazard stripes. Borrowed from equipment livery and site
           tape, which is the world this product lives in: survey
           markers, grade stakes, plant hire. One motif, used sparingly,
           does more for identity than another gradient. */
        .lp-stripes {
          background-image: repeating-linear-gradient(
            -55deg,
            var(--accent) 0px,
            var(--accent) 14px,
            transparent 14px,
            transparent 34px
          );
        }

        /* Registration marks: four corner brackets around a visual, the
           way a drawing frames a detail view. They tell the eye "this is
           the specimen" without a heavy border. */
        .lp-marks { position: relative; }
        .lp-marks::before,
        .lp-marks::after {
          content: "";
          position: absolute;
          width: 18px; height: 18px;
          border-color: var(--accent);
          pointer-events: none;
        }
        .lp-marks::before { top: -6px; left: -6px; border-top: 2px solid; border-left: 2px solid; }
        .lp-marks::after { bottom: -6px; right: -6px; border-bottom: 2px solid; border-right: 2px solid; }

        /* The display setting for headlines: heavy, uppercase, tight.
           Space Grotesk at this weight and tracking reads like stencil
           lettering on equipment rather than a website headline. */
        .lp-display {
          font-family: var(--font-display);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: -0.02em;
          line-height: 0.98;
        }
        /* Contour backdrop: repeating hairlines bent by a skew, which
           reads as a topographic sheet without loading an image. */
        .lp-topo {
          background-image: repeating-linear-gradient(
            115deg,
            color-mix(in srgb, var(--accent) 9%, transparent) 0px,
            color-mix(in srgb, var(--accent) 9%, transparent) 1px,
            transparent 1px,
            transparent 22px
          );
          mask-image: radial-gradient(ellipse 75% 60% at 70% 20%, black, transparent 72%);
        }
      `}</style>

      {/* ============================================================
          NAV
         ============================================================ */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link to="/" aria-label="TerraMeasure home">
            <Mark className="text-[15px]" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#how-it-works"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <a
              href="#faq"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              FAQ
            </a>
            <Link
              to="/news"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              News
            </Link>
            <Link
              to="/auth"
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/map"
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 font-display text-xs font-semibold text-black transition-colors hover:bg-accent-bright sm:h-9"
            >
              Open the map
              <ArrowRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      {/* ============================================================
          HERO: copy on the left, a working tool on the right
         ============================================================ */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="lp-topo pointer-events-none absolute inset-0" aria-hidden />
        {/* Hazard stripes across the top right, cropped by the section.
            Sparing on purpose: one flash of the motif, not wallpaper. */}
        <div
          className="lp-stripes pointer-events-none absolute -right-24 -top-24 h-64 w-[28rem] rotate-6 opacity-[0.07]"
          aria-hidden
        />
        {/* The price, in the corner, the way a product page states one.
            It is the most persuasive number here: everything else on the
            page argues that the answer is good, and this says it costs
            nothing to find out. Hidden on phones, where the hero has no
            room to spare. */}
        <div className="pointer-events-none absolute right-6 top-8 hidden text-right lg:block">
          <div className="lp-display text-5xl text-accent">$0</div>
          <div className="font-display text-[10px] uppercase tracking-[0.2em] text-muted">
            per survey
          </div>
        </div>

        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-14 pt-10 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:pb-20 lg:pt-16">
          {/* ---- Left: the claim ---- */}
          <div>
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-bright">
              Site pre-screen / United States
            </span>

            <h1 className="lp-display mt-5 text-[2.7rem] text-foreground sm:text-[4.1rem]">
              Know whether the land is{" "}
              <span className="text-accent">worth the drive.</span>
            </h1>

            <p className="mt-6 max-w-lg text-[15px] leading-[1.7] text-muted sm:text-base">
              Draw any boundary in the country. TerraMeasure reads federal
              elevation, wetland and flood data and answers the question
              that comes first: build here, or keep looking. Every number
              carries its error bound.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/map"
                className="group inline-flex items-center justify-center gap-2 bg-accent px-8 py-4 font-display text-sm font-bold uppercase tracking-wider text-black transition-colors hover:bg-accent-bright"
              >
                Open the map
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center border border-line bg-transparent px-8 py-4 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-colors hover:border-accent/60 hover:text-accent-bright"
              >
                See what comes back
              </a>
            </div>

            {/* ---- Spec chips ----
                 The way a product states its numbers on the pack. Four
                 facts, each one a thing a buyer actually weighs: how
                 accurate, from how many sources, how fast, what it costs. */}
            <dl className="mt-10 grid max-w-lg grid-cols-4 gap-px overflow-hidden border border-line bg-line">
              {[
                ["0.2 m", "lidar accuracy"],
                ["3", "federal sources"],
                ["60 s", "to an answer"],
                ["None", "sign-up needed"],
              ].map(([v, k]) => (
                <div key={k} className="bg-background px-2 py-3 text-center">
                  <dt className="num text-lg font-semibold text-foreground sm:text-xl">
                    {v}
                  </dt>
                  <dd className="mt-1 font-display text-[9px] uppercase leading-tight tracking-[0.12em] text-muted">
                    {k}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ---- Right: the live tool, framed like a detail view ---- */}
          <div className="lp-reveal lp-in">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                Live, right here
              </span>
              <span className="text-[11px] text-muted">
                real satellite imagery
              </span>
            </div>
            <div className="lp-marks">
              <DemoMeasureMap />
            </div>
          </div>

          {/* Where the answers come from. The first silent question about
              a free tool is "based on what?", and naming the actual
              federal datasets answers it faster than any paragraph. */}
          <div className="border-t border-line pt-5 lg:col-span-2">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Reading, live
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-display text-[12px] uppercase tracking-wider text-foreground/60">
              <span>USGS 3DEP lidar</span>
              <span className="text-accent/50">/</span>
              <span>FEMA flood hazard layer</span>
              <span className="text-accent/50">/</span>
              <span>USFWS wetlands inventory</span>
              <span className="text-accent/50">/</span>
              <span>USGS hydrography</span>
              <span className="text-accent/50">/</span>
              <span>county parcel records</span>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          PROOF: the actual product, photographed
          ------------------------------------------------------------
          Not a mockup. scripts/capture-product.mjs drives the real app,
          runs a real survey and screenshots the result, so this section
          cannot drift away from what the app actually looks like. Someone
          deciding whether to spend a minute on a tool they have never
          heard of wants to see the thing working.
         ============================================================ */}
      <section className="border-b border-line bg-surface/30">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-2xl">
            <SectionLabel index="01">The actual screen</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              Draw a boundary. Get an answer with its receipts.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.7] text-muted">
              A real survey of real ground near Firestone, Colorado, run
              by the live engine: the verdict, the reason behind it, the
              county it sits in, and what grading a building pad would
              actually cost.
            </p>
          </div>

          <figure className="lp-reveal mt-10">
            <div className="overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/60">
              <img
                src="/shots/app-desktop.jpg"
                width={1440}
                height={900}
                loading="lazy"
                alt="The TerraMeasure map with a boundary drawn over farmland and a results panel reading CAUTION, site intersects a FEMA high-risk flood zone, with a building pad earthwork cost of 16 to 35 thousand dollars."
                className="block w-full"
              />
            </div>
            <figcaption className="mt-3 text-[12px] text-muted">
              Screenshot of the live app, not a mockup. Verdict, reason,
              county, acreage and cost, all from public federal data.
            </figcaption>
          </figure>

          <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="lp-reveal">
              <h3 className="lp-display text-xl text-foreground sm:text-2xl">
                Send it to anyone. Nothing to install, no login on their
                end.
              </h3>
              <p className="mt-4 max-w-lg text-[15px] leading-[1.7] text-muted">
                Every survey can become a link. Whoever opens it sees the
                same verdict, the same numbers with the same error
                bounds, the site name and county, and any notes you
                added, on whatever phone they happen to be holding. They
                can copy it as text or print it to PDF.
              </p>
              <Link
                to="/map"
                className="mt-6 inline-flex items-center gap-1.5 font-display text-sm font-medium text-accent-bright hover:underline"
              >
                Make one now
                <ArrowRight size={14} />
              </Link>
            </div>
            <figure className="lp-reveal mx-auto w-[240px] shrink-0">
              <div className="overflow-hidden rounded-[28px] border-4 border-surface-2 shadow-2xl shadow-black/60">
                <img
                  src="/shots/report-phone.jpg"
                  width={585}
                  height={1266}
                  loading="lazy"
                  alt="A shared TerraMeasure report open on a phone, showing the site name, county, verdict and measurements."
                  className="block w-full"
                />
              </div>
            </figure>
          </div>
        </div>
      </section>

      {/* ============================================================
          THE GROUND ITSELF: the 3D model, from real elevation data
         ============================================================ */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-20">
          <div className="lp-reveal order-2 lg:order-1">
            <SiteMesh3D survey={SAMPLE_SITE} vertices={SAMPLE_SITE_VERTICES} />
          </div>
          <div className="lp-reveal order-1 lg:order-2">
            <SectionLabel index="02">What the engine actually sees</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              A photo shows you trees. This shows you the ground.
            </h2>
            <p className="mt-5 text-[15px] leading-[1.7] text-muted">
              Every measurement in TerraMeasure comes off an elevation
              grid: a block of ground heights from USGS lidar, one number
              per square metre where the coverage is good. Area is
              counting cells, slope is how fast the numbers change, cut
              and fill is comparing two grids. That is the whole trick,
              and it is why the answers are arithmetic instead of
              opinion.
            </p>
            <p className="mt-4 text-[15px] leading-[1.7] text-muted">
              Spin the model. That is real ground west of Golden,
              Colorado, trimmed to a real drawn boundary, rendered from
              the same grid that produced its verdict.
            </p>
            <Link
              to="/map"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent-bright hover:underline"
            >
              Run this on your own land
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================
          WHAT COMES BACK: the report, as a spec sheet
         ============================================================ */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-2 lg:py-20">
          <div className="lp-reveal">
            <SectionLabel index="03">What comes back</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              One verdict, and the receipts behind it.
            </h2>
            <p className="mt-5 text-[15px] leading-[1.7] text-muted">
              The answer is a single word, because that is the decision
              you are making. Everything under it exists to let a
              professional check the word: which factor moved the score,
              which federal dataset said so, how current that data is,
              and how wrong each number could be.
            </p>
            <p className="mt-4 text-[15px] leading-[1.7] text-muted">
              Share it as a link and the person who opens it sees the
              same page, with no login, on any phone.
            </p>
          </div>

          {/* The example report card */}
          <div className="lp-reveal">
            <div className="rounded-2xl border border-line bg-surface/60 p-4">
              <div className="font-display text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/70">
                Example report
              </div>
              <div className="mt-2 rounded-xl border border-caution/30 bg-caution/10 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg font-bold tracking-tight text-caution">
                    PROCEED WITH CONDITIONS
                  </span>
                  <span className="num text-base font-semibold text-caution">
                    63<span className="text-xs opacity-70">/100</span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-foreground/80">
                  Buildable terrain, but 12% of the site sits in a FEMA
                  high-risk flood zone.
                </p>
              </div>
              <div className="mt-3 px-1">
                <SpecRow
                  label="Average slope"
                  value="4.2°"
                  bound="± 0.6°"
                  note="USGS 3DEP lidar, 1 m grid"
                />
                <SpecRow
                  label="Buildable area"
                  value="86%"
                  note="ground under 8°, adjusted for open water"
                />
                <SpecRow
                  label="Cut volume"
                  value="4,900 yd³"
                  bound="± 1,400"
                  note="correlated error, not averaged away"
                />
                <SpecRow
                  label="Building pad earthwork"
                  value="$21k to $38k"
                  note="grading a pad, not the whole site"
                />
                <SpecRow
                  label="FEMA flood"
                  value="Zone AE"
                  note="12% of site, NFHL effective date shown in report"
                />
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
                Preliminary and uncertified. Not a substitute for a survey
                sealed by a licensed Professional Land Surveyor.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          POSITIONING: the choice a visitor is actually making
          ------------------------------------------------------------
          Every other product in this space sells a stack of toggleable
          layers and leaves the interpreting to you. Naming that
          difference plainly is more persuasive than another feature
          list, and it is a claim we can back: the verdict, the dollar
          figure and the error bounds are all things a layer viewer
          structurally cannot produce.
         ============================================================ */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-2xl">
            <SectionLabel index="04">The difference</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              Ten map layers is not an answer.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.7] text-muted">
              Parcel viewers hand you elevation, soil, flood and wetland
              layers and let you work it out. That is fine if you already
              know how to read them, and useless at eight in the evening
              with twenty listings open.
            </p>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3">
            {[
              [
                "One verdict",
                "Every layer folded into a single word and a single sentence naming the biggest constraint, plus the score behind it. Not a stack of maps to interpret.",
              ],
              [
                "A dollar figure",
                "What it costs to grade a building pad, in dollars and cubic yards. No layer viewer computes this, because it needs the elevation maths, not just a picture of it.",
              ],
              [
                "Error bounds on everything",
                "Every number carries how wrong it could be, and names the dataset and vintage it came from. That is what makes it usable by somebody whose licence is on the line.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="bg-background p-6">
                <h3 className="lp-display text-base text-accent-bright">
                  {title}
                </h3>
                <p className="mt-3 text-[13.5px] leading-[1.6] text-muted">
                  {body}
                </p>
              </div>
            ))}
          </div>

          <p className="lp-reveal mt-6 max-w-2xl text-[13px] leading-relaxed text-muted">
            And the part that matters most: the verdict, the numbers, the
            cost range and the shareable report are the free product, not a
            trial of it.
          </p>
        </div>
      </section>

      {/* ============================================================
          HOW IT WORKS
         ============================================================ */}
      <section id="how-it-works" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-xl">
            <SectionLabel index="05">How it works</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              Three steps, about a minute, no equipment.
            </h2>
          </div>

          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              [
                "Pick the ground",
                "Search an address, then draw the boundary by hand anywhere in the US. In the five pilot counties you can tap a parcel and load its official recorded outline instead.",
              ],
              [
                "The engine reads the land",
                "USGS elevation for slope and buildable ground, National Wetlands Inventory for wetlands and open water, FEMA NFHL for flood zones. All public data, all named in the report.",
              ],
              [
                "You get a decision",
                "A verdict with a factor-by-factor breakdown, an earthwork cost range in dollars and cubic yards, a 3D model of the site, and a link you can send to anyone.",
              ],
            ].map(([title, body], i) => (
              <li key={title} className="lp-reveal border-t border-line pt-4">
                <span className="num text-sm font-semibold tabular-nums text-accent-bright">
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-[14px] leading-[1.65] text-muted">
                  {body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ============================================================
          FEATURES
         ============================================================ */}
      {/* ---- The one panel of daylight ----
           A page that is dark from top to bottom goes flat. One inverted
           section resets the eye and makes the dark read as a choice
           rather than a default. This is the list of what you actually
           get, so it is the section worth the emphasis. */}
      <section className="border-b border-line bg-[#f4f4f0] text-[#111]">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
          <div className="lp-reveal max-w-xl">
            <div className="flex items-baseline gap-3">
              <span className="lp-display text-3xl text-[#0d7a44] sm:text-4xl">
                06
              </span>
              <span className="mb-1 h-px max-w-[3rem] flex-1 bg-[#0d7a44]/40" />
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0d7a44] sm:text-xs">
                In the box
              </span>
            </div>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] text-[#111] sm:text-[2.6rem]">
              Built for the decision, not the demo.
            </h2>
          </div>
          <div className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={Gauge}
              index="01"
              title="Verdict and score"
              body="GO, PROCEED WITH CONDITIONS, or NOT RECOMMENDED, with every point of the score explained in plain language. No black box."
            />
            <FeatureCard
              icon={MapIcon}
              index="02"
              title="Real parcel records"
              body="Official boundaries, acreage and ownership in five pilot counties today (Maricopa AZ, Travis TX, King WA, Mecklenburg NC, Miami-Dade FL). Everywhere else, draw the outline and get the full analysis."
            />
            <FeatureCard
              icon={Waves}
              index="03"
              title="Water, wetland and flood"
              body="National Wetlands Inventory, USGS hydrography and FEMA flood zones, drawn on the map and folded into the verdict. A lake can no longer score as flat, buildable ground."
            />
            <FeatureCard
              icon={Banknote}
              index="04"
              title="Earthwork in dollars"
              body="Cut and fill turned into a cost range for grading a building pad, priced the way earthwork is actually bid: cubic yards, balanced volume moved once."
            />
            <FeatureCard
              icon={Share2}
              index="05"
              title="Reports you can send"
              body="A public link with the site name, county, outline, verdict and every number. Add your own notes, and edit them later. Readers need no account."
            />
            <FeatureCard
              icon={Smartphone}
              index="06"
              title="Made for the truck"
              body="One-thumb controls, a crosshair drawing mode built for fingers, offline-friendly saves, and installable as an app on iPhone and Android."
            />
          </div>
        </div>
      </section>

      {/* ============================================================
          THE LIMITS, STATED FIRST
         ============================================================ */}
      <section className="border-b border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-xl">
            <SectionLabel index="07">What this is not</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              We would rather lose the sale than overstate the number.
            </h2>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <p className="lp-reveal border-t border-line pt-4 text-[13.5px] leading-[1.65] text-muted">
              <span className="mb-1.5 block font-display text-[15px] font-semibold tracking-tight text-foreground">
                Not a legal survey
              </span>
              Nothing here can be recorded, sealed or relied on for a
              boundary dispute. A licensed Professional Land Surveyor does
              that work, and our job is to tell you whether it is worth
              booking one.
            </p>
            <p className="lp-reveal border-t border-line pt-4 text-[13.5px] leading-[1.65] text-muted">
              <span className="mb-1.5 block font-display text-[15px] font-semibold tracking-tight text-foreground">
                As good as the source data
              </span>
              USGS lidar is roughly 0.2 m vertical where it exists, and
              about 5 m from the global fallback. We print which source
              answered, how old it is, and what that means for each
              number, on every report.
            </p>
            <p className="lp-reveal border-t border-line pt-4 text-[13.5px] leading-[1.65] text-muted">
              <span className="mb-1.5 block font-display text-[15px] font-semibold tracking-tight text-foreground">
                Terrain and water, not title
              </span>
              Zoning, easements, septic feasibility, utilities and title
              are outside the score, and the report lists them as not
              checked rather than quietly leaving them out.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================
          FAQ
         ============================================================ */}
      <section id="faq" className="border-b border-line">
        <div className="mx-auto max-w-3xl px-6 py-14 lg:py-20">
          <div className="lp-reveal">
            <SectionLabel index="08">Questions</SectionLabel>
            <h2 className="lp-display mt-6 max-w-[18ch] text-[1.9rem] sm:text-[2.6rem]">
              The things people ask first.
            </h2>
          </div>
          <div className="mt-8">
            <Faq q="Is it really free?">
              Running a survey, reading the verdict and sharing a report
              cost nothing and need no account. The data underneath is
              public federal data, and we would rather have the usage than
              the subscription at this stage.
            </Faq>
            <Faq q="How accurate is it?">
              Elevation comes from USGS 3DEP lidar where it exists, which
              is about 0.2 m vertical, and from a free global source
              (roughly 5 m) elsewhere. Slope and volume carry error bounds
              that include the systematic part of that error, not just the
              part that averages away. It will never reach the few
              centimetres a survey-grade instrument gives you, and we say
              so on every page.
            </Faq>
            <Faq q="Does it work outside the five pilot counties?">
              Yes, everywhere in the United States. What the pilot counties
              add is the official parcel record: tap a property and its
              recorded boundary, acreage and owner load automatically.
              Anywhere else you draw the boundary yourself and every other
              part of the analysis is identical.
            </Faq>
            <Faq q="Can a surveyor use this?">
              That is who it is built for. It answers the go or no-go
              before anyone drives out, and the report names its sources
              and shows its error bounds so a professional can check the
              reasoning instead of trusting it. Surveyors can also log what
              they measured on site, which is how the model gets better.
            </Faq>
            <Faq q="What about my privacy?">
              Surveys run anonymously. Saved surveys stay on your device
              unless you sign in, and a shared report contains only what
              you chose to put in it: the site, the numbers and any notes
              you wrote.
            </Faq>
          </div>
        </div>
      </section>

      {/* ============================================================
          FINAL CTA
         ============================================================ */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center lg:py-24">
        <div className="lp-reveal">
          <h2 className="lp-display text-[2.1rem] sm:text-[3rem]">
            Check a site before you spend a Saturday on it.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            No sign-up. Open the map, draw a boundary or tap a parcel, and
            read the verdict.
          </p>
          <Link
            to="/map"
            className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-4 font-display text-base font-semibold text-black transition-colors hover:bg-accent-bright"
          >
            Open the map
            <ArrowRight
              size={17}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          <p className="mt-4 text-[13px] text-muted">
            No account, no card, no trial timer.
          </p>
        </div>
      </section>

      {/* ---- Sticky phone CTA ----
           Appears only after the hero has scrolled away, so it never
           covers the first screen, and only on phones, where the nav
           CTA is off screen for most of the page. */}
      <div
        className={`pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-3 transition-all duration-300 sm:hidden ${
          pastHero
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        }`}
      >
        <Link
          to="/map"
          className={`pointer-events-auto flex h-14 items-center justify-center gap-2 rounded-2xl bg-accent font-display text-[15px] font-semibold text-black shadow-lg shadow-black/40 ${
            pastHero ? "" : "pointer-events-none"
          }`}
        >
          Survey a site free
          <ArrowRight size={17} />
        </Link>
      </div>

      {/* ============================================================
          FOOTER
         ============================================================ */}
      <footer className="border-t border-line">
        <div className="pb-safe mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <Mark className="text-sm" />
            <nav className="flex flex-wrap items-center justify-center gap-5 text-xs text-muted">
              <Link to="/map" className="transition-colors hover:text-foreground">
                Open the map
              </Link>
              <Link to="/saved" className="transition-colors hover:text-foreground">
                Saved
              </Link>
              <Link to="/photo" className="transition-colors hover:text-foreground">
                Ground Truth
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
            licensed Professional Land Surveyor must prepare and seal any
            legally binding survey. Elevation from USGS 3DEP and
            Open-Elevation, wetlands from USFWS NWI, flood zones from FEMA
            NFHL, imagery from Esri.
          </p>
          <p className="mt-2 text-center text-[11px] text-muted sm:text-left">
            2026 TerraMeasure. Preliminary assessments only.
          </p>
        </div>
      </footer>
    </div>
  );
}
