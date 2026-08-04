// scripts/e2e-probe-zoom.mjs
// Chases the "map looks massively overzoomed after search" mystery:
// prints the map's real zoom, canvas buffer size, CSS size, and DPR
// before and after the search flyTo.
// Run: node scripts/e2e-probe-zoom.mjs [baseUrl]

import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:5177";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("terrameasure_welcome_v2", "1");
  } catch {}
});
const page = await ctx.newPage();

async function probe(label) {
  const info = await page.evaluate(() => {
    const map = window.__tmMap;
    if (!map) return "no __tmMap";
    const canvas = map.getCanvas();
    return JSON.stringify({
      zoom: +map.getZoom().toFixed(2),
      terrain: map.getTerrain ? map.getTerrain() : "n/a",
      pitch: map.getPitch(),
      buffer: [canvas.width, canvas.height],
      css: [canvas.clientWidth, canvas.clientHeight],
    });
  });
  console.log(`[${label}] ${info}`);
}

await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
await sleep(6000);
await probe("initial");

await page.getByLabel("Search address or place").fill("Golden, Colorado");
const first = page.locator("div.glass button", { hasText: "Golden" }).first();
await first.waitFor({ timeout: 15000 });
// What result are we actually clicking?
console.log("first result text:", (await first.innerText()).slice(0, 120));
await first.click();
await sleep(1000);
await probe("flyTo +1s");
await sleep(2000);
await probe("flyTo +3s");
await sleep(3000);
await probe("flyTo +6s");
await page.screenshot({ path: "e2e-shots/z1-minimal-golden.png" });

// Now repeat AFTER a satellite -> map round trip and a 3D on/off, to see
// whether one of those steps corrupts rendering at street zoom.
await page.getByRole("button", { name: "Satellite" }).click();
await sleep(5000);
await page.getByRole("button", { name: "Map", exact: true }).click();
await sleep(5000);
await page.screenshot({ path: "e2e-shots/z2-after-basemap-roundtrip.png" });
await probe("after basemap roundtrip");

await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
await sleep(2500);
await page.screenshot({ path: "e2e-shots/z3a-3d-on.png" });
await probe("3D on");
await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
await sleep(2500);
await page.screenshot({ path: "e2e-shots/z3b-3d-off.png" });
await probe("3D off");

await browser.close();
