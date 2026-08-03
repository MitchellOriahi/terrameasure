// lib/hints.ts
// Remembers, across visits, how many surveys this person has completed.
//
// Why: the first-use hint pill ("Move the map to aim...") should teach a
// newcomer, then get out of the way forever. localStorage is the browser's
// tiny key-value store that survives page reloads, so it is perfect for a
// "you have done this before" counter. Every read/write is wrapped in
// try/catch because localStorage can throw in private browsing modes and
// the hint is never worth crashing over.

const KEY = "tm_completed_surveys";

/** How many surveys this browser has completed (0 if unknown). */
export function getCompletedSurveyCount(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Call once each time a survey is submitted successfully. */
export function bumpCompletedSurveyCount(): void {
  try {
    localStorage.setItem(KEY, String(getCompletedSurveyCount() + 1));
  } catch {
    // Storage unavailable (private mode, etc.): the hint just shows again.
  }
}
