// lib/authHealth.ts
// "Is the sign-in service actually there?"
//
// Why this exists: signing in with Google is a FULL PAGE REDIRECT. The
// browser leaves our app for the auth host and comes back. If that host
// is unreachable, the person does not see a tidy error inside our app,
// they see the browser's own "this site can't be reached" page, with our
// product nowhere in sight. From the outside that looks like TerraMeasure
// is broken, and there is no way back except the back button.
//
// So before we hand the browser over, we ask the auth service one cheap
// question. If it does not answer, we stay put and say so in plain words.
// The same check runs when the sign-in screen opens, so the page can warn
// people before they type a password that is going nowhere.
//
// This is not security and not a guarantee: a service can die in the
// half second after answering. It is about failing INSIDE the product,
// where we can explain ourselves, instead of outside it.

import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";

/** How long to wait before calling it unreachable. Short on purpose:
    this check sits in front of a button press. */
const PROBE_TIMEOUT_MS = 6000;

/** Remember the answer briefly so opening the page twice in a row does
    not re-probe. Auth outages last minutes, not milliseconds. */
let cached: { ok: boolean; at: number } | null = null;
const CACHE_MS = 30_000;

/**
 * Ask the auth service whether it is alive.
 *
 * The endpoint used (/auth/v1/settings) is public, tiny, and needs no
 * session: it is what the sign-in UI itself reads to know which
 * providers are on. Any answer at all means the service is up; a
 * network error, a DNS failure or a timeout means it is not.
 */
export async function isAuthServiceUp(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.ok;
  }
  let ok = false;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
        : undefined;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON },
      signal,
    });
    // Even a 4xx means something answered, which is all we asked.
    ok = res.status > 0 && res.status < 500;
  } catch {
    // DNS failure, offline, timeout, blocked by an extension: all the
    // same answer from where the user is standing.
    ok = false;
  }
  cached = { ok, at: Date.now() };
  return ok;
}

/** Forget the cached answer (used by a Retry button). */
export function resetAuthHealthCache(): void {
  cached = null;
}
