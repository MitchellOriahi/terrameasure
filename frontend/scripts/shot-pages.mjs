import { chromium } from "playwright";
const B = process.argv[2] || "http://localhost:8000";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
for (const [w, tag] of [[1440, "d"], [390, "m"]]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: 900 },
    isMobile: w < 500, hasTouch: w < 500, serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  for (const [path, name] of [["/saved", "saved"], ["/auth", "auth"], ["/photo", "groundtruth"], ["/news", "news"]]) {
    await page.goto(B + path, { waitUntil: "domcontentloaded" });
    await sleep(w < 500 ? 4500 : 4000);
    await page.screenshot({ path: `${OUT}page-${tag}-${name}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log("page shots written");
