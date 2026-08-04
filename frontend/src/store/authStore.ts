// store/authStore.ts
// Who is signed in (if anyone), as a small Zustand store.
//
// Kept separate from appStore on purpose: map/survey state and account
// state never need each other, and this file makes the app's most
// important auth rule easy to enforce in one place:
//
//   AUTH NEVER BLOCKS THE MAP OR SURVEYS.
//
// If anything here fails (network down, expired session, Supabase
// hiccup) we degrade silently to "anonymous" and the app keeps working.
// Signing in only unlocks Save and the profile page.

import { create } from "zustand";
import { supabase } from "@/lib/supabase";

/** The signed-in person, or null when anonymous. */
export interface AuthUser {
  id: string;
  email: string;
  /** Display name from the profiles table (falls back to the part of
      the email before the @). */
  name: string;
}

/** "loading" only during the very first session check at app start. */
export type AuthStatus = "loading" | "signed-in" | "anonymous";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Re-read the display name from the profiles table (called after
      the profile page saves an edit, so the TopBar initial updates). */
  refreshName: () => Promise<void>;
  /** Sign out everywhere in the app. Always lands on "anonymous". */
  signOut: () => Promise<void>;
}

// Turn a raw Supabase user into our small AuthUser, looking up the
// friendly display name in the profiles table. Any failure just falls
// back to something reasonable; never throws.
async function toAuthUser(raw: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): Promise<AuthUser> {
  const email = raw.email ?? "";
  let name = "";
  try {
    const { data } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", raw.id)
      .single();
    if (data?.name) name = data.name as string;
  } catch {
    // Profile row missing or unreachable: fall through to the fallbacks.
  }
  if (!name && typeof raw.user_metadata?.name === "string") {
    name = raw.user_metadata.name;
  }
  if (!name && email) name = email.split("@")[0];
  return { id: raw.id, email, name: name || "there" };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,

  refreshName: async () => {
    const current = get().user;
    if (!current) return;
    const fresh = await toAuthUser({ id: current.id, email: current.email });
    set({ user: fresh });
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Even if the network call fails, treat the user as signed out
      // locally; supabase-js clears its stored session either way.
    }
    set({ status: "anonymous", user: null });
  },
}));

// ------------------------------------------------------------------
// One-time startup: check for a stored session, then keep listening
// for sign-ins and sign-outs. App.tsx calls this once on mount.
// ------------------------------------------------------------------
let initialized = false;

export function initAuth(): void {
  if (initialized) return; // React StrictMode mounts twice in dev
  initialized = true;

  // 1) The stored session (localStorage), refreshed silently by
  //    supabase-js. If this fails for ANY reason: anonymous, no fuss.
  supabase.auth
    .getSession()
    .then(async ({ data }) => {
      const raw = data.session?.user;
      if (raw) {
        useAuthStore.setState({
          status: "signed-in",
          user: await toAuthUser(raw),
        });
      } else {
        useAuthStore.setState({ status: "anonymous", user: null });
      }
    })
    .catch(() => {
      useAuthStore.setState({ status: "anonymous", user: null });
    });

  // 2) Live updates: fires after email/password sign-in, after the
  //    Google OAuth redirect lands back on our page, and on sign-out.
  supabase.auth.onAuthStateChange((_event, session) => {
    const raw = session?.user;
    if (raw) {
      // Set the basics immediately, then fill in the profile name.
      // (The listener itself must not await Supabase calls: supabase-js
      // holds an internal lock while it runs, so awaiting a query here
      // can deadlock. A detached follow-up avoids that.)
      useAuthStore.setState({
        status: "signed-in",
        user: {
          id: raw.id,
          email: raw.email ?? "",
          name: raw.email ? raw.email.split("@")[0] : "there",
        },
      });
      setTimeout(() => {
        void toAuthUser(raw).then((u) => {
          // Only apply if this user is still the one signed in.
          const cur = useAuthStore.getState().user;
          if (cur && cur.id === u.id) useAuthStore.setState({ user: u });
        });
      }, 0);
    } else {
      useAuthStore.setState({ status: "anonymous", user: null });
    }
  });
}
