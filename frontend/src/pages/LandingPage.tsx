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

/** A small section label: a hairline, then mono capitals. Used instead
    of the usual centered eyebrow pill, which every SaaS page has. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-8 bg-accent/60" />
      <span className="num text-[10px] uppercase tracking-[0.22em] text-accent-bright">
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
        <span className="block text-xs text-foreground/90">{label}</span>
        {note && <span className="block text-[10px] text-muted">{note}</span>}
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
  title,
  body,
}: {
  icon: typeof Gauge;
  title: string;
  body: string;
}) {
  return (
    <div className="lp-reveal flex gap-3 border-t border-line pt-4">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-deep text-accent-bright">
        <Icon size={16} />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

/** One question in the FAQ. Uses the browser's own disclosure element,
    so it works with no JavaScript and is keyboard accessible for free. */
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
        {q}
        <ChevronDown
          size={16}
          className="shrink-0 text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-2 text-xs leading-relaxed text-muted">{children}</div>
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

  // The hero's headline counts up the acres it just measured. Tiny
  // touch, but it makes the page feel like an instrument rather than a
  // brochure. Reduced-motion users get the final number immediately.
  const [demoOpen, setDemoOpen] = useState(false);

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
              className="hidden rounded-lg px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <a
              href="#faq"
              className="hidden rounded-lg px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              FAQ
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
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-black transition-colors hover:bg-accent-bright sm:h-9"
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
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-14 pt-14 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14 lg:pb-20 lg:pt-20">
          {/* ---- Left: the promise ---- */}
          <div>
            <SectionLabel>Site pre-screen, United States</SectionLabel>
            {/* No manual line break. A hard <br> at this size stranded
                the word "is" on a line of its own at 1440px wide; a max
                width lets the browser break it sensibly at every size. */}
            <h1 className="mt-5 max-w-[15ch] text-[2.1rem] font-semibold leading-[1.06] tracking-tight sm:text-5xl">
              Know whether the land is worth the drive.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
              Draw any boundary in the country. TerraMeasure reads federal
              elevation, wetland and flood data and answers the question
              that comes first: build here, or keep looking. Every number
              carries its error bound.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/map"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 text-sm font-semibold text-black transition-colors hover:bg-accent-bright"
              >
                Open the map
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-line bg-surface/70 px-7 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                See what comes back
              </a>
            </div>

          </div>

          {/* ---- Right: the live tool ---- */}
          <div className="lp-reveal lp-in">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="num text-[10px] uppercase tracking-[0.2em] text-muted">
                Live, right here
              </span>
              <span className="text-[10px] text-muted">
                real satellite imagery
              </span>
            </div>
            <DemoMeasureMap />
          </div>

          {/* The spec line: what it costs, what it runs on, how long it
              takes. Full width under the hero so that on a phone the
              live demo comes straight after the buttons, and on desktop
              it reads as a footer to the whole section. */}
          <dl className="num grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-center lg:col-span-2">
            {[
              ["$0", "to run a survey"],
              ["3", "federal datasets"],
              ["60s", "typical answer"],
            ].map(([v, k]) => (
              <div key={k} className="bg-background px-2 py-3">
                <dt className="text-lg font-semibold text-foreground">{v}</dt>
                <dd className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
                  {k}
                </dd>
              </div>
            ))}
          </dl>
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
            <SectionLabel>What the engine actually sees</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              A photo shows you trees. This shows you the ground.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Every measurement in TerraMeasure comes off an elevation
              grid: a block of ground heights from USGS lidar, one number
              per square metre where the coverage is good. Area is
              counting cells, slope is how fast the numbers change, cut
              and fill is comparing two grids. That is the whole trick,
              and it is why the answers are arithmetic instead of
              opinion.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
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
            <SectionLabel>What comes back</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              One verdict, and the receipts behind it.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              The answer is a single word, because that is the decision
              you are making. Everything under it exists to let a
              professional check the word: which factor moved the score,
              which federal dataset said so, how current that data is,
              and how wrong each number could be.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Share it as a link and the person who opens it sees the
              same page, with no login, on any phone.
            </p>
          </div>

          {/* The example report card */}
          <div className="lp-reveal">
            <div className="rounded-2xl border border-line bg-surface/60 p-4">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
                Example report
              </div>
              <div className="mt-2 rounded-xl border border-caution/30 bg-caution/10 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold text-caution">
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
          HOW IT WORKS
         ============================================================ */}
      <section id="how-it-works" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-xl">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
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
                <span className="num text-[11px] text-accent-bright">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
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
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
          <div className="lp-reveal max-w-xl">
            <SectionLabel>In the box</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for the decision, not the demo.
            </h2>
          </div>
          <div className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={Gauge}
              title="Verdict and score"
              body="GO, PROCEED WITH CONDITIONS, or NOT RECOMMENDED, with every point of the score explained in plain language. No black box."
            />
            <FeatureCard
              icon={MapIcon}
              title="Real parcel records"
              body="Official boundaries, acreage and ownership in five pilot counties today (Maricopa AZ, Travis TX, King WA, Mecklenburg NC, Miami-Dade FL). Everywhere else, draw the outline and get the full analysis."
            />
            <FeatureCard
              icon={Waves}
              title="Water, wetland and flood"
              body="National Wetlands Inventory, USGS hydrography and FEMA flood zones, drawn on the map and folded into the verdict. A lake can no longer score as flat, buildable ground."
            />
            <FeatureCard
              icon={Banknote}
              title="Earthwork in dollars"
              body="Cut and fill turned into a cost range for grading a building pad, priced the way earthwork is actually bid: cubic yards, balanced volume moved once."
            />
            <FeatureCard
              icon={Share2}
              title="Reports you can send"
              body="A public link with the site name, county, outline, verdict and every number. Add your own notes, and edit them later. Readers need no account."
            />
            <FeatureCard
              icon={Smartphone}
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
            <SectionLabel>What this is not</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              We would rather lose the sale than overstate the number.
            </h2>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <p className="lp-reveal border-t border-line pt-4 text-xs leading-relaxed text-muted">
              <span className="block text-sm font-semibold text-foreground">
                Not a legal survey
              </span>
              Nothing here can be recorded, sealed or relied on for a
              boundary dispute. A licensed Professional Land Surveyor does
              that work, and our job is to tell you whether it is worth
              booking one.
            </p>
            <p className="lp-reveal border-t border-line pt-4 text-xs leading-relaxed text-muted">
              <span className="block text-sm font-semibold text-foreground">
                As good as the source data
              </span>
              USGS lidar is roughly 0.2 m vertical where it exists, and
              about 5 m from the global fallback. We print which source
              answered, how old it is, and what that means for each
              number, on every report.
            </p>
            <p className="lp-reveal border-t border-line pt-4 text-xs leading-relaxed text-muted">
              <span className="block text-sm font-semibold text-foreground">
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
            <SectionLabel>Questions</SectionLabel>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
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
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Check a site before you spend a Saturday on it.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            No sign-up. Open the map, draw a boundary or tap a parcel, and
            read the verdict.
          </p>
          <Link
            to="/map"
            className="group mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-8 text-sm font-semibold text-black transition-colors hover:bg-accent-bright"
            onClick={() => setDemoOpen(false)}
          >
            Open the map
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          {/* demoOpen exists so the CTA can also close anything the page
              opened; kept trivial on purpose. */}
          {demoOpen && <span className="sr-only">demo open</span>}
        </div>
      </section>

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
