// scripts/capture-product.mjs
// Photograph the REAL app for the landing page.
//
// Why not mockups: a mockup is a promise, a screenshot is evidence, and
// this product's whole pitch is that it does not overstate things. These
// images are the actual results panel and the actual shared report,
// produced by running a genuine survey against the real engine. Re-run
// this whenever the UI changes so the marketing page can never drift
// away from what the app actually looks like.
//
//   node scripts/capture-product.mjs [baseUrl]
//
// Writes into public/shots/, which ships with the site.

import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "public/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Draw a polygon on the map by clicking corners, then closing it. */
async function drawPolygon(page, pts) {
  await page.getByRole("button", { name: "Draw a polygon to survey" }).click();
  await sleep(700);
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await sleep(260);
  }
  await page.mouse.click(pts[0][0], pts[0][1]); // close the ring
  await sleep(800);
}

/** Wait until the results panel has a verdict in it. */
async function waitResults(page, ms = 180000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const txt = await page.locator("body").innerText();
    if (/(GO|CAUTION|NO-GO)/.test(txt) && /site score/i.test(txt)) return true;
    await sleep(2500);
  }
  return false;
}

const browser = await chromium.launch();

// ---------- Desktop: the results panel doing its job ----------
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  serviceWorkers: "block",
});
const page = await ctx.newPage();
await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
await sleep(6000);
// Dismiss the first-visit welcome so it is not in the shot.
const explore = page.getByRole("button", { name: "Explore on my own" });
if (await explore.count()) {
  await explore.click();
  await sleep(600);
}
// Go somewhere with real relief and real lidar. Setting the stored
// camera and reloading is exact and repeatable; typing in the search box
// depends on a geocoder round trip and, when it does not land, you end
// up drawing a polygon across three states (ask me how I know).
await page.evaluate(() => {
  sessionStorage.setItem(
    "tm_map_camera",
    JSON.stringify({ lat: 40.1508, lon: -104.9705, zoom: 15.6 }),
  );
});
await page.reload({ waitUntil: "domcontentloaded" });
await sleep(8000);
const dismiss = page.getByRole("button", { name: "Explore on my own" });
if (await dismiss.count()) {
  await dismiss.click();
  await sleep(500);
}
await page.getByRole("button", { name: "Satellite", exact: true }).click();
await sleep(9000); // let the imagery actually arrive before we shoot

await drawPolygon(page, [
  [560, 330],
  [820, 330],
  [860, 560],
  [540, 570],
]);
const ok = await waitResults(page);
console.log("desktop survey completed:", ok);
await sleep(4000); // let the 3D model settle into its first frames

await page.screenshot({ path: `${OUT}/app-desktop.png` });
console.log("wrote app-desktop.png");

// The results panel on its own, cropped tight: the strongest single
// image we have, because it is the answer the product exists to give.
const panel = page.locator("aside").first();
if (await panel.count()) {
  await panel.screenshot({ path: `${OUT}/panel.png` });
  console.log("wrote panel.png");
}

// Create a share link so we can photograph the public report too.
let reportUrl = null;
const shareBtn = page.getByRole("button", { name: "Share report" });
if (await shareBtn.count()) {
  await shareBtn.click();
  await sleep(9000);
  const link = page.locator('a[href*="/r/"]').first();
  if (await link.count()) reportUrl = await link.getAttribute("href");
}
console.log("report url:", reportUrl);
await ctx.close();

// ---------- Phone: the shared report ----------
if (reportUrl) {
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const mp = await mctx.newPage();
  await mp.goto(reportUrl.startsWith("http") ? reportUrl : BASE + reportUrl, {
    waitUntil: "domcontentloaded",
  });
  await sleep(11000);
  await mp.screenshot({ path: `${OUT}/report-phone.png` });
  console.log("wrote report-phone.png");
  await mctx.close();
}

await browser.close();
