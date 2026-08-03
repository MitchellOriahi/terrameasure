// App.tsx
// The root of the app: wires up the three "providers" everything else
// depends on, then declares the routes.
//
//   QueryClientProvider : TanStack Query's cache for server calls
//   MapProvider         : lets components far from the map (like the
//                         search box) grab a handle to it by id
//   BrowserRouter       : URL-based navigation between screens

import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MapProvider } from "@vis.gl/react-maplibre";
import {
  FileText,
  Crosshair,
  Newspaper,
  User,
  KeyRound,
  Loader2,
} from "lucide-react";
import { MapPage } from "@/pages/MapPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";

// The public shared-report page is lazy-loaded: React only downloads its
// code when someone actually opens a /r/{slug} link, so the map home
// screen's bundle stays lean.
const ReportPage = lazy(() => import("@/pages/ReportPage"));

// One QueryClient for the whole app. Surveys are expensive (up to 50s on
// a cold start), so never auto-retry them; the user gets an explicit
// "Try again" button instead.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MapProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<MapPage />} />
            {/* Public shared report: anyone with the link, no login */}
            <Route
              path="/r/:slug"
              element={
                <Suspense
                  fallback={
                    <div className="flex h-dvh items-center justify-center bg-background">
                      <Loader2
                        className="animate-spin text-accent"
                        size={28}
                      />
                    </div>
                  }
                >
                  <ReportPage />
                </Suspense>
              }
            />
            <Route
              path="/reports"
              element={
                <PlaceholderPage
                  title="Reports"
                  blurb="Shareable PDF site reports built from your surveys: verdict, measurements with error bounds, maps and contours."
                  icon={FileText}
                />
              }
            />
            <Route
              path="/photo"
              element={
                <PlaceholderPage
                  title="Ground Truth"
                  blurb="Log real on-site measurements against TerraMeasure predictions. Coming soon."
                  icon={Crosshair}
                />
              }
            />
            <Route
              path="/news"
              element={
                <PlaceholderPage
                  title="News"
                  blurb="Land-intelligence headlines for your saved areas: zoning changes, listings, and local development activity."
                  icon={Newspaper}
                />
              }
            />
            <Route
              path="/profile"
              element={
                <PlaceholderPage
                  title="Profile"
                  blurb="Your saved sites, survey history, and preferences, synced across devices."
                  icon={User}
                />
              }
            />
            <Route
              path="/auth"
              element={
                <PlaceholderPage
                  title="Sign in"
                  blurb="Accounts return here soon (Supabase email and Google sign-in). The map works fully without an account."
                  icon={KeyRound}
                />
              }
            />
            {/* Anything unknown goes back to the map */}
            <Route path="*" element={<MapPage />} />
          </Routes>
        </BrowserRouter>
      </MapProvider>
    </QueryClientProvider>
  );
}
