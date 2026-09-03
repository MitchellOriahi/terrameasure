// Photograph the LIVE production site, not a local build, so there is
// no question about what is actually deployed.
import { chromium } from "playwright";
const B = "https://terrameasurev2.onrender.com";
const OUT = new URL("./ux-shots/", import.meta.url).pathname.replace(/^\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(B + "/", { waitUntil: "domcontentloaded" });
await sleep(9000);
await page.screenshot({ path: `${OUT}LIVE-landing.png` });
// And one of the pages that has NOT been restyled yet, for comparison.
for (const [path, name] of [["/saved", "LIVE-saved"], ["/auth", "LIVE-auth"], ["/photo", "LIVE-groundtruth"]]) {
  await page.goto(B + path, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  await page.screenshot({ path: `${OUT}${name}.png` });
}
await browser.close();
console.log("live shots written");
