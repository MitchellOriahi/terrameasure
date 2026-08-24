import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:8000";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await sleep(7000);
// Walk down the page a screen at a time.
for (let i = 1; i <= 6; i++) {
  await page.evaluate((n) => {
    const el = document.scrollingElement || document.querySelector("div[style*='scroll-behavior']");
    const target = document.querySelector(".h-dvh.overflow-y-auto") || el;
    target.scrollTop = n * 820;
  }, i);
  await sleep(1400);
  await page.screenshot({ path: `${OUT}sec-${i}.png` });
}
await ctx.close();
await browser.close();
console.log("section shots written");
