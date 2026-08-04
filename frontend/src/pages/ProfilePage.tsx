// pages/ProfilePage.tsx
// The signed-in person's home: their name (editable), email, saved
// surveys, and the sign-out button.
//
// This is the ONE route with an auth gate: anonymous visitors are
// bounced to /auth (and sent back here after signing in). Everything
// else in the app stays open to everyone.

import { useEffect, useState } from "react";
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
  // RLS on the surveys table means this query can only ever see the
  // signed-in user's own rows; the user_id filter is belt and braces.
  const surveysQuery = useQuery({
    queryKey: ["surveys", user?.id],
    enabled: status === "signed-in" && !!user,
    queryFn: async (): Promise<SurveyRow[]> => {
      const { data, error } = await supabase
        .from("surveys")
        .select("*")
        .eq("user_id", user!.id)
        .order("surveyed_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as SurveyRow[];
    },
  });

  async function handleSaveName() {
    if (!user) return;
    const clean = nameDraft.trim();
    if (!clean) {
      setEditing(false);
      return;
    }
    setSavingName(true);
    try {
      // upsert: update the profile row if it exists, create it if the
      // handle_new_user trigger somehow missed this account.
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, name: clean });
      if (!error) {
        await refreshName();
        setNameSaved(true);
        window.setTimeout(() => setNameSaved(false), 2000);
      }
    } finally {
      setSavingName(false);
      setEditing(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/map", { replace: true });
  }

  /** Tapping a saved survey flies the map to it: we navigate to the map
      screen and hand MapPage the coordinates through router state. */
  function flyToSurvey(row: SurveyRow) {
    navigate("/map", { state: { flyTo: { lat: row.lat, lon: row.lon } } });
  }

  // Still checking the stored session, or mid-bounce to /auth
  if (status !== "signed-in" || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  const surveys = surveysQuery.data ?? [];

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
          {/* ---- Identity card ---- */}
          <div className="glass p-6">
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
                    <h1 className="truncate text-lg font-semibold text-foreground">
                      {user.name}
                    </h1>
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
          <div className="glass p-6">
            <div className="mb-3 flex items-center gap-2">
              <Bookmark className="text-accent-bright" size={16} />
              <h2 className="text-sm font-semibold text-foreground">
                Saved surveys
              </h2>
              {surveysQuery.isSuccess && (
                <span className="ml-auto text-[11px] text-muted">
                  {surveys.length}
                </span>
              )}
            </div>

            {surveysQuery.isPending && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted">
                <Loader2 className="animate-spin" size={14} />
                Loading your surveys
              </div>
            )}

            {surveysQuery.isError && (
              <p className="py-2 text-xs text-nogo">
                Could not load your surveys. Pull up the map and try again in
                a moment.
              </p>
            )}

            {surveysQuery.isSuccess && surveys.length === 0 && (
              <p className="py-2 text-xs leading-relaxed text-muted">
                Nothing saved yet. Run a survey on the map and tap Save to
                keep it here.
              </p>
            )}

            <ul className="flex flex-col">
              {surveys.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => flyToSurvey(row)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface-2/70"
                  >
                    <MapPin className="shrink-0 text-accent" size={16} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">
                        {fmtDate(row.surveyed_at)}
                        {row.score !== null && (
                          <span className="ml-2 text-xs text-accent-bright">
                            score {fmt(row.score, 0)}
                          </span>
                        )}
                      </span>
                      <span className="num block text-[11px] text-muted">
                        {row.area_acres !== null
                          ? `${fmt(row.area_acres, 2)} ac · `
                          : ""}
                        {row.lat.toFixed(4)}, {row.lon.toFixed(4)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
