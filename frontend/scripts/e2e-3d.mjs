// scripts/e2e-3d.mjs
// End-to-end check of the Site 3D feature ("View site in 3D").
// Runs against the DEV server (default http://localhost:5173) because
// the checks read the raw map through window.__tmMap, which MapView
// only exposes in dev builds. The backend must be running on :8000
// (the dev server proxies /api there).
//
// Run:  node scripts/e2e-3d.mjs [baseUrl] [desktop,mobile]
// Output: PASS/FAIL lines and screenshots in frontend/e2e-shots-3d/.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:5173";
const SHOTS = path.join(__dirname, "..", "e2e-shots-3d");
fs.mkdirSync(SHOTS, { recursive: true });

const SURVEY_TIMEOUT = 150_000;
const checks = [];
const issues = [];

function check(id, name, ok, detail = "") {
  checks.push({ id, name, ok, detail });
  console.log(`CHECK|${id}|${ok ? "PASS" : "FAIL"}|${name}${detail ? " :: " + detail : ""}`);
}

function wirePage(page, tag) {
  page.on("pageerror", (err) => issues.push(`[${tag}] PAGEERROR: ${String(err).slice(0, 400)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(`[${tag}] console.error: ${msg.text().slice(0, 300)}`);
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`  shot: ${name}.png`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PNG pixel-variance: proves the canvas is NOT a black screen.
function analyzePng(buffer) {
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
  for (let i = 0; i < raw.length; i += 7) {
    seen.add(raw[i]);
    if (raw[i] !== 0) nonzero++;
  }
  return { uniqueBytes: seen.size, nonzeroFrac: nonzero / Math.ceil(raw.length / 7) };
}

// STRICT canvas check for 3D scenes: a rendered satellite terrain view
// is rich in non-black pixels, so a mostly-black frame (like the stale
// frame after a stationary terrain re-apply) must FAIL, not sneak past
// on the UI card's pixels alone. Hence the 0.3 nonzeroFrac floor.
// Pass { lenient: true } for 2D checks on the DARK basemap, which is
// mostly near-black BY DESIGN (the original suite's thresholds).
async function canvasOk(page, { lenient = false } = {}) {
  // Element screenshots can time out under heavy repaint load in
  // headless mode (an infra flake, not an app bug), so try twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buf = await page
        .locator(".maplibregl-canvas")
        .first()
        .screenshot({ timeout: 15000, animations: "allow" });
      const { uniqueBytes, nonzeroFrac } = analyzePng(buf);
      const ok = lenient
        ? uniqueBytes >= 12 || nonzeroFrac >= 0.02
        : uniqueBytes >= 12 && nonzeroFrac >= 0.3;
      return { ok, uniqueBytes, nonzeroFrac };
    } catch (e) {
      if (attempt === 1) return { ok: false, err: e.message.slice(0, 120) };
      await sleep(1500);
    }
  }
}

// Read a value off the raw dev-exposed map.
async function mapState(page) {
  return page.evaluate(() => {
    const m = window.__tmMap;
    if (!m) return null;
    const c = m.getCenter();
    return {
      lat: c.lat, lon: c.lng, zoom: m.getZoom(),
      pitch: m.getPitch(), bearing: m.getBearing(),
      terrain: m.getTerrain() ? m.getTerrain().exaggeration : null,
    };
  });
}

async function waitResults(page) {
  try {
    await page.locator("text=Site assessment").first().waitFor({ timeout: SURVEY_TIMEOUT });
    await sleep(1500);
    return true;
  } catch {
    return false;
  }
}

async function drawPolygon(page) {
  await page.getByRole("button", { name: "Draw a polygon to survey" }).click();
  await sleep(700);
  const box = await page.locator(".maplibregl-canvas").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pts = [
    [cx - 100, cy - 70],
    [cx + 100, cy - 70],
    [cx + 60, cy + 80],
    [cx - 90, cy + 60],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await sleep(400);
  }
  await page.mouse.click(pts[3][0], pts[3][1]);
  await sleep(1200);
}

// A fresh page at /map with the welcome card pre-dismissed and the
// camera parked over the foothills near Golden, CO (real relief).
async function openMapAtGolden(ctx) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("terrameasure_welcome_v2", "1");
      sessionStorage.setItem(
        "tm_map_camera",
        JSON.stringify({ lat: 39.74, lon: -105.235, zoom: 15 }),
      );
    } catch {}
  });
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(6000);
  return page;
}

// ==================================================================
// DESKTOP PASS
// ==================================================================
async function desktopPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openMapAtGolden(ctx);
  wirePage(page, "desktop");

  await drawPolygon(page);
  const got = await waitResults(page);
  check("d1", "survey near Golden completes", got);
  if (!got) return ctx.close();
  await shot(page, "d01-results");

  // ---- Enter 3D ----
  const before = await mapState(page);
  const entry = page.getByRole("button", { name: "View site in 3D" });
  check("d2", "entry button present in results", (await entry.count()) > 0);
  await entry.click();
  // The tilt lands once the terrain tiles are loaded (up to 8s backstop)
  let tilted = false;
  for (let i = 0; i < 30; i++) {
    const s = await mapState(page);
    if (s && s.pitch > 50) { tilted = true; break; }
    await sleep(500);
  }
  await sleep(4000); // let tiles finish sharpening for the screenshot
  const s3d = await mapState(page);
  const cv1 = await canvasOk(page);
  await shot(page, "d02-3d-entered");
  check("d3", "3D entered: pitch ~60, terrain on, canvas not black",
    tilted && s3d.terrain !== null && cv1.ok,
    `pitch=${s3d?.pitch} terrain=${s3d?.terrain} canvas=${JSON.stringify(cv1)}`);

  // ---- Orbit advancing: two reads a second apart must differ ----
  const b1 = (await mapState(page)).bearing;
  await shot(page, "d03-orbit-a");
  await sleep(1200);
  const b2 = (await mapState(page)).bearing;
  await shot(page, "d03-orbit-b");
  const cv2 = await canvasOk(page);
  check("d4", "auto-orbit advances the bearing",
    Math.abs(b2 - b1) > 2 && cv2.ok, `b1=${b1.toFixed(1)} b2=${b2.toFixed(1)} canvas=${JSON.stringify(cv2)}`);

  // ---- Drape switching ----
  await page.getByRole("radio", { name: "Slope" }).click();
  await sleep(2000);
  const cvSlope = await canvasOk(page);
  await shot(page, "d04-drape-slope");
  check("d5", "Slope drape renders, canvas not black", cvSlope.ok, JSON.stringify(cvSlope));

  await page.getByRole("radio", { name: "Contours" }).click();
  await sleep(2000);
  const cvCont = await canvasOk(page);
  await shot(page, "d05-drape-contours");
  check("d6", "Contours drape renders, canvas not black", cvCont.ok, JSON.stringify(cvCont));

  await page.getByRole("radio", { name: "Satellite" }).click();
  await sleep(1500);

  // ---- Exaggeration slider (pauses orbit, re-applies terrain) ----
  const slider = page.getByLabel("Terrain height exaggeration");
  await slider.click(); // pointer down pauses the orbit
  await slider.fill("2.2");
  await sleep(2000);
  const sEx = await mapState(page);
  const cvEx = await canvasOk(page);
  await shot(page, "d06-exaggeration-2_2");
  check("d7", "exaggeration slider re-applies terrain without black screen",
    Math.abs(sEx.terrain - 2.2) < 0.01 && cvEx.ok,
    `terrain=${sEx.terrain} canvas=${JSON.stringify(cvEx)}`);

  // ---- Pause / resume ----
  const pauseBtn = page.getByRole("button", { name: /Pause orbit|Resume orbit/ });
  const label1 = await pauseBtn.getAttribute("aria-label");
  // Slider interaction already paused it; resume, verify motion, pause,
  // verify stillness.
  if (label1 === "Resume orbit") await pauseBtn.click();
  await sleep(800);
  const rb1 = (await mapState(page)).bearing;
  await sleep(1500); // generous window: headless frames can be heavy
  const rb2 = (await mapState(page)).bearing;
  await page.getByRole("button", { name: "Pause orbit" }).click();
  await sleep(500);
  const pb1 = (await mapState(page)).bearing;
  await sleep(1000);
  const pb2 = (await mapState(page)).bearing;
  check("d8", "orbit resume moves, pause holds still",
    Math.abs(rb2 - rb1) > 2 && Math.abs(pb2 - pb1) < 0.01,
    `resumed=${(rb2 - rb1).toFixed(2)}deg paused=${(pb2 - pb1).toFixed(3)}deg`);

  // ---- Manual interaction pauses the orbit ----
  await page.getByRole("button", { name: "Resume orbit" }).click();
  await sleep(600);
  const box = await page.locator(".maplibregl-canvas").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await sleep(600);
  const pausedByDrag = (await page.getByRole("button", { name: "Resume orbit" }).count()) > 0;
  const cvDrag = await canvasOk(page);
  await shot(page, "d07-after-manual-drag");
  check("d9", "manual drag pauses orbit, canvas stays rendered",
    pausedByDrag && cvDrag.ok, `paused=${pausedByDrag} canvas=${JSON.stringify(cvDrag)}`);

  // ---- Exit: exact 2D round trip ----
  await page.getByRole("button", { name: "Exit 3D view" }).click();
  await sleep(2500);
  const after = await mapState(page);
  // Lenient: exit lands on the dark 2D basemap (near-black by design).
  const cvExit = await canvasOk(page, { lenient: true });
  const resultsBack = (await page.locator("text=Site assessment").count()) > 0;
  await shot(page, "d08-exited-2d");
  const cameraRestored =
    Math.abs(after.lat - before.lat) < 0.002 &&
    Math.abs(after.lon - before.lon) < 0.002 &&
    Math.abs(after.zoom - before.zoom) < 0.1 &&
    after.pitch === 0 &&
    after.terrain === null;
  check("d10", "exit restores 2D camera, terrain off, results reopen",
    cameraRestored && resultsBack && cvExit.ok,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)} results=${resultsBack}`);

  await ctx.close();
}

// ==================================================================
// MOBILE PASS
// ==================================================================
async function mobilePass(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await openMapAtGolden(ctx);
  wirePage(page, "mobile");

  // Phones have no TopBar draw tools; the survey flow is the reticle:
  // pan the map under a fixed crosshair and press "+ Add Point" for
  // each corner, then "Finish survey" (same steps as the main suite).
  async function pan(dx, dy) {
    const b = await page.locator(".maplibregl-canvas").first().boundingBox();
    const sx = b.x + b.width / 2;
    const sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8);
      await sleep(30);
    }
    await page.mouse.up();
    await sleep(800);
  }
  await page.getByRole("button", { name: "Start a survey" }).click();
  await sleep(1200);
  const addPoint = page.getByRole("button", { name: "+ Add Point" });
  await addPoint.click();
  await sleep(500);
  await pan(-150, 0);
  await addPoint.click();
  await sleep(500);
  await pan(0, -150);
  await addPoint.click();
  await sleep(500);
  await pan(150, 0);
  await addPoint.click();
  await sleep(700);
  await page.getByRole("button", { name: "Finish survey" }).click();
  const got = await waitResults(page);
  check("m1", "mobile survey completes", got);
  if (!got) return ctx.close();

  const entry = page.getByRole("button", { name: "View site in 3D" });
  await entry.scrollIntoViewIfNeeded();
  await shot(page, "m01-results-sheet");
  await entry.click();
  let tilted = false;
  for (let i = 0; i < 30; i++) {
    const s = await mapState(page);
    if (s && s.pitch > 50) { tilted = true; break; }
    await sleep(500);
  }
  await sleep(2500);
  const cv = await canvasOk(page);
  await shot(page, "m02-3d-entered");

  // Control card must sit in the lower part of the screen (not over the
  // framed site, which the entry camera keeps in the upper ~60%).
  const card = await page.locator('[aria-label="Site 3D controls"]').boundingBox();
  const cardLow = !!card && card.y > 844 * 0.55 && card.y + card.height <= 845;
  const cardFits = !!card && card.x >= 0 && card.x + card.width <= 391;
  check("m2", "mobile 3D enters, card bottom-centered and on screen",
    tilted && cv.ok && cardLow && cardFits,
    `tilted=${tilted} canvas=${JSON.stringify(cv)} card=${JSON.stringify(card)}`);

  // Orbit advancing on mobile too
  const b1 = (await mapState(page)).bearing;
  await sleep(1200);
  const b2 = (await mapState(page)).bearing;
  check("m3", "mobile orbit advances", Math.abs(b2 - b1) > 2,
    `b1=${b1.toFixed(1)} b2=${b2.toFixed(1)}`);

  // A touch drag must still pan/rotate (MapLibre defaults) and pause
  // the orbit rather than fight it.
  await page.touchscreen.tap(195, 350);
  await sleep(700);
  const pausedByTouch = (await page.getByRole("button", { name: "Resume orbit" }).count()) > 0;
  const cvTouch = await canvasOk(page);
  await shot(page, "m03-after-touch");
  check("m4", "touch pauses orbit, canvas stays rendered",
    pausedByTouch && cvTouch.ok, `paused=${pausedByTouch}`);

  await page.getByRole("button", { name: "Exit 3D view" }).click();
  await sleep(2000);
  const after = await mapState(page);
  const sheetBack = (await page.locator("text=Site assessment").count()) > 0;
  await shot(page, "m04-exited");
  check("m5", "mobile exit returns to 2D with results sheet",
    after.pitch === 0 && after.terrain === null && sheetBack,
    `pitch=${after.pitch} terrain=${after.terrain} sheet=${sheetBack}`);

  await ctx.close();
}

const PASSES = (process.argv[3] || "desktop,mobile").split(",");
const browser = await chromium.launch();
let crashed = null;
try {
  if (PASSES.includes("desktop")) await desktopPass(browser);
  if (PASSES.includes("mobile")) await mobilePass(browser);
} catch (e) {
  crashed = e;
  console.log(`\nRUN CRASHED: ${String(e).slice(0, 500)}`);
} finally {
  await browser.close();
}

console.log("\n================= RESULTS =================");
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  [${c.id}] ${c.name}${c.detail ? " :: " + c.detail : ""}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log("\n================= ISSUES ==================");
if (issues.length === 0) console.log("none");
else {
  const seen = new Map();
  for (const i of issues) seen.set(i, (seen.get(i) ?? 0) + 1);
  for (const [line, n] of seen) console.log(`${n > 1 ? `(x${n}) ` : ""}${line}`);
}
process.exit(failed.length > 0 || crashed ? 1 : 0);
