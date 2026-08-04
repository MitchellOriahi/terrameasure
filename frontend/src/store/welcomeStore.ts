// store/welcomeStore.ts
// Tiny shared state for the first-run welcome card on the map screen.
//
// Why a separate store instead of adding to appStore? Two reasons:
//   1. The welcome card is a self-contained onboarding feature; keeping
//      its state here means appStore stays focused on map/survey state.
//   2. Two far-apart components need to talk: the "?" help button in the
//      TopBar (which opens the card) and the WelcomeOverlay itself (which
//      shows it). A two-line Zustand store is the simplest bridge.
//
// The "have they seen it?" flag lives in localStorage so the card only
// auto-opens on a person's very first visit, ever, not on every reload.

import { create } from "zustand";

// Versioned key: if we ever redesign onboarding enough that everyone
// should see it again, bump the "_v2" and the card re-appears once.
const FLAG_KEY = "terrameasure_welcome_v2";

/** Has this browser already seen (and dismissed) the welcome card? */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    // localStorage can throw in some private-browsing modes. Treat that
    // as "not seen": a genuinely new visitor still gets onboarding, and
    // a repeat visitor can dismiss it again with one tap.
    return false;
  }
}

/** Remember the dismissal so the card never auto-opens again. */
export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(FLAG_KEY, "1");
  } catch {
    // Storage unavailable: worst case the card shows again next session.
  }
}

interface WelcomeState {
  /** Is the welcome card on screen right now? */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useWelcomeStore = create<WelcomeState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
