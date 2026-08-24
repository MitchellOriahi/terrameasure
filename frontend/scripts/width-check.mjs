// scripts/width-check.mjs
// Photograph the landing hero at the widths where side-by-side layouts
// get squeezed, and measure whether any element spills out of the card
// that is supposed to contain it.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();

for (const w of [390, 640, 768, 900, 1024, 1280, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(6500);
  // Measure the CTA and the paragraph beside it.
  const m = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /survey this shape/i.test(b.textContent || ""));
    if (!btn) return { found: false };
    const row = btn.parentElement;
    const p = row?.querySelector("p");
    const b = btn.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const pr = p?.getBoundingClientRect();
    return {
      found: true,
      btn: { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) },
      row: { w: Math.round(r.width), right: Math.round(r.right) },
      para: pr ? { w: Math.round(pr.width), left: Math.round(pr.left), lines: Math.round(pr.height / 16) } : null,
      overflowsRow: b.right > r.right + 1,
      overlapsPara: pr ? b.right > pr.left + 1 : false,
    };
  });
  console.log(`${w}px`, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}w${w}-hero.png`, clip: { x: 0, y: 0, width: w, height: Math.min(900, 900) } });
  await ctx.close();
}
await browser.close();
