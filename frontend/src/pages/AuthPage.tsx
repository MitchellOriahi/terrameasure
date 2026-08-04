// pages/AuthPage.tsx
// Sign in / sign up. The ONLY screen that ever asks for credentials,
// and per the golden rule it is always optional: the map and surveys
// work fully anonymously. People land here for exactly two reasons:
// they tapped Save on a survey, or they opened their profile.
//
// Three visible modes on one card:
//   signin  : email + password (default)
//   signup  : email + password, creates the account
//   confirm : "check your email" after a sign-up when the project has
//             email confirmation turned on (with a Resend button)
//
// Google sign-in is a full-page redirect (the browser leaves for Google
// and comes back), so right before it we stash the map camera and any
// half-drawn shape in sessionStorage (see lib/mapState.ts) plus the
// path to return to; supabase-js picks the session out of the URL when
// we land back here, and this page then routes home.

import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  Mail,
  AlertTriangle,
  Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { saveDraft } from "@/lib/mapState";
import { useAuthStore } from "@/store/authStore";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";

// Where to send the user after a successful sign-in. A normal in-app
// visit carries it in router state; the Google round trip loses router
// state (full page reload), so we also stash it in sessionStorage.
const RETURN_KEY = "tm_auth_return_to";

type Mode = "signin" | "signup" | "confirm";

/** The Google "G" logo, inlined so no external image is fetched. */
function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.4a7.2 7.2 0 0 1 0-4.7v-3H1.3a12 12 0 0 0 0 10.8l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c1-2.8 3.6-4.9 6.7-4.9z"
      />
    </svg>
  );
}

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  // The path to go back to after signing in. Router state wins; the
  // sessionStorage copy covers the OAuth reload; the map is the fallback
  // (a fresh sign-in should land in the app, not on the marketing page).
  const fromState = (location.state as { from?: string } | null)?.from;

  function returnPath(): string {
    if (fromState) return fromState;
    try {
      return sessionStorage.getItem(RETURN_KEY) ?? "/map";
    } catch {
      return "/map";
    }
  }

  // Already signed in (or just became signed in, including the moment
  // the Google redirect lands back here)? Leave immediately.
  useEffect(() => {
    if (status === "signed-in") {
      const to = returnPath();
      try {
        sessionStorage.removeItem(RETURN_KEY);
      } catch {
        // Storage blocked: nothing to clean up.
      }
      navigate(to, { replace: true });
    }
    // returnPath reads fresh values each call; no need to depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, navigate]);

  // ---- Email + password submit (covers both sign-in and sign-up) ----
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (err) setError(err.message);
        // Success: the auth store's listener fires and the effect above
        // navigates away. Nothing more to do here.
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (err) {
          setError(err.message);
        } else if (!data.session) {
          // No session yet means the project requires email
          // confirmation: show the "check your email" card.
          setMode("confirm");
        }
      }
    } catch {
      setError("Could not reach the sign-in service. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  // ---- Google (full-page redirect out and back) ----
  async function handleGoogle() {
    setError(null);
    // Stash everything the reload would lose: the drawn shape and where
    // to return to. (The camera is stashed continuously by MapView.)
    saveDraft();
    try {
      sessionStorage.setItem(RETURN_KEY, fromState ?? "/map");
    } catch {
      // Storage blocked: the user still signs in, just lands on the map.
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Come back to this /auth page; the effect above then routes on.
        redirectTo: window.location.origin + "/auth",
      },
    });
    if (err) setError(err.message);
  }

  // ---- Resend the confirmation email ----
  async function handleResend() {
    try {
      await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
      });
      setResent(true);
      window.setTimeout(() => setResent(false), 4000);
    } catch {
      setError("Could not resend the email. Try again in a moment.");
    }
  }

  const inputClass =
    "h-11 w-full rounded-xl border border-line bg-surface-2/60 px-3.5 " +
    "text-sm text-foreground placeholder:text-muted outline-none " +
    "focus:border-accent/60 focus:ring-2 focus:ring-accent/30";

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Slim header, same skeleton as every non-map screen */}
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="glass w-full max-w-md p-8">
          {mode === "confirm" ? (
            /* ---- "Check your email" after sign-up ---- */
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-deep">
                <Mail className="text-accent-bright" size={26} />
              </div>
              <h1 className="text-xl font-semibold text-foreground">
                Check your email
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                We sent a confirmation link to{" "}
                <span className="text-foreground">{email}</span>. Open it to
                activate your account, then come back and sign in.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Button variant="primary" size="md" onClick={handleResend}>
                  {resent ? <Check size={16} /> : <Mail size={16} />}
                  {resent ? "Sent again" : "Resend email"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMode("signin")}
                >
                  Back to sign in
                </Button>
              </div>
            </div>
          ) : (
            /* ---- Sign in / sign up card ---- */
            <>
              <div className="mb-5 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-deep">
                  <KeyRound className="text-accent-bright" size={26} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
                </h1>
                <p className="mt-1 text-sm text-muted">
                  {mode === "signin"
                    ? "Sign in to save surveys and sync across devices."
                    : "An account saves your surveys. Surveying itself never needs one."}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  aria-label="Email"
                />
                <input
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  aria-label="Password"
                />

                {error && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-snug text-nogo">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {error}
                  </p>
                )}

                {/* type="submit" so clicking it submits the form (the
                    shared Button defaults to type="button") */}
                <Button variant="primary" size="md" type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" size={16} />}
                  {mode === "signin" ? "Sign in" : "Sign up"}
                </Button>
              </form>

              {/* Divider */}
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  or
                </span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <Button
                variant="glass"
                size="md"
                className="w-full"
                onClick={handleGoogle}
              >
                <GoogleLogo />
                Continue with Google
              </Button>

              {/* Flip between sign in and sign up */}
              <p className="mt-5 text-center text-xs text-muted">
                {mode === "signin" ? (
                  <>
                    New here?{" "}
                    <button
                      type="button"
                      className="text-accent-bright hover:underline"
                      onClick={() => {
                        setMode("signup");
                        setError(null);
                      }}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="text-accent-bright hover:underline"
                      onClick={() => {
                        setMode("signin");
                        setError(null);
                      }}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </>
          )}

          <p className="mt-5 border-t border-line pt-3 text-center text-[10px] leading-relaxed text-muted">
            The map and surveys always work without an account.
          </p>
        </div>
      </main>
    </div>
  );
}
