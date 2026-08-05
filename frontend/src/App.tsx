// App.tsx
// The root of the app: wires up the three "providers" everything else
// depends on, then declares the routes.
//
//   QueryClientProvider : TanStack Query's cache for server calls
//   MapProvider         : lets components far from the map (like the
//                         search box) grab a handle to it by id
//   BrowserRouter       : URL-based navigation between screens

import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MapProvider } from "@vis.gl/react-maplibre";
import { Loader2 } from "lucide-react";
import { MapPage } from "@/pages/MapPage";
import { initAuth } from "@/store/authStore";

// The public shared-report page is lazy-loaded: React only downloads its
// code when someone actually opens a /r/{slug} link, so the map home
// screen's bundle stays lean. Auth and profile get the same treatment;
// most sessions never open them.
const ReportPage = lazy(() => import("@/pages/ReportPage"));
// The marketing landing page at "/". Also lazy: someone opening a direct
// /map link (or the installed PWA, whose start_url is /map) never
// downloads the landing page's code at all.
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const NewsPage = lazy(() => import("@/pages/NewsPage"));
const AuthPage = lazy(() => import("@/pages/AuthPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
// "Your reports" (the share links this device created) and Ground
// Truth (surveyors log real on-site measurements). Both lazy for the
// same reason as the pages above: most sessions stay on the map.
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const GroundTruthPage = lazy(() => import("@/pages/GroundTruthPage"));

// A shared full-screen spinner for the lazy routes above.
function PageSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Loader2 className="animate-spin text-accent" size={28} />
    </div>
  );
}

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
  // Wake up the auth store once: it checks for a stored session and then
  // listens for sign-ins and sign-outs. If anything fails, the store
  // lands on "anonymous" and the app carries on; auth never blocks.
  useEffect(() => {
    initAuth();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MapProvider>
        <BrowserRouter>
          <Routes>
            {/* The front door: what TerraMeasure is and one big CTA */}
            <Route
              path="/"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <LandingPage />
                </Suspense>
              }
            />
            {/* The app itself: the full-screen survey map */}
            <Route path="/map" element={<MapPage />} />
            {/* Public shared report: anyone with the link, no login */}
            <Route
              path="/r/:slug"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <ReportPage />
                </Suspense>
              }
            />
            {/* Your reports: the share links this device has created */}
            <Route
              path="/reports"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <ReportsPage />
                </Suspense>
              }
            />
            {/* Ground Truth: log real on-site measurements against our
                predictions. The path stays /photo so old links and the
                nav keep working. */}
            <Route
              path="/photo"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <GroundTruthPage />
                </Suspense>
              }
            />
            {/* TerraIntel: land-relevant news (ReliefWeb + USGS feeds) */}
            <Route
              path="/news"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <NewsPage />
                </Suspense>
              }
            />
            {/* Profile: the one route with an auth gate (it bounces
                anonymous visitors to /auth itself) */}
            <Route
              path="/profile"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <ProfilePage />
                </Suspense>
              }
            />
            {/* Sign in / sign up. Always optional; the map never needs it */}
            <Route
              path="/auth"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <AuthPage />
                </Suspense>
              }
            />
            {/* Anything unknown redirects to the map. Why the map and
                not the landing page? The whole app used to live at every
                path (the old catch-all rendered the map), so any stale
                bookmark or old link is almost certainly a map link.
                "replace" keeps the bad URL out of browser history. */}
            <Route path="*" element={<Navigate to="/map" replace />} />
          </Routes>
        </BrowserRouter>
      </MapProvider>
    </QueryClientProvider>
  );
}
