// scripts/e2e-probe-draw.mjs
// A focused probe for the terra-draw "setData of undefined" crash.
// Walks the same steps as the big diagnostic, but after every step it
// lists which terra-draw sources/layers exist in the map style, so we
// can see exactly WHEN they disappear.
// Run: node scripts/e2e-probe-draw.mjs [baseUrl]

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
page.on("pageerror", (err) => console.log("PAGEERROR:", String(err).slice(0, 200)));

// What terra-draw sources / layers does the live style contain right now?
async function probe(label) {
  const info = await page.evaluate(() => {
    const map = window.__tmMap;
    if (!map) return "no __tmMap";
    const style = map.getStyle();
    const sources = Object.keys(style.sources).filter((s) =>
      s.startsWith("td-"),
    );
    const layers = style.layers
      .map((l) => l.id)
      .filter((id) => id.startsWith("td-"));
    return JSON.stringify({ sources, layers });
  });
  console.log(`[${label}] ${info}`);
}

await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
await sleep(6000);
await probe("initial load");

await page.getByRole("button", { name: "Satellite" }).click();
await sleep(5000);
await probe("after satellite");

await page.getByRole("button", { name: "Map", exact: true }).click();
await sleep(5000);
await probe("after back to map");

await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
await sleep(2500);
await probe("after 3D on");
await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
await sleep(1500);
await probe("after 3D off");

await page.getByRole("button", { name: "Toggle overlays panel" }).click();
await sleep(400);
await page.locator("label", { hasText: "Flood zones" }).click();
await page.locator("label", { hasText: "Wetlands" }).click();
await sleep(3000);
await probe("after flood+wetlands on");
await page.getByRole("button", { name: "Close overlays panel" }).click();

await page.getByLabel("Search address or place").fill("Golden, Colorado");
const first = page.locator("div.glass button", { hasText: "Golden" }).first();
await first.waitFor({ timeout: 15000 });
await first.click();
await sleep(5000);
await probe("after search flyTo");

await page.getByRole("button", { name: "Draw a polygon to survey" }).click();
await sleep(800);
await probe("after arming polygon");

const box = await page.locator(".maplibregl-canvas").first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(800);
await probe("after first draw click");

await browser.close();
