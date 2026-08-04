// scripts/e2e-diagnose.mjs
// A "robot tester" for the TerraMeasure frontend, built on Playwright.
//
// What it does: opens the app in a real (headless) Chromium browser and
// walks through everything a human tester would: load the map, switch
// basemaps, toggle layers, search, draw a polygon, wait for the survey,
// share a report, check deep links, and repeat the key flow on a phone
// sized screen. Along the way it records every console message, page
// error, and failed network request, and saves a screenshot of each step
// to frontend/e2e-shots/ so a human can eyeball the results.
//
// Run it with:  node scripts/e2e-diagnose.mjs [baseUrl]
// Default baseUrl is http://localhost:5174 (the Vite dev server).

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:5174";
const LIVE = process.argv[3] || ""; // optional live URL for read-only pass
const SHOTS = path.join(__dirname, "..", "e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------------
// Log collection: everything noteworthy lands in this array, tagged
// with which pass (desktop / mobile / live) it came from.
// ------------------------------------------------------------------
const log = [];
function note(pass, kind, text) {
  const line = `[${pass}] ${kind}: ${text}`;
  log.push(line);
  console.log(line);
}

function wirePage(page, pass) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      note(pass, `console.${type}`, msg.text().slice(0, 500));
    }
  });
  page.on("pageerror", (err) => {
    note(pass, "PAGEERROR", String(err).slice(0, 800));
  });
  page.on("requestfailed", (req) => {
    note(
      pass,
      "requestfailed",
      `${req.method()} ${req.url().slice(0, 200)} :: ${req.failure()?.errorText}`,
    );
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      note(pass, `http.${res.status()}`, res.url().slice(0, 200));
    }
  });
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  shot: ${name}.png`);
  return file;
}

// ------------------------------------------------------------------
// "Did the map actually render tiles?" check.
// We screenshot just the map canvas and inspect the PNG's raw pixel
// data. A blank/black canvas produces filtered scanlines that are
// almost entirely zero bytes with only a handful of distinct values;
// a real rendered map produces rich, varied bytes.
// ------------------------------------------------------------------
function analyzePng(buffer) {
  // PNG layout: 8-byte signature, then chunks (len, type, data, crc).
  let off = 8;
  const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buffer.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const seen = new Set();
  let nonzero = 0;
  // Sample every 7th byte to keep this fast on big screenshots.
  for (let i = 0; i < raw.length; i += 7) {
    seen.add(raw[i]);
    if (raw[i] !== 0) nonzero++;
  }
  const sampled = Math.ceil(raw.length / 7);
  return { uniqueBytes: seen.size, nonzeroFrac: nonzero / sampled };
}

async function checkCanvas(page, pass, label) {
  const canvas = page.locator(".maplibregl-canvas").first();
  try {
    const buf = await canvas.screenshot();
    const { uniqueBytes, nonzeroFrac } = analyzePng(buf);
    const uniform = uniqueBytes < 12 && nonzeroFrac < 0.02;
    note(
      pass,
      uniform ? "CANVAS-UNIFORM" : "canvas-ok",
      `${label}: uniqueBytes=${uniqueBytes} nonzeroFrac=${nonzeroFrac.toFixed(3)}`,
    );
    return !uniform;
  } catch (e) {
    note(pass, "CANVAS-FAIL", `${label}: ${e.message.slice(0, 200)}`);
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app stashes the camera (lat/lon/zoom) in sessionStorage on every
// move-end; reading it back is the easiest way to know where the map
// actually is at each step.
async function logCamera(page, pass, label) {
  const cam = await page.evaluate(() =>
    sessionStorage.getItem("tm_map_camera"),
  );
  note(pass, "camera", `${label}: ${cam}`);
}

// ==================================================================
// PASS 1: desktop walk
// ==================================================================
async function desktopPass(browser) {
  const pass = "desktop";
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // Mark the first-run welcome card as already seen, so it does not sit
  // on top of the map and swallow this robot's clicks. The onboarding
  // flow has its own owner and tests.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("terrameasure_welcome_v2", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  wirePage(page, pass);

  // ---- 1. Initial load ----
  // The map app lives at /map (the marketing landing page owns "/").
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(8000); // give tiles time to stream in
  await shot(page, "d01-initial-load");
  await checkCanvas(page, pass, "initial (Map basemap)");

  // ---- 2. Basemap switching ----
  await page.getByRole("button", { name: "Satellite" }).click();
  await sleep(7000);
  await shot(page, "d02-satellite");
  await checkCanvas(page, pass, "satellite");

  await page.getByRole("button", { name: "Map", exact: true }).click();
  await sleep(7000);
  await shot(page, "d03-back-to-map");
  await checkCanvas(page, pass, "back to Map basemap");

  // ---- 3. 3D toggle on and off ----
  await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
  await sleep(4000);
  await shot(page, "d04-3d-on");
  await checkCanvas(page, pass, "3D on");
  await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
  await sleep(1500);
  await logCamera(page, pass, "after 3D on+off");

  // ---- 4. Layers panel: open + toggle Flood and Wetlands ----
  await page.getByRole("button", { name: "Toggle overlays panel" }).click();
  await sleep(500);
  await shot(page, "d05-layers-open");
  const floodRow = page.locator("label", { hasText: "Flood zones" });
  const wetRow = page.locator("label", { hasText: "Wetlands" });
  await floodRow.click();
  await wetRow.click();
  await sleep(5000);
  await shot(page, "d06-flood-wetlands-on");
  await floodRow.click();
  await wetRow.click();
  await page.getByRole("button", { name: "Close overlays panel" }).click();

  // ---- 5. Search for Golden, Colorado ----
  await page.getByLabel("Search address or place").fill("Golden, Colorado");
  const firstResult = page
    .locator("div.glass button", { hasText: "Golden" })
    .first();
  try {
    await firstResult.waitFor({ timeout: 15000 });
    await firstResult.click();
    note(pass, "ok", "search: picked a Golden result");
  } catch {
    note(pass, "SEARCH-FAIL", "no dropdown result for Golden, Colorado");
  }
  await sleep(5000); // flyTo animation is 2.2s + tile load
  await shot(page, "d07-golden");
  await checkCanvas(page, pass, "after search flyTo");
  await logCamera(page, pass, "after search flyTo");

  // ---- 6. Draw a polygon with the desktop tool ----
  await page.getByRole("button", { name: "Draw a polygon to survey" }).click();
  await sleep(600);
  const box = await page.locator(".maplibregl-canvas").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Three corners around the screen center (small on the ground at z15)
  const pts = [
    [cx - 90, cy - 60],
    [cx + 90, cy - 60],
    [cx + 40, cy + 80],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await sleep(450);
  }
  // terra-draw finishes a polygon by clicking the last placed point again
  await page.mouse.click(pts[2][0], pts[2][1]);
  await sleep(1200);
  await shot(page, "d08-after-draw");

  // Did the survey start? The loading card says "...survey engine..."
  const loading = page.locator("text=/survey engine|Almost there|waking/i");
  const results = page.locator("text=Site assessment");
  if ((await loading.count()) > 0) {
    note(pass, "ok", "survey request started (loading card visible)");
  } else if ((await results.count()) > 0) {
    note(pass, "ok", "survey already returned");
  } else {
    note(
      pass,
      "DRAW-FAIL",
      "no loading card and no results after finishing the polygon",
    );
  }

  // ---- 7. Wait for results (long: local pipeline fetches real DEMs) ----
  try {
    await results.first().waitFor({ timeout: 150000 });
    note(pass, "ok", "survey results arrived");
    await sleep(1500);
    await shot(page, "d09-results");
  } catch {
    note(pass, "SURVEY-FAIL", "no results after 150s");
    await shot(page, "d09-no-results");
  }

  // ---- 8. Share report ----
  const shareBtn = page.getByRole("button", { name: "Share report" });
  if ((await shareBtn.count()) > 0) {
    await shareBtn.scrollIntoViewIfNeeded();
    await shareBtn.click();
    try {
      await page
        .locator("text=Public report link")
        .waitFor({ timeout: 60000 });
      note(pass, "ok", "share link created");
      await shot(page, "d10-share-link");
    } catch {
      note(pass, "SHARE-FAIL", "no public link after 60s");
      await shot(page, "d10-share-fail");
    }
  } else {
    note(pass, "SHARE-FAIL", "Share report button not found in results");
  }

  // ---- 9. Deep links straight from the address bar ----
  for (const p of ["/news", "/auth", "/profile", "/r/unknownslug"]) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    await sleep(3500);
    const bodyText = (await page.locator("body").innerText()).trim();
    const name = `d11-deeplink-${p.replace(/\W+/g, "-")}`;
    await shot(page, name);
    if (bodyText.length < 5) {
      note(pass, "DEEPLINK-FAIL", `${p} rendered an empty page`);
    } else {
      note(pass, "ok", `${p} rendered (${bodyText.length} chars of text)`);
    }
  }

  await ctx.close();
}

// ==================================================================
// PASS 2: mobile walk (iPhone-ish, touch)
// ==================================================================
async function mobilePass(browser) {
  const pass = "mobile";
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  // Same as the desktop pass: skip the first-run welcome card.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("terrameasure_welcome_v2", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  wirePage(page, pass);

  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(7000);
  await shot(page, "m01-initial");
  await checkCanvas(page, pass, "mobile initial");

  // Bottom bar must be there with the big Survey button
  const surveyBtn = page.getByRole("button", { name: "Start a survey" });
  if ((await surveyBtn.count()) === 0) {
    note(pass, "MOBILE-FAIL", "bottom bar Survey button missing");
    await ctx.close();
    return;
  }
  note(pass, "ok", "bottom bar with Survey button visible");

  // Zoom into Golden first so the drawn polygon is a sane size
  await page.getByLabel("Search address or place").fill("Golden, Colorado");
  const firstResult = page
    .locator("div.glass button", { hasText: "Golden" })
    .first();
  try {
    await firstResult.waitFor({ timeout: 15000 });
    await firstResult.click();
    await sleep(5000);
  } catch {
    note(pass, "SEARCH-FAIL", "mobile: no dropdown result for Golden");
  }

  // Enter reticle mode
  await surveyBtn.click();
  await sleep(1200);
  await shot(page, "m02-reticle-armed");
  const addPoint = page.getByRole("button", { name: "+ Add Point" });
  if ((await addPoint.count()) === 0) {
    note(pass, "MOBILE-FAIL", "reticle tray (+ Add Point) did not appear");
    await ctx.close();
    return;
  }

  // Place 3 corners: tap Add Point, pan the map, tap again, pan, tap.
  async function pan(dx, dy) {
    const b = await page.locator(".maplibregl-canvas").first().boundingBox();
    const sx = b.x + b.width / 2;
    const sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // move in small steps so MapLibre treats it as a drag, not a jump
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8);
      await sleep(30);
    }
    await page.mouse.up();
    await sleep(700);
  }

  await addPoint.click();
  await sleep(400);
  await pan(-140, 0);
  await addPoint.click();
  await sleep(400);
  await pan(0, -140);
  await addPoint.click();
  await sleep(600);
  await shot(page, "m03-three-points");

  // Close the shape with the Done (check) button
  const done = page.getByRole("button", { name: "Finish survey" });
  if ((await done.count()) === 0) {
    note(pass, "MOBILE-FAIL", "Done button missing after 3 points");
    await ctx.close();
    return;
  }
  await done.click();
  await sleep(1500);
  await shot(page, "m04-survey-started");

  const results = page.locator("text=Site assessment");
  try {
    await results.first().waitFor({ timeout: 150000 });
    note(pass, "ok", "mobile survey results sheet appeared");
    await sleep(1500);
    await shot(page, "m05-results-sheet");
  } catch {
    note(pass, "SURVEY-FAIL", "mobile: no results after 150s");
    await shot(page, "m05-no-results");
  }

  await ctx.close();
}

// ==================================================================
// PASS 3: live production site, read-only look
// ==================================================================
async function livePass(browser) {
  if (!LIVE) return;
  const pass = "live";
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  wirePage(page, pass);
  await page.goto(LIVE, { waitUntil: "domcontentloaded" });
  await sleep(12000);
  await shot(page, "live01-initial");
  await checkCanvas(page, pass, "live initial");

  // Service worker status: how many registrations, any waiting worker?
  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((r) => ({
      scope: r.scope,
      active: !!r.active,
      waiting: !!r.waiting,
    }));
  });
  note(pass, "serviceworker", JSON.stringify(sw));

  // Try the basemap switch on live too (read-only interaction)
  try {
    await page.getByRole("button", { name: "Satellite" }).click();
    await sleep(6000);
    await shot(page, "live02-satellite");
    await checkCanvas(page, pass, "live satellite");
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await sleep(6000);
    await shot(page, "live03-map");
    await checkCanvas(page, pass, "live map basemap");
  } catch (e) {
    note(pass, "LIVE-FAIL", `basemap switch: ${e.message.slice(0, 200)}`);
  }
  await ctx.close();
}

// ==================================================================
const browser = await chromium.launch();
try {
  await desktopPass(browser);
  await mobilePass(browser);
  await livePass(browser);
} finally {
  await browser.close();
}

console.log("\n================ SUMMARY ================");
const problems = log.filter((l) =>
  /PAGEERROR|FAIL|UNIFORM|console\.error|requestfailed|http\.[45]/.test(l),
);
if (problems.length === 0) {
  console.log("No problems detected.");
} else {
  console.log(`${problems.length} problem lines:`);
  for (const p of problems) console.log("  " + p);
}
