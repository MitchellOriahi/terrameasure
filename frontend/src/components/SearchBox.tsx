// components/SearchBox.tsx
// Address and place search. Types flow like this:
//   keystrokes -> debounced query string -> TanStack Query calls the
//   backend /geocode proxy -> results dropdown -> click flies the map.
//
// "Debounced" means we wait until you pause typing (350ms) before firing
// a network request, instead of one request per keystroke. TanStack Query
// then caches each query string, so backspacing is instant.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMap } from "@vis.gl/react-maplibre";
import { Search, Loader2 } from "lucide-react";
import { geocode, type GeocodeResult } from "@/lib/api";
import { safeFlyTo } from "@/lib/mapCamera";

export function SearchBox() {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // The map lives elsewhere in the tree; MapProvider + the map's id
  // ("main") let any component grab a handle to it.
  const { main: map } = useMap();

  // Debounce: push `text` into `debounced` after a 350ms pause.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text.trim()), 350);
    return () => window.clearTimeout(t);
  }, [text]);

  // Only search once there is something meaningful to search for.
  const { data, isFetching, error } = useQuery({
    queryKey: ["geocode", debounced],
    queryFn: () => geocode(debounced),
    enabled: debounced.length >= 3,
    staleTime: 5 * 60 * 1000, // same text within 5 min = no refetch
  });

  // Close the dropdown when clicking anywhere else on the page.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function flyTo(r: GeocodeResult) {
    setOpen(false);
    setText(r.display_name.split(",")[0]);
    // Nominatim sends coordinates as strings; convert before flying.
    // safeFlyTo animates on a flat map but jumps instantly when 3D
    // terrain is on (animated moves + terrain = black screen bug).
    safeFlyTo(map, {
      center: [parseFloat(r.lon), parseFloat(r.lat)],
      zoom: 15,
      duration: 2200,
      essential: true,
    });
  }

  const results = data ?? [];

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="glass flex h-11 items-center gap-2 px-3">
        {isFetching ? (
          <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Search size={16} className="shrink-0 text-muted" />
        )}
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search address or place"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          aria-label="Search address or place"
        />
      </div>

      {/* Results dropdown */}
      {open && debounced.length >= 3 && (
        <div className="glass absolute inset-x-0 top-13 z-30 max-h-72 overflow-y-auto p-1">
          {error && (
            <p className="px-3 py-2 text-xs text-nogo">
              Search failed: {(error as Error).message}
            </p>
          )}
          {!error && !isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">
              No places found for "{debounced}".
            </p>
          )}
          {results.map((r) => (
            <button
              key={r.place_id}
              type="button"
              onClick={() => flyTo(r)}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-2/80"
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
