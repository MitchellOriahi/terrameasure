import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:8000";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await sleep(7000);
await page.screenshot({ path: `${OUT}m-hero.png` });
const scroller = ".h-dvh.overflow-y-auto";
for (const [i, y] of [[1, 700], [2, 1500]]) {
  await page.evaluate(([sel, top]) => {
    const el = document.querySelector(sel) || document.scrollingElement;
    el.scrollTop = top;
  }, [scroller, y]);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}m-scroll-${i}.png` });
}
await ctx.close();
await browser.close();
console.log("mobile shots written");
