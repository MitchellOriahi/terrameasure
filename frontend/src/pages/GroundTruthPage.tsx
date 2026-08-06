// pages/GroundTruthPage.tsx
// Ground Truth: the accuracy feedback loop (lives at /photo for URL
// compatibility with the old placeholder).
//
// The idea in two sentences: a surveyor walks a site and logs what they
// ACTUALLY measured next to what TerraMeasure predicted. Every logged
// correction teaches us where our predictions run hot or cold, and that
// growing pile of field data is something no competitor can scrape.
//
// Access rule: this page is pro-facing, so logging requires sign-in,
// but we do NOT hard-redirect anonymous visitors the way the profile
// page does. They see the pitch plus a sign-in card, because the pitch
// itself is the recruitment tool.
//
// Storage: a Supabase table `ground_truth` (see docs/ground_truth_table.sql).
// The table may not exist yet (the owner has to paste the SQL into the
// Supabase dashboard once), so every query here treats "table missing"
// as a calm, explained state, never a crash.

import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Crosshair,
  Loader2,
  LogIn,
  MapPin,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import {
  supabase,
  type GroundTruthRow,
  type SurveyRow,
} from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

/** "2026-08-03" or an ISO timestamp -> "Aug 3, 2026". */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // Date-only strings ("2026-08-05") parse as midnight UTC; format in
    // UTC too so the shown day never shifts backward in western zones.
    timeZone: iso.length <= 10 ? "UTC" : undefined,
  });
}

/** Today as "YYYY-MM-DD" in local time, for the date input default. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Is this Supabase error "the ground_truth table does not exist yet"?
 * Before the owner runs docs/ground_truth_table.sql, PostgREST answers
 * with a "could not find the table ... in the schema cache" message
 * (code PGRST205), or Postgres itself says relation "..." does not
 * exist (code 42P01). Both mean the same calm thing: not set up yet.
 */
function isTableMissing(message: string): boolean {
  return /schema cache|does not exist|PGRST205|42P01/i.test(message);
}

const TABLE_MISSING_NOTE =
  "Ground truth storage is not set up yet. The ground_truth table has " +
  "to be created in Supabase once (docs/ground_truth_table.sql). " +
  "Nothing else on this page is affected.";

/** The go / caution / no-go pill colors, matching the app's verdict
    tokens. Used by both the picker buttons and the history rows. */
const VERDICT_STYLE: Record<string, string> = {
  go: "bg-go/15 text-go border-go/40",
  caution: "bg-caution/15 text-caution border-caution/40",
  "no-go": "bg-nogo/15 text-nogo border-nogo/40",
};

// ------------------------------------------------------------------
// The page
// ------------------------------------------------------------------

