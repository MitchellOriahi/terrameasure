// scripts/verify-fixes.mjs
// Targeted checks for the fixes made in this pass. Each one asserts the
// USER-VISIBLE behaviour, not the implementation, so it stays true if
// the code is refactored later.
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (id, desc, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${desc}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();

// ---------- Landing hero: the demo must still be draggable ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(8000);
  const readAcres = async () => {
    const t = await page.locator("body").innerText();
    const m = t.match(/([\d.]+)\s*\n?\s*acres/i);
    return m ? parseFloat(m[1]) : NaN;
  };
  const before = await readAcres();
  const handle = page.getByLabel("Corner 1, drag to move");
  const box = (await handle.count()) > 0 ? await handle.boundingBox() : null;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 - 60, { steps: 12 });
    await page.mouse.up();
    await sleep(900);
  }
  const after = await readAcres();
  check("A1", "landing demo corner drags and acreage updates",
    !!box && Number.isFinite(before) && Number.isFinite(after) && before !== after,
    `before=${before} after=${after} handle=${box ? Math.round(box.width) + "px" : "none"}`);
  check("A2", "corner handle is a 44px touch target",
    !!box && box.width >= 44 && box.height >= 44,
    box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "none");
  await ctx.close();
}

// ---------- Auth outage notice ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
  await sleep(8000);
  const txt = await page.locator("body").innerText();
  check("B1", "sign-in outage is explained in-app",
    /Sign-in is unavailable right now/i.test(txt) && /without an account/i.test(txt));
  // Pressing Google must NOT navigate away to a dead host.
  const urlBefore = page.url();
  const g = page.getByRole("button", { name: /Continue with Google/i });
  if (await g.count()) { await g.click(); await sleep(3000); }
  check("B2", "Google button does not leave the app when auth is down",
    page.url() === urlBefore, `url=${page.url()}`);
  await ctx.close();
}

// ---------- 3D panel must not trap page scroll ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(7000);
  const canvasTouch = await page.evaluate(() => {
    const c = document.querySelector("canvas[aria-label*='3D model']");
    if (!c) return { found: false };
    const box = c.parentElement;
    return {
      found: true,
      canvas: getComputedStyle(c).touchAction,
      wrapper: box ? getComputedStyle(box).touchAction : "n/a",
    };
  });
  check("C1", "only the 3D canvas swallows touch, not its container",
    canvasTouch.found && canvasTouch.canvas === "none" && canvasTouch.wrapper !== "none",
    JSON.stringify(canvasTouch));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass}/${pass + fail} verification checks passed`);
process.exit(fail ? 1 : 0);
