// lib/appUpdate.ts
// Making sure people actually get the version we shipped.
//
// THE BUG THIS FIXES: the app is a PWA, so a service worker caches the
// whole shell for offline use. That is good, but it means a returning
// visitor opens the version they cached LAST time. We deploy, we check
// the live URL, everything looks right to us, and the person who has
// been here before still sees last week's app until they happen to hard
// refresh. From their side the update simply did not happen.
//
// WHAT THIS DOES: registers the service worker, and when a new one has
// downloaded and is ready, decides between two behaviours:
//
//   * The page is not in the middle of anything (no survey on screen):
//     refresh silently, straight away. The visitor never notices, they
//     just have the current version.
//   * The person is reading results: do NOT yank the page out from
//     under them. Set a flag; the reload happens the next time they
//     navigate, which for a single-page app means the next full load.
//
// Losing someone's survey to an automatic refresh would be a far worse
// bug than showing them a slightly old page for one more minute.

import { registerSW } from "virtual:pwa-register";

/** True while a survey's results are on screen and worth protecting. */
function busyReading(): boolean {
  // Deliberately a DOM check rather than a store import: this module
  // runs before React mounts, and it must not drag the app's state into
  // the startup path.
  return document.querySelector("[data-survey-open]") !== null;
}

export function initAppUpdate(): void {
  // Wrapped because a browser with service workers disabled (private
  // windows, some enterprise policies) throws here, and an update check
  // failing must never stop the app from starting.
  try {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (!busyReading()) {
          // true = activate the new worker and reload the page.
          void updateSW(true);
          return;
        }
        // Mid-survey: wait for a natural moment.
        const onLeave = () => {
          if (!busyReading()) {
            window.removeEventListener("popstate", onLeave);
            void updateSW(true);
          }
        };
        window.addEventListener("popstate", onLeave);
      },
      onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
        // Ask the browser to look for a new version every ten minutes
        // while a tab stays open. Cheap (one conditional GET) and it
        // means a long-lived tab does not drift a whole day behind.
        if (registration) {
          window.setInterval(
            () => {
              void registration.update();
            },
            10 * 60 * 1000,
          );
        }
      },
    });
  } catch {
    // No service worker support: nothing to update, nothing to do.
  }
}