export default function GroundTruthPage() {
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // ---- Form state (all strings; parsed on submit) ----
  // Which location the entry is about: "manual" or a saved survey's id.
  const [surveyChoice, setSurveyChoice] = useState<string>("manual");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [slopeText, setSlopeText] = useState("");
  const [elevRangeText, setElevRangeText] = useState("");
  const [fieldVerdict, setFieldVerdict] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [visitedOn, setVisitedOn] = useState<string>(() => todayIso());

  // ---- Submit lifecycle ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // ---- Saved surveys for the picker (same query the profile page runs;
  //      RLS already limits it to the signed-in user's own rows) ----
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
      // No cloud surveys table yet (see docs/supabase_setup.sql)? Then
      // there is simply nothing to pick from, and the form falls back to
      // typing coordinates by hand. That is a missing convenience, not
      // an error worth showing.
      if (error) return [];
      return (data ?? []) as SurveyRow[];
    },
  });
  const surveys = surveysQuery.data ?? [];

  // ---- Past ground-truth entries, newest first ----
  const entriesQuery = useQuery({
    queryKey: ["ground_truth", user?.id],
    enabled: status === "signed-in" && !!user,
    queryFn: async (): Promise<GroundTruthRow[]> => {
      const { data, error } = await supabase
        .from("ground_truth")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as GroundTruthRow[];
    },
  });

  // The saved survey the picker currently points at (if any).
  const chosenSurvey =
    surveyChoice === "manual"
      ? null
      : (surveys.find((s) => String(s.id) === surveyChoice) ?? null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    // ---- Figure out the location ----
    let lat: number | null = null;
    let lon: number | null = null;
    if (chosenSurvey) {
      lat = chosenSurvey.lat;
      lon = chosenSurvey.lon;
    } else {
      lat = parseFloat(latText);
      lon = parseFloat(lonText);
      const latOk = Number.isFinite(lat) && lat >= -90 && lat <= 90;
      const lonOk = Number.isFinite(lon) && lon >= -180 && lon <= 180;
      if (!latOk || !lonOk) {
        setSubmitError(
          "Enter the site's latitude (-90 to 90) and longitude (-180 to 180), or pick a saved survey.",
        );
        return;
      }
    }

    // ---- Optional numbers: blank stays null, junk is rejected ----
    let slope: number | null = null;
    if (slopeText.trim() !== "") {
      slope = parseFloat(slopeText);
      if (!Number.isFinite(slope) || slope < 0 || slope > 90) {
        setSubmitError("Measured slope should be a number of degrees between 0 and 90.");
        return;
      }
    }
    let elevRange: number | null = null;
    if (elevRangeText.trim() !== "") {
      elevRange = parseFloat(elevRangeText);
      if (!Number.isFinite(elevRange) || elevRange < 0) {
        setSubmitError("Elevation range should be a number of feet, 0 or more.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("ground_truth").insert({
        user_id: user.id,
        survey_id: chosenSurvey ? chosenSurvey.id : null,
        lat,
        lon,
        measured_slope_deg: slope,
        measured_elev_range_ft: elevRange,
        field_verdict: fieldVerdict,
        notes: notes.trim() || null,
        visited_on: visitedOn || null,
      });
      if (error) {
        setSubmitError(
          isTableMissing(error.message) ? TABLE_MISSING_NOTE : error.message,
        );
        return;
      }
      // Success: show the thank-you card and refresh the history list.
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ["ground_truth", user.id] });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /** Reset the form for another entry (keeps the visit date). */
  function logAnother() {
    setSubmitted(false);
    setSubmitError(null);
    setSurveyChoice("manual");
    setLatText("");
    setLonText("");
    setSlopeText("");
    setElevRangeText("");
    setFieldVerdict(null);
    setNotes("");
  }

  // Shared input styling (same recipe as the profile page's name box).
  const inputCls =
    "rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm " +
    "text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:outline-none";
  const labelCls = "text-[10px] uppercase tracking-widest text-muted";

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Slim header, same pattern as the profile page */}
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
      </header>

      <main className="panel-scroll flex-1 overflow-y-auto p-6 pb-safe">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {/* ---- The pitch (everyone sees this) ---- */}
          <div className="glass p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-deep">
                <Crosshair className="text-accent-bright" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">
                  Ground Truth
                </h1>
                <p className="text-xs text-muted">The accuracy feedback loop</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Walked a site we pre-screened? Log what you actually measured on
              the ground. TerraMeasure compares it to its prediction and learns
              where the public data runs hot or cold, region by region.
            </p>
          </div>

          {/* ---- Anonymous: soft sign-in card, no redirect ---- */}
          {status === "anonymous" && (
            <div className="glass p-6 text-center">
              <p className="text-sm leading-relaxed text-muted">
                Logging field measurements is tied to your account, so your
                entries stay yours and build your own accuracy history.
              </p>
              <div className="mt-5">
                <Link to="/auth" state={{ from: location.pathname }}>
                  <Button variant="primary" size="sm" tabIndex={-1}>
                    <LogIn size={14} />
                    Sign in to log ground truth
                  </Button>
                </Link>
              </div>
              <p className="mt-3 text-[11px] text-muted">
                Free account. Surveys on the map never need one.
              </p>
            </div>
          )}

          {/* ---- Still checking the stored session ---- */}
          {status === "loading" && (
            <div className="glass flex items-center justify-center gap-2 p-6 text-xs text-muted">
              <Loader2 className="animate-spin" size={14} />
              Checking your session
            </div>
          )}

          {/* ---- Signed in: thank-you state OR the form ---- */}
          {status === "signed-in" && user && submitted && (
            <div className="glass p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-deep">
                <Sparkles className="text-accent-bright" size={22} />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                Logged. Thank you.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Every field correction sharpens future predictions in this
                region. This is data nobody can fake from a desk.
              </p>
              <div className="mt-5">
                <Button variant="primary" size="sm" onClick={logAnother}>
                  Log another visit
                </Button>
              </div>
            </div>
          )}

          {status === "signed-in" && user && !submitted && (
            <form className="glass flex flex-col gap-4 p-6" onSubmit={handleSubmit}>
              <div className="flex items-center gap-2">
                <NotebookPen className="text-accent-bright" size={16} />
                <h2 className="text-sm font-semibold text-foreground">
                  Log a site visit
                </h2>
              </div>

              {/* -- Which site? A saved survey or typed coordinates -- */}
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Site</span>
                <select
                  value={surveyChoice}
                  onChange={(e) => setSurveyChoice(e.target.value)}
                  className={inputCls}
                  aria-label="Pick a saved survey or enter coordinates"
                >
                  <option value="manual">Enter coordinates manually</option>
                  {surveys.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {fmtDate(s.surveyed_at)} · {s.lat.toFixed(4)},{" "}
                      {s.lon.toFixed(4)}
                      {s.score !== null ? ` · score ${Math.round(s.score)}` : ""}
                    </option>
                  ))}
                </select>
                {surveysQuery.isPending && (
                  <span className="text-[11px] text-muted">
                    Loading your saved surveys...
                  </span>
                )}
                {surveysQuery.isSuccess && surveys.length === 0 && (
                  <span className="text-[11px] leading-relaxed text-muted">
                    No saved surveys yet. You can still type the coordinates
                    below, or run and save a survey on the map first.
                  </span>
                )}
              </label>

              {/* Chosen survey: show its location read-only. Manual:
                  two coordinate inputs. */}
              {chosenSurvey ? (
                <p className="num flex items-center gap-1.5 text-[11px] text-muted">
                  <MapPin size={12} className="text-accent" />
                  {chosenSurvey.lat.toFixed(5)}, {chosenSurvey.lon.toFixed(5)}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className={labelCls}>Latitude</span>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={latText}
                      onChange={(e) => setLatText(e.target.value)}
                      placeholder="39.7392"
                      className={inputCls}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelCls}>Longitude</span>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={lonText}
                      onChange={(e) => setLonText(e.target.value)}
                      placeholder="-104.9903"
                      className={inputCls}
                    />
                  </label>
                </div>
              )}

              {/* -- What was measured (both optional) -- */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Avg slope (deg)</span>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={slopeText}
                    onChange={(e) => setSlopeText(e.target.value)}
                    placeholder="Optional"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Elev range (ft)</span>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={elevRangeText}
                    onChange={(e) => setElevRangeText(e.target.value)}
                    placeholder="Optional"
                    className={inputCls}
                  />
                </label>
              </div>

              {/* -- The verdict THEY would give after walking it -- */}
              <div className="flex flex-col gap-1">
                <span className={labelCls}>Your call after walking it</span>
                <div className="flex gap-2">
                  {(["go", "caution", "no-go"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setFieldVerdict(fieldVerdict === v ? null : v)
                      }
                      className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                        fieldVerdict === v
                          ? VERDICT_STYLE[v]
                          : "border-line text-muted hover:text-foreground"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-muted">
                  Optional. Tap again to clear.
                </span>
              </div>

              {/* -- Notes: what the data missed -- */}
              <label className="flex flex-col gap-1">
                <span className={labelCls}>What the data missed</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Drainage, access, rock outcrops, anything the prediction did not see..."
                  className={`${inputCls} resize-y`}
                />
              </label>

              {/* -- Date of the visit -- */}
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Date of visit</span>
                <input
                  type="date"
                  value={visitedOn}
                  max={todayIso()}
                  onChange={(e) => setVisitedOn(e.target.value)}
                  className={inputCls}
                />
              </label>

              {submitError && (
                <p className="flex items-start gap-1.5 text-[11px] leading-snug text-caution">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {submitError}
                </p>
              )}

              {/* type="submit" matters: the shared Button defaults to
                  type="button", which would never fire the form's
                  onSubmit. Passing it explicitly overrides the default. */}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Crosshair size={14} />
                )}
                {submitting ? "Logging..." : "Log ground truth"}
              </Button>
            </form>
          )}

          {/* ---- Past entries (signed in only), newest first ---- */}
          {status === "signed-in" && user && (
            <div className="glass p-6">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Your ground truth log
              </h2>

              {entriesQuery.isPending && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted">
                  <Loader2 className="animate-spin" size={14} />
                  Loading your entries
                </div>
              )}

              {/* Table not created yet: calm explanation, not an error wall */}
              {entriesQuery.isError &&
                isTableMissing(entriesQuery.error.message) && (
                  <p className="py-2 text-xs leading-relaxed text-muted">
                    {TABLE_MISSING_NOTE}
                  </p>
                )}
              {entriesQuery.isError &&
                !isTableMissing(entriesQuery.error.message) && (
                  <p className="py-2 text-xs text-nogo">
                    Could not load your entries. Try again in a moment.
                  </p>
                )}

              {entriesQuery.isSuccess && entriesQuery.data.length === 0 && (
                <p className="py-2 text-xs leading-relaxed text-muted">
                  No entries yet. Your logged site visits will appear here.
                </p>
              )}

              <ul className="flex flex-col">
                {(entriesQuery.data ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="border-b border-line px-1 py-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-foreground">
                        {fmtDate(row.visited_on ?? row.created_at)}
                      </span>
                      {row.field_verdict && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            VERDICT_STYLE[row.field_verdict] ??
                            "border-line text-muted"
                          }`}
                        >
                          {row.field_verdict}
                        </span>
                      )}
                    </div>
                    <p className="num mt-0.5 text-[11px] text-muted">
                      {row.lat !== null && row.lon !== null
                        ? `${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}`
                        : "No coordinates"}
                      {row.measured_slope_deg !== null
                        ? ` · slope ${row.measured_slope_deg} deg`
                        : ""}
                      {row.measured_elev_range_ft !== null
                        ? ` · range ${row.measured_elev_range_ft} ft`
                        : ""}
                    </p>
                    {row.notes && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {row.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
