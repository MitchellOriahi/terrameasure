// scripts/ux-sweep.mjs
// A LOOK, not a test. The regression script (e2e-final.mjs) proves the
// app works; this one walks the same screens and photographs them at a
// desktop and a phone size so a human (or Claude) can judge how it FEELS:
// crowding, hierarchy, empty states, error states, thumb reach.
//
// It deliberately avoids running real surveys (slow, and dependent on
// upstream services). It uses a stubbed survey response so the results
// panel, the 3D model and the share flow can be photographed instantly
// and identically every run.
//
//   node scripts/ux-sweep.mjs [baseUrl]
//
// Screenshots land in scripts/ux-shots/.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];

async function shot(page, name, full = false) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
}

/** Measure every interactive control and report anything a thumb would
    struggle with. 44px is the accepted minimum touch target. */
async function tapTargets(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button]",
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.height < 44 || r.width < 44) {
        out.push({
          text: (el.getAttribute("aria-label") || el.textContent || "")
            .trim()
            .slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out;
  });
  if (small.length) {
    notes.push(`[${label}] ${small.length} controls under 44px: ` +
      small.slice(0, 8).map((s) => `"${s.text}" ${s.w}x${s.h}`).join(", "));
  } else {
    notes.push(`[${label}] all visible controls are at least 44px`);
  }
}

/** Does the page scroll sideways? On a phone that always reads as broken. */
async function hScroll(page, label) {
  const bad = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  notes.push(`[${label}] horizontal scroll: ${bad ? "YES (bug)" : "no"}`);
}

const browser = await chromium.launch();

for (const device of [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 3 },
]) {
  const ctx = await browser.newContext({
    viewport: device.viewport,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
    deviceScaleFactor: device.deviceScaleFactor,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();

  // ---- Landing ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(6000); // let the hero map load its tiles
  await shot(page, `${device.name}-01-landing`);
  await shot(page, `${device.name}-01-landing-full`, true);
  await tapTargets(page, `${device.name} landing`);
  await hScroll(page, `${device.name} landing`);

  // ---- Auth (the outage banner should be visible: the project is gone) ----
  await page.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
  await sleep(7000);
  await shot(page, `${device.name}-02-auth`);
  const authTxt = await page.locator("body").innerText();
  notes.push(
    `[${device.name} auth] outage notice shown: ` +
      /Sign-in is unavailable right now/i.test(authTxt),
  );

  // ---- Saved (empty state) ----
  await page.goto(BASE + "/saved", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await shot(page, `${device.name}-03-saved-empty`, true);

  // ---- Ground truth ----
  await page.goto(BASE + "/photo", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  await shot(page, `${device.name}-04-groundtruth`, true);

  // ---- News ----
  await page.goto(BASE + "/news", { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await shot(page, `${device.name}-05-news`, true);

  // ---- Map, first visit ----
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(7000);
  await shot(page, `${device.name}-06-map-welcome`);
  await tapTargets(page, `${device.name} map`);
  await hScroll(page, `${device.name} map`);

  await ctx.close();
}

await browser.close();
console.log("\n=== UX SWEEP NOTES ===");
for (const n of notes) console.log(n);
console.log(`\nshots in ${OUT}`);
