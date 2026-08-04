// pages/NewsPage.tsx
// TerraIntel: land-relevant news at /news. One scrollable column with
// two sections, each backed by its own TanStack Query so one source
// failing never hides the other:
//
//   "Disasters and relief" : ReliefWeb (UN OCHA) reports
//   "Earthquakes"          : USGS quake feed
//
// A location filter (country / state / city) narrows both sources and
// is saved to localStorage so it survives reloads and interops with
// the old app's TerraIntel page.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import {
  COUNTRY_LIST,
  EMPTY_LOCATION,
  fetchEarthquakeNews,
  fetchReliefWebNews,
  loadNewsLocation,
  locationLabel,
  relativeTime,
  saveNewsLocation,
  type NewsItem,
  type NewsLocation,
} from "@/lib/news";

// News goes stale slowly; five minutes of cache keeps navigation snappy
// without hammering the public APIs.
const STALE_MS = 5 * 60 * 1000;

// Shared input styling for the select and text fields in the filter card
const fieldClass =
  "h-9 rounded-lg border border-line bg-surface-2 px-3 text-sm text-foreground " +
  "outline-none placeholder:text-muted/70 focus:border-accent/60";

export default function NewsPage() {
  const queryClient = useQueryClient();

  // "applied" drives the actual queries; "draft" is what the inputs
  // show. Nothing fetches until the user presses Apply.
  const [applied, setApplied] = useState<NewsLocation>(loadNewsLocation);
  const [draft, setDraft] = useState<NewsLocation>(applied);

  // One query per source. The applied location is part of the query key,
  // so applying a new filter automatically fetches fresh results.
  const relief = useQuery({
    queryKey: ["news", "reliefweb", applied],
    queryFn: () => fetchReliefWebNews(applied),
    staleTime: STALE_MS,
    retry: 1,
  });
  const quakes = useQuery({
    queryKey: ["news", "usgs", applied],
    queryFn: () => fetchEarthquakeNews(applied),
    staleTime: STALE_MS,
    retry: 1,
  });

  function applyFilter() {
    const next: NewsLocation = {
      country: draft.country.trim(),
      state: draft.state.trim(),
      city: draft.city.trim(),
    };
    saveNewsLocation(next);
    setApplied(next);
  }

  function clearFilter() {
    saveNewsLocation(EMPTY_LOCATION);
    setDraft(EMPTY_LOCATION);
    setApplied(EMPTY_LOCATION);
  }

  function refreshAll() {
    // Marks both feeds stale and refetches them right away
    void queryClient.invalidateQueries({ queryKey: ["news"] });
  }

  const refreshing = relief.isFetching || quakes.isFetching;
  const activeLabel = locationLabel(applied);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Slim header: back to the map, wordmark, refresh */}
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={refreshAll} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      {/* Single scrollable column, phone-first width */}
      <main className="panel-scroll flex-1 overflow-y-auto">
        <div className="pb-safe mx-auto w-full max-w-2xl px-4 pb-10 pt-6">
          <h1 className="text-xl font-semibold text-foreground">TerraIntel</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Land-relevant events: disasters, seismic activity, and ground
            conditions where you work.
          </p>

          {/* Location filter card */}
          <div className="glass mt-5 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
              <MapPin size={13} className="text-accent-bright" />
              Location filter
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <select
                aria-label="Country"
                className={`${fieldClass} sm:max-w-52`}
                value={draft.country}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              >
                <option value="">All countries</option>
                {COUNTRY_LIST.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className={`${fieldClass} sm:w-44`}
                placeholder="State or region (optional)"
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              />
              <input
                type="text"
                className={`${fieldClass} sm:w-44`}
                placeholder="City or town (optional)"
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={applyFilter}>
                  Apply
                </Button>
                <Button variant="ghost" size="sm" onClick={clearFilter}>
                  Clear
                </Button>
              </div>
            </div>
            {activeLabel && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-deep px-3 py-1 text-xs font-medium text-accent-bright">
                <MapPin size={11} />
                {activeLabel}
              </div>
            )}
          </div>

          {/* Section 1: ReliefWeb disaster and relief reports */}
          <NewsSection
            title="Disasters and relief"
            sourceName="ReliefWeb"
            query={relief}
          />

          {/* Section 2: USGS earthquakes */}
          <NewsSection title="Earthquakes" sourceName="USGS" query={quakes} />

          {/* Same source-honesty promise as the old TerraIntel page */}
          <p className="mt-8 text-xs leading-relaxed text-muted/80">
            Every item links directly to its original source (ReliefWeb, a UN
            OCHA service, and the U.S. Geological Survey). TerraMeasure does
            not generate or edit news content.
          </p>
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------
// One titled section: skeletons while loading, an honest error card if
// the source is down, an empty note, or the list of story cards.
// ------------------------------------------------------------------
interface SectionQuery {
  data?: NewsItem[];
  isPending: boolean;
  isError: boolean;
}

function NewsSection({
  title,
  sourceName,
  query,
}: {
  title: string;
  sourceName: string;
  query: SectionQuery;
}) {
  return (
    <section className="mt-7">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {query.isPending ? (
          // Three shimmering placeholder cards while the feed loads
          [0, 1, 2].map((i) => (
            <div key={i} className="glass h-24 animate-pulse p-4" />
          ))
        ) : query.isError ? (
          <div className="glass border-nogo/30 p-4 text-sm text-muted">
            <span className="font-medium text-nogo">
              {sourceName} unavailable.
            </span>{" "}
            The feed did not respond. Try Refresh in a moment.
          </div>
        ) : !query.data || query.data.length === 0 ? (
          <div className="glass p-4 text-sm text-muted">
            No recent items from {sourceName} for this filter.
          </div>
        ) : (
          query.data.map((item) => <NewsCard key={item.id} item={item} />)
        )}
      </div>
    </section>
  );
}

// One glass story card. The whole card is a link that opens the
// original source in a new tab (with the standard security attrs).
function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="glass block p-4 transition-colors hover:bg-surface-2/90"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-accent/30 bg-accent-deep px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-bright">
          {item.source}
        </span>
        <span className="num text-xs text-muted">
          {item.timeMs > 0 ? relativeTime(item.timeMs) : "date unknown"}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">
        {item.title}
      </p>
      {item.summary && (
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">
          {item.summary}
        </p>
      )}
      <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent-bright">
        Read at {item.source}
        <ExternalLink size={11} />
      </span>
    </a>
  );
}
