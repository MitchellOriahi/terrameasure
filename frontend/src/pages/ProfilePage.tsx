// pages/ProfilePage.tsx
// The signed-in person's home: their name (editable), email, saved
// surveys, and the sign-out button.
//
// This is the ONE route with an auth gate: anonymous visitors are
// bounced to /auth (and sent back here after signing in). Everything
// else in the app stays open to everyone.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Loader2,
  LogOut,
  MapPin,
  Pencil,
  Bookmark,
} from "lucide-react";
import { supabase, type SurveyRow } from "@/lib/supabase";
import { loadSavedSurveys } from "@/lib/savedSurveys";
import { useAuthStore } from "@/store/authStore";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/geo";

/** "2026-08-03T18:22:00Z" -> "Aug 3, 2026" */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const refreshName = useAuthStore((s) => s.refreshName);

  // ---- Name editing ----
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // ---- The auth gate (the only one in the app) ----
  // While the first session check runs we show a spinner; once we KNOW
  // the visitor is anonymous, off to /auth with a way back here.
  useEffect(() => {
    if (status === "anonymous") {
      navigate("/auth", { replace: true, state: { from: "/profile" } });
    }
  }, [status, navigate]);

  // ---- Saved surveys, newest first ----
  // Two sources, merged: this DEVICE's saves (always available, no
  // account needed) and the CLOUD copy of saves made while signed in.
  //
  // The cloud half never throws. If the surveys table has not been
  // created in the database yet (see docs/supabase_setup.sql) Supabase
  // answers with an error, and the honest response to that is "show the
  // device list, mention sync is off" rather than a red failure message
  // over work the user can plainly see they saved.
  const surveysQuery = useQuery({
    queryKey: ["surveys", user?.id],
    enabled: status === "signed-in" && !!user,
    queryFn: async (): Promise<{ rows: SurveyRow[]; cloudOk: boolean }> => {
      const { data, error } = await supabase
        .from("surveys")
        .select("*")
        .eq("user_id", user!.id)
        .order("surveyed_at", { ascending: false })
        .limit(50);
      if (error) return { rows: [], cloudOk: false };
      return { rows: (data ?? []) as SurveyRow[], cloudOk: true };
    },
  });

  // The device list is read once per visit; it needs no network at all.
  const deviceSurveys = useMemo(() => loadSavedSurveys(), []);

  /** One row of the merged list, whatever it came from. */
  interface DisplaySurvey {
    key: string;
    lat: number;
    lon: number;
    score: number | null;
    areaAcres: number | null;
    when: string; // ISO
    vertices: { lat: number; lon: number }[] | null;
  }

  const surveys: DisplaySurvey[] = useMemo(() => {
    const rows: DisplaySurvey[] = deviceSurveys.map((s) => ({
      key: s.id,
      lat: s.lat,
      lon: s.lon,
      score: s.score,
      areaAcres: s.areaAcres,
      when: s.savedAt,
      vertices: s.vertices,
    }));
    // Add cloud rows this device does not already have. "Already have"
    // means within about 25 metres of a device row, which is the same
    // near-duplicate rule lib/savedSurveys.ts uses when saving.
    for (const r of surveysQuery.data?.rows ?? []) {
      const dup = rows.some((d) => {
        const dLat = Math.abs(d.lat - r.lat) * 111_320;
        const dLon =
          Math.abs(d.lon - r.lon) * 111_320 * Math.cos((r.lat * Math.PI) / 180);
        return Math.hypot(dLat, dLon) < 25;
      });
      if (!dup) {
        rows.push({
          key: `cloud-${r.id}`,
          lat: r.lat,
          lon: r.lon,
          score: r.score,
          areaAcres: r.area_acres,
          when: r.surveyed_at,
          vertices: null, // cloud rows keep only the summary, not the outline
        });
      }
    }
    return rows.sort((a, b) => (a.when < b.when ? 1 : -1));
  }, [deviceSurveys, surveysQuery.data]);

  async function handleSaveName() {
    if (!user) return;
    const clean = nameDraft.trim();
    if (!clean) {
      setEditing(false);
      return;
    }
    setSavingName(true);
    try {
      // Write the name in TWO places, because either one alone can be
      // unavailable:
      //   1. the profiles table (upsert: update the row if it exists,
      //      create it if the new-account trigger missed this account).
      //      This is the nice, queryable home for it.
      //   2. the account's own metadata, which always exists as part of
      //      the auth service, no table required.
      // The auth store reads the table first and falls back to metadata,
      // so the name sticks even on a database with no profiles table.
      await supabase.from("profiles").upsert({ id: user.id, name: clean });
      await supabase.auth.updateUser({ data: { name: clean } });
      await refreshName();
      setNameSaved(true);
      window.setTimeout(() => setNameSaved(false), 2000);
    } catch {
      // Nothing here is worth an error banner: the name is cosmetic and
      // the next attempt costs one tap.
    } finally {
      setSavingName(false);
      setEditing(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/map", { replace: true });
  }

  /** Tapping a saved survey reopens it. When we still have the drawn
      outline (device saves keep it) the map redraws that shape and
      measures it again; otherwise we simply fly there. */
  function flyToSurvey(row: DisplaySurvey) {
    if (row.vertices && row.vertices.length >= 3) {
      navigate("/map", { state: { reopen: { vertices: row.vertices } } });
    } else {
      navigate("/map", { state: { flyTo: { lat: row.lat, lon: row.lon } } });
    }
  }

  // Still checking the stored session, or mid-bounce to /auth
  if (status !== "signed-in" || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

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

      <main className="panel-scroll flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <header className="border-b border-line pb-6 pt-3">
            <div className="flex items-center gap-3">
              <span className="h-px w-6 bg-accent/60" />
              <span className="tm-label text-accent-bright">Account</span>
            </div>
            <h1 className="tm-display mt-4 text-[2rem] text-foreground sm:text-[2.4rem]">
              Your profile
            </h1>
          </header>

          {/* ---- Identity card ---- */}
          <div className="border border-line bg-surface-2/40 p-6">
            <div className="flex items-center gap-4">
              {/* Initial avatar: first letter of the name, brand green */}
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-deep text-xl font-semibold text-accent-bright">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveName();
                        if (e.key === "Escape") setEditing(false);
                      }}
                      className="h-9 w-full rounded-lg border border-line bg-surface-2/60 px-2.5 text-sm text-foreground outline-none focus:border-accent/60"
                      aria-label="Your name"
                    />
                    <Button
                      variant="primary"
                      size="iconSm"
                      aria-label="Save name"
                      disabled={savingName}
                      onClick={handleSaveName}
                    >
                      {savingName ? (
                        <Loader2 className="animate-spin" size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="tm-display truncate text-2xl text-foreground">
                      {user.name}
                    </h2>
                    {nameSaved ? (
                      <Check className="shrink-0 text-go" size={14} />
                    ) : (
                      <button
                        type="button"
                        aria-label="Edit name"
                        className="shrink-0 text-muted hover:text-foreground"
                        onClick={() => {
                          setNameDraft(user.name);
                          setEditing(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                )}
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut size={14} />
                Sign out
              </Button>
            </div>
          </div>

          {/* ---- Saved surveys ---- */}
          <div className="border border-line bg-surface-2/40 p-6">
            <div className="mb-3 flex items-center gap-2">
              <Bookmark className="text-accent-bright" size={16} />
              <h2 className="tm-label text-foreground/70">
                Saved surveys
              </h2>
              <span className="num ml-auto text-[11px] text-muted">
                {surveys.length}
              </span>
            </div>

            {surveys.length === 0 && (
              <p className="py-2 text-xs leading-relaxed text-muted">
                Nothing saved yet. Run a survey on the map and tap Save to
                keep it here.
              </p>
            )}

            <ul className="flex flex-col">
              {surveys.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => flyToSurvey(row)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface-2/70"
                  >
                    <MapPin className="shrink-0 text-accent" size={16} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">
                        {fmtDate(row.when)}
                        {row.score !== null && (
                          <span className="ml-2 text-xs text-accent-bright">
                            score {fmt(row.score, 0)}
                          </span>
                        )}
                      </span>
                      <span className="num block text-[11px] text-muted">
                        {row.areaAcres !== null
                          ? `${fmt(row.areaAcres, 2)} ac · `
                          : ""}
                        {row.lat.toFixed(4)}, {row.lon.toFixed(4)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Honest note about where these live. Cloud sync is a bonus
                on top of the device list, so we say which one is active
                instead of pretending everything is in the account. */}
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              {surveysQuery.data?.cloudOk
                ? "Saved on this device and synced to your account."
                : "Saved on this device. Account sync is not switched on yet, so these stay in this browser."}{" "}
              <Link to="/saved" className="text-accent-bright hover:underline">
                Manage saved
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
