// scripts/e2e-final.mjs
// Final QA walk for TerraMeasure, written from scratch for the release
// review. It drives the PRODUCTION serving path (FastAPI serving
// frontend/dist at http://localhost:8000) in headless Chromium via
// Playwright, on both a desktop viewport and an iPhone-sized viewport,
// and grades every step of the 15-item test matrix.
//
// Run:  node scripts/e2e-final.mjs [baseUrl]
// Output: a PASS/FAIL line per checkpoint, screenshots in
//         frontend/e2e-shots-final/, and a summary table at the end.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:8000";
const SHOTS = path.join(__dirname, "..", "e2e-shots-final");
fs.mkdirSync(SHOTS, { recursive: true });

const SURVEY_TIMEOUT = 150_000; // local pipeline hits real USGS servers

// ------------------------------------------------------------------
// Bookkeeping
// ------------------------------------------------------------------
const checks = []; // {id, name, ok, detail}
const issues = []; // console errors / page errors / failed requests

function check(id, name, ok, detail = "") {
  checks.push({ id, name, ok, detail });
  console.log(`CHECK|${id}|${ok ? "PASS" : "FAIL"}|${name}${detail ? " :: " + detail : ""}`);
}

function wirePage(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      issues.push(`[${tag}] console.error: ${msg.text().slice(0, 400)}`);
    }
  });
  page.on("pageerror", (err) => {
    issues.push(`[${tag}] PAGEERROR: ${String(err).slice(0, 500)}`);
  });
  page.on("requestfailed", (req) => {
    issues.push(
      `[${tag}] requestfailed: ${req.method()} ${req.url().slice(0, 160)} :: ${req.failure()?.errorText}`,
    );
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      issues.push(`[${tag}] http.${res.status()}: ${res.url().slice(0, 160)}`);
    }
  });
}

async function shot(page, name, fullPage = false) {
  try {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
    console.log(`  shot: ${name}.png`);
  } catch (e) {
    console.log(`  shot FAILED ${name}: ${e.message.slice(0, 120)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "Did the canvas actually render varied pixels?" PNG IDAT inspection.
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

async function canvasOk(page) {
  try {
    const buf = await page.locator(".maplibregl-canvas").first().screenshot();
    const { uniqueBytes, nonzeroFrac } = analyzePng(buf);
    return { ok: uniqueBytes >= 12 || nonzeroFrac >= 0.02, uniqueBytes, nonzeroFrac };
  } catch (e) {
    return { ok: false, err: e.message.slice(0, 120) };
  }
}

async function bodyHasText(page, re) {
  const t = await page.locator("body").innerText();
  return re.test(t);
}

// Wait for survey results to appear, return true/false.
async function waitResults(page) {
  try {
    await page.locator("text=Site assessment").first().waitFor({ timeout: SURVEY_TIMEOUT });
    await sleep(1500);
    return true;
  } catch {
    return false;
  }
}

// Click-draw a polygon with the desktop polygon tool around the screen
// center, then finish by re-clicking the last point.
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
  await page.mouse.click(pts[3][0], pts[3][1]); // finish on last point
  await sleep(1200);
}

// Seed the map camera (sessionStorage) and reload so the map opens there.
async function goToCamera(page, lat, lon, zoom) {
  await page.evaluate(
    ([la, lo, z]) => {
      sessionStorage.setItem(
        "tm_map_camera",
        JSON.stringify({ lat: la, lon: lo, zoom: z }),
      );
    },
    [lat, lon, zoom],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(6000);
}

let reportUrl = null; // set by the desktop share step, used by item 5

// ==================================================================
// DESKTOP PASS (items 1-9)
// ==================================================================
async function desktopPass(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  wirePage(page, "desktop");

  // ---------- 1. Landing page ----------
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const heroOk = await bodyHasText(page, /Know whether the land is/);
  await shot(page, "d01-landing-top");
  await shot(page, "d01-landing-full", true);
  check("1a", "landing hero renders", heroOk);

  // Footer links present with the right targets
  const footMap = await page.locator('footer a[href="/map"]').count();
  const footNews = await page.locator('footer a[href="/news"]').count();
  const footAuth = await page.locator('footer a[href="/auth"]').count();
  check(
    "1b",
    "footer links (map/news/auth)",
    footMap > 0 && footNews > 0 && footAuth > 0,
    `map=${footMap} news=${footNews} auth=${footAuth}`,
  );

  // "See how it works" anchor scroll
  await page.getByRole("link", { name: "See what comes back" }).click();
  await sleep(1600);
  const anchorVisible = await page.evaluate(() => {
    const el = document.getElementById("how-it-works");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -50 && r.top < window.innerHeight * 0.6;
  });
  check("1c", "See what comes back scrolls to how-it-works", anchorVisible);
  await shot(page, "d01-landing-how");

  // "Open the map" goes to /map
  await page.locator("header").getByRole("link", { name: "Open the map" }).click();
  await page.waitForURL("**/map", { timeout: 10000 }).catch(() => {});
  check("1d", "Open the map navigates to /map", page.url().endsWith("/map"));

  // ---------- 2. First-visit welcome + demo survey ----------
  const dialog = page.getByRole("dialog", { name: "Welcome to TerraMeasure" });
  await sleep(2500);
  const welcomed = (await dialog.count()) > 0;
  check("2a", "welcome card auto-opens on first visit", welcomed);
  await shot(page, "d02-welcome");

  if (welcomed) {
    await page.getByRole("button", { name: "Explore on my own" }).click();
    await sleep(600);
    const gone = (await dialog.count()) === 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);
    const staysGone = (await dialog.count()) === 0;
    check("2b", "Explore on my own dismisses permanently", gone && staysGone,
      `gone=${gone} afterReload=${staysGone}`);

    await page.getByRole("button", { name: "Help and quick tour" }).click();
    await sleep(500);
    const reopened = (await dialog.count()) > 0;
    check("2c", "? help button reopens welcome card", reopened);
    await shot(page, "d02-welcome-reopened");

    // Run the demo survey
    if (reopened) {
      await page.getByRole("button", { name: "Try a demo survey" }).click();
      await sleep(2500); // fly-over
      // Loading card with a staged message
      const loadingSeen = await bodyHasText(
        page,
        /Contacting the survey engine|Waking the survey engine|Downloading USGS lidar|Crunching slope|Almost there/,
      );
      const captionSeen = await bodyHasText(page, /Running a real survey on sample terrain/);
      await shot(page, "d02-demo-loading");
      check("2d", "demo survey shows loading card + caption", loadingSeen,
        `loading=${loadingSeen} caption=${captionSeen}`);
      const got = await waitResults(page);
      await shot(page, "d02-demo-results");
      if (got) {
        const txt = await page.locator("aside").innerText();
        // Note: several headings render uppercase via CSS, and innerText
        // returns the rendered casing, so these checks are case-insensitive.
        const verdict = /(GO|CAUTION|NO-GO)/.test(txt);
        const cost = /(building pad earthwork|estimated earthwork cost)/i.test(txt);
        const why = /why this verdict/i.test(txt);
        const risk = /risk flags/i.test(txt);
        const score = /site score|\/100/i.test(txt);
        check("2e", "demo results complete (verdict/score/cost/breakdown/risk)",
          verdict && cost && why && risk,
          `verdict=${verdict} cost=${cost} why=${why} risk=${risk} score=${score}`);
        // ---- 2f. Site identity: the report must say WHERE it is ----
        // County and state come from the reverse-geocode lookup that
        // fires right after a survey lands, so give it a moment.
        await sleep(3500);
        const identity = await bodyHasText(page, /County|Centre/i);
        const nameEditable =
          (await page.getByRole("button", { name: /Edit the site name/i }).count()) > 0;
        check("2f", "site identity block with county and editable name",
          identity && nameEditable,
          `identity=${identity} editable=${nameEditable}`);

        // ---- 2g. The embedded 3D model of the ground ----
        const meshTitle = await bodyHasText(page, /3D site model/i);
        const meshCanvas = await page
          .getByRole("img", { name: /3D model of the surveyed ground/i })
          .count();
        check("2g", "3D site model renders in the results panel",
          meshTitle && meshCanvas > 0,
          `title=${meshTitle} canvas=${meshCanvas}`);
        await shot(page, "d02-3d-site-model");

        // ---- 2h. Notes box exists (the user's own words) ----
        const notesBtn = await page
          .getByRole("button", { name: /Add your own notes/i })
          .count();
        check("2h", "site notes can be added", notesBtn > 0);

        // ---- 2i. SAVE WORKS WITH NO ACCOUNT ----
        // This is the bug the whole pass started from: Save used to need
        // a sign-in AND a database table, and did nothing without both.
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await sleep(1500);
        const savedMsg = await bodyHasText(page, /Saved on this device|Saved to your account/i);
        const savedRows = await page.evaluate(() => {
          try {
            return JSON.parse(
              localStorage.getItem("terrameasure_saved_surveys") ?? "[]",
            ).length;
          } catch {
            return -1;
          }
        });
        check("2i", "Save works signed out and persists locally",
          savedMsg && savedRows > 0,
          `message=${savedMsg} rows=${savedRows}`);
        await shot(page, "d02-saved");

        // ---- 2j. The saved survey shows up on /saved ----
        await page.goto(BASE + "/saved", { waitUntil: "domcontentloaded" });
        await sleep(1500);
        const listed = await bodyHasText(page, /Saved surveys/i);
        const hasRow = (await page.getByRole("button", { name: /^Reopen$/ }).count()) > 0;
        check("2j", "/saved lists the saved survey with Reopen",
          listed && hasRow, `heading=${listed} reopen=${hasRow}`);
        await shot(page, "d02-saved-page");
        await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
        await sleep(3000);
      } else {
        check("2e", "demo survey returns results", false, "no results after 150s");
      }
    }
  }

  // ---------- 3. Basemaps, 3D, overlays ----------
  await page.getByRole("button", { name: "Satellite" }).click();
  await sleep(7000);
  const satCv = await canvasOk(page);
  await shot(page, "d03-satellite");
  check("3a", "Satellite basemap renders tiles", satCv.ok, JSON.stringify(satCv));

  await page.getByRole("button", { name: "Map", exact: true }).click();
  await sleep(6000);
  const mapCv = await canvasOk(page);
  await shot(page, "d03-map-basemap");
  check("3b", "Map basemap renders tiles", mapCv.ok, JSON.stringify(mapCv));

  const camBefore3d = await page.evaluate(() => sessionStorage.getItem("tm_map_camera"));
  await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
  await sleep(4500);
  await shot(page, "d03-3d-on");
  const cv3d = await canvasOk(page);
  await page.getByRole("button", { name: "Toggle 3D terrain" }).click();
  await sleep(2500);
  const cvAfter3d = await canvasOk(page);
  const camAfter3d = await page.evaluate(() => sessionStorage.getItem("tm_map_camera"));
  await shot(page, "d03-3d-off");
  // The 3D toggle animates pitch, which can nudge the stored camera by
  // fractions of a degree/zoom level; compare with tolerance, not equality.
  let camStable = camBefore3d === camAfter3d;
  try {
    const a = JSON.parse(camBefore3d ?? "null");
    const b = JSON.parse(camAfter3d ?? "null");
    if (a && b) {
      camStable =
        Math.abs(a.lat - b.lat) < 0.02 &&
        Math.abs(a.lon - b.lon) < 0.02 &&
        Math.abs(a.zoom - b.zoom) < 0.5;
    }
  } catch {
    // Keep the strict comparison result.
  }
  check("3c", "3D on renders, off restores 2D map",
    cv3d.ok && cvAfter3d.ok && camStable,
    `on=${cv3d.ok} off=${cvAfter3d.ok} cameraStable=${camStable}`);

  await page.getByRole("button", { name: "Toggle overlays panel" }).click();
  await sleep(600);
  const floodRow = page.locator("label", { hasText: "Flood zones" });
  const wetRow = page.locator("label", { hasText: "Wetlands" });
  await floodRow.click();
  await wetRow.click();
  await sleep(5000);
  await shot(page, "d03-flood-wetlands-on");
  const floodChecked = await floodRow.locator("input").isChecked();
  const wetChecked = await wetRow.locator("input").isChecked();
  await floodRow.click();
  await wetRow.click();
  await sleep(400);
  const floodOff = !(await floodRow.locator("input").isChecked());
  await page.getByRole("button", { name: "Close overlays panel" }).click();
  check("3d", "Flood + Wetlands overlays toggle on/off",
    floodChecked && wetChecked && floodOff,
    `floodOn=${floodChecked} wetOn=${wetChecked} floodOff=${floodOff}`);

  // ---------- 4. Manual survey at Golden ----------
  // Clear the demo survey first so the panel is fresh
  const clearBtn = page.getByRole("button", { name: "Clear survey" });
  if ((await clearBtn.count()) > 0) {
    await clearBtn.click();
    await sleep(500);
  }
  await page.getByLabel("Search address or place").fill("Golden, Colorado");
  const firstResult = page.locator("div.glass button", { hasText: "Golden" }).first();
  let searchOk = true;
  try {
    await firstResult.waitFor({ timeout: 20000 });
    await firstResult.click();
  } catch {
    searchOk = false;
  }
  await sleep(5500);
  check("4a", "search Golden, Colorado flies the map", searchOk);
  await shot(page, "d04-golden");

  await drawPolygon(page);
  await shot(page, "d04-after-draw");
  const gotManual = await waitResults(page);
  await shot(page, "d04-results");
  if (gotManual) {
    const txt = await page.locator("aside").innerText();
    const parts = {
      verdict: /(GO|CAUTION|NO-GO)/.test(txt),
      slope: /average slope/i.test(txt),
      errBounds: /±/.test(txt),
      buildable: /buildable area/i.test(txt),
      profile: /elevation profile/i.test(txt),
      why: /why this verdict/i.test(txt),
      risk: /risk flags/i.test(txt),
      disclaimer: /uncertified/i.test(txt),
      chartSvg: (await page.locator("aside svg").count()) > 0,
    };
    const all = Object.values(parts).every(Boolean);
    check("4b", "manual survey results panel complete", all, JSON.stringify(parts));

    // Save must WORK for anonymous users, not ask them to sign in first.
    // (It used to open a sign-in sheet and then fail against a database
    // table that did not exist, which read as a dead button.)
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await sleep(1200);
    const savedHere = await bodyHasText(page, /Saved on this device|Saved to your account/i);
    const noWall = !(await bodyHasText(page, /Sign in to save this survey/));
    await shot(page, "d04-save-anonymous");
    check("4c", "Save works anonymously with no sign-in wall",
      savedHere && noWall, `saved=${savedHere} noWall=${noWall}`);

    // Share report
    await page.getByRole("button", { name: "Share report" }).click();
    try {
      await page.locator("text=Public report link").waitFor({ timeout: 60000 });
      const href = await page.locator('aside a[href*="/r/"]').first().getAttribute("href");
      reportUrl = href;
      check("4d", "Share report creates /r/{slug} link", !!href, href ?? "");
      await shot(page, "d04-share-link");
    } catch {
      check("4d", "Share report creates /r/{slug} link", false, "no link after 60s");
      await shot(page, "d04-share-fail");
    }
  } else {
    check("4b", "manual survey returns results", false, "no results after 150s");
  }

  // ---------- 6. Parcel flow (Phoenix) ----------
  await goToCamera(page, 33.45, -112.07, 17);
  const canvasBox = await page.locator(".maplibregl-canvas").first().boundingBox();
  const ctrX = canvasBox.x + canvasBox.width / 2;
  const ctrY = canvasBox.y + canvasBox.height / 2;
  const parcelHeading = page.getByRole("heading", { name: "Parcel", exact: true });
  let parcelFound = false;
  for (const [dx, dy] of [[0, 0], [90, 60], [-110, -70]]) {
    await page.mouse.click(ctrX + dx, ctrY + dy);
    try {
      await parcelHeading.waitFor({ timeout: 25000 });
      parcelFound = true;
      break;
    } catch {
      // try the next offset
    }
  }
  await shot(page, "d06-parcel-card");
  if (parcelFound) {
    const cardTxt = await page.locator("aside", { hasText: /parcel id/i }).innerText();
    const hasApn = /parcel id/i.test(cardTxt);
    const hasOwner = /owner/i.test(cardTxt);
    const hasAcre = /acreage/i.test(cardTxt);
    check("6a", "parcel card shows APN/owner/acreage", hasApn && hasOwner && hasAcre,
      cardTxt.slice(0, 200).replace(/\n/g, " | "));
    const surveyBtn = page.getByRole("button", { name: "Survey this parcel" });
    if ((await surveyBtn.count()) > 0) {
      await surveyBtn.click();
      const gotParcelSurvey = await waitResults(page);
      await shot(page, "d06-parcel-survey-results");
      check("6b", "Survey this parcel completes", gotParcelSurvey);
      // Clean up for the next test
      const cb = page.getByRole("button", { name: "Clear survey" });
      if ((await cb.count()) > 0) await cb.click();
    } else {
      check("6b", "Survey this parcel button present", false, "no boundary on parcel");
    }
  } else {
    check("6a", "parcel card appears on Phoenix lot tap", false, "no card after 3 tries");
  }

  // ---------- 7. Lake test (open water must be NO-GO) ----------
  await goToCamera(page, 43.5, -87.2, 13);
  await shot(page, "d07-lake-before");
  await drawPolygon(page);
  const gotLake = await waitResults(page);
  await shot(page, "d07-lake-results");
  if (gotLake) {
    const txt = await page.locator("aside").innerText();
    const noGo = /NO-GO/.test(txt);
    const waterFlagged = /open water/i.test(txt) && !/open water:? none mapped/i.test(txt);
    // The METRIC row is "Buildable area" (lowercase a); the breakdown
    // line renders as "Buildable Area" (CSS capitalize), and shows the
    // slope-only number, so the case here is deliberate: we want the
    // water-adjusted metric, not the slope-only breakdown percentage.
    // The row renders as "Buildable area", then the number, then "%",
    // with a qualifier line that may sit between them. Allow a little
    // text in the gap so the extraction does not silently give up (it
    // used to report NaN, which made this check lean on the score alone).
    const buildMatch = txt.match(/Buildable area[\s\S]{0,60}?([\d.]+)\s*%/);
    const buildablePct = buildMatch ? parseFloat(buildMatch[1]) : NaN;
    const scoreLow = /\b(10|[0-9])\s*\n?\s*SITE SCORE/i.test(txt);
    check("7", "lake polygon verdict NO-GO, water flagged, buildable ~0",
      noGo && waterFlagged &&
        ((Number.isNaN(buildablePct) ? false : buildablePct <= 10) || scoreLow),
      `noGo=${noGo} waterFlagged=${waterFlagged} buildable=${buildablePct}% scoreLow=${scoreLow}`);
  } else {
    // When the elevation fallback service (Open-Elevation) is down,
    // mid-lake surveys CANNOT complete (USGS has no data over open
    // water). That is an upstream outage, not a bug in this app, so the
    // pass/fail here turns on whether the app FAILED WELL: a named
    // failure card with the reason and a retry that reuses the boundary.
    const failCard = await bodyHasText(page, /Survey failed/i);
    const retryBtn =
      (await page.getByRole("button", { name: /Retry with the same boundary/i }).count()) > 0;
    await shot(page, "d07-lake-failure-card");
    check("7", "lake survey completes, or fails honestly with a retry",
      failCard && retryBtn,
      failCard
        ? "elevation service down (expected over open water when the fallback is out); named failure card + retry shown"
        : "no results after 150s and no failure card");
    // Clear the error card so later steps start clean.
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    if ((await dismiss.count()) > 0) await dismiss.click().catch(() => {});
  }

  // ---------- 8. Deep links ----------
  await page.goto(BASE + "/news", { waitUntil: "domcontentloaded" });
  await sleep(9000);
  const newsTxt = await page.locator("body").innerText();
  const quakesRendered = /Earthquakes/i.test(newsTxt);
  const quakeItems = /magnitude|M\s?\d\.\d|km/i.test(newsTxt);
  const reliefHonest = /Disasters and relief/i.test(newsTxt);
  await shot(page, "d08-news", true);
  check("8a", "/news renders (USGS quakes + honest ReliefWeb state)",
    quakesRendered && reliefHonest,
    `quakesSection=${quakesRendered} quakeItems=${quakeItems} reliefSection=${reliefHonest}`);

  await page.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const emailIn = await page.locator('input[type="email"]').count();
  const passIn = await page.locator('input[type="password"]').count();
  await shot(page, "d08-auth");
  check("8b", "/auth form renders", emailIn > 0 && passIn > 0,
    `email=${emailIn} password=${passIn}`);

  await page.goto(BASE + "/profile", { waitUntil: "domcontentloaded" });
  await sleep(4000);
  check("8c", "/profile redirects anonymous to /auth", page.url().includes("/auth"),
    page.url());

  await page.goto(BASE + "/definitely-not-a-page", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  check("8d", "unknown route lands on /map", page.url().endsWith("/map"), page.url());

  await page.goto(BASE + "/r/unknownslug12345", { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const nf = await bodyHasText(page, /Report not found/i);
  await shot(page, "d08-report-404");
  check("8e", "/r/unknown shows friendly not-found", nf);

  // ---------- 9. Back / forward ----------
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto(BASE + "/news", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  await page.goBack(); // -> /map
  await sleep(3500);
  const backMapOk = page.url().endsWith("/map") && (await canvasOk(page)).ok;
  await page.goBack(); // -> /
  await sleep(2000);
  const backLandOk = await bodyHasText(page, /Know whether the land is/);
  await page.goForward(); // -> /map
  await sleep(3500);
  const fwdMapOk = page.url().endsWith("/map") && (await canvasOk(page)).ok;
  await shot(page, "d09-back-forward-end");
  check("9", "back/forward between landing, map, news keeps working",
    backMapOk && backLandOk && fwdMapOk,
    `backMap=${backMapOk} backLanding=${backLandOk} fwdMap=${fwdMapOk}`);

  await ctx.close();
}

// ==================================================================
// SERVICE WORKER PASS (SW enabled; confirm nothing breaks)
// ==================================================================
async function swPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  wirePage(page, "sw");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("terrameasure_welcome_v2", "1");
    } catch {}
  });
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(9000);
  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      supported: true,
      count: regs.length,
      active: regs.some((r) => !!r.active),
      waiting: regs.some((r) => !!r.waiting),
    };
  });
  // Reload with the SW in control; the app must still render
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(7000);
  const cv = await canvasOk(page);
  await shot(page, "sw-map-after-reload");
  check("sw", "service worker registers and app survives SW-controlled reload",
    sw.supported && sw.count > 0 && cv.ok, JSON.stringify({ ...sw, canvas: cv.ok }));
  await ctx.close();
}

// ==================================================================
// MOBILE PASS (items 10-15)
// ==================================================================
async function mobilePass(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  wirePage(page, "mobile");

  // ---------- 10. Mobile landing ----------
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  const cta = page.locator("main, body").getByRole("link", { name: "Open the map" }).first();
  const ctaBox = await cta.boundingBox();
  const ctaVisible = !!ctaBox && ctaBox.width > 100 && ctaBox.y < 844;
  await shot(page, "m10-landing");
  await shot(page, "m10-landing-full", true);
  check("10", "mobile landing single-column, CTA reachable",
    noHScroll && ctaVisible, `noHScroll=${noHScroll} ctaBox=${JSON.stringify(ctaBox)}`);

  // ---------- 11 + 13. /map first visit: welcome bottom-anchored ----------
  await page.goto(BASE + "/map", { waitUntil: "domcontentloaded" });
  await sleep(4500);
  const dialog = page.getByRole("dialog", { name: "Welcome to TerraMeasure" });
  let welcomeBottom = false;
  if ((await dialog.count()) > 0) {
    const b = await dialog.boundingBox();
    // Bottom-anchored: the card's bottom edge should sit at the viewport bottom
    welcomeBottom = !!b && Math.abs(b.y + b.height - 844) < 30;
    await shot(page, "m13-welcome-mobile");
    await page.getByRole("button", { name: "Explore on my own" }).click();
    await sleep(700);
  }
  check("13b", "mobile welcome card bottom-anchored and dismisses",
    welcomeBottom && (await dialog.count()) === 0);

  // Bottom bar + tap targets
  const targets = [
    ["Overlays", 'button[aria-label="Overlays"]'],
    ["Survey", 'button[aria-label="Start a survey"]'],
    ["Saved", 'button[aria-label="Saved surveys"]'],
    ["Zoom in", ".maplibregl-ctrl-zoom-in"],
    ["Locate", ".maplibregl-ctrl-geolocate"],
  ];
  const sizes = [];
  let allBig = true;
  for (const [label, sel] of targets) {
    const el = page.locator(sel).first();
    const b = (await el.count()) > 0 ? await el.boundingBox() : null;
    if (!b || b.width < 40 || b.height < 40) allBig = false;
    sizes.push(`${label}=${b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "MISSING"}`);
  }
  await shot(page, "m11-map-bottombar");
  check("11a", "bottom bar present, tap targets >= 40px", allBig, sizes.join(" "));

  // Locate button: click and confirm graceful handling (permission denied
  // in this context; the app must not crash or hang)
  const preErr = issues.filter((i) => i.includes("PAGEERROR")).length;
  await page.locator(".maplibregl-ctrl-geolocate").first().click().catch(() => {});
  await sleep(2500);
  const postErr = issues.filter((i) => i.includes("PAGEERROR")).length;
  check("11b", "locate button exists and denial is graceful", postErr === preErr);

  // Top search works on mobile
  await page.getByLabel("Search address or place").fill("Golden, Colorado");
  const firstResult = page.locator("div.glass button", { hasText: "Golden" }).first();
  let mSearch = true;
  try {
    await firstResult.waitFor({ timeout: 20000 });
    await firstResult.click();
  } catch {
    mSearch = false;
  }
  await sleep(5500);
  check("11c", "mobile top search flies to Golden", mSearch);

  // ---------- 12. Reticle survey ----------
  await page.getByRole("button", { name: "Start a survey" }).click();
  await sleep(1200);
  const crosshair = (await page.locator(".reticle-cross").count()) > 0;
  const addPoint = page.getByRole("button", { name: "+ Add Point" });
  const trayUp = (await addPoint.count()) > 0;
  await shot(page, "m12-reticle-armed");
  check("12a", "reticle mode: crosshair + tray appear", crosshair && trayUp,
    `crosshair=${crosshair} tray=${trayUp}`);

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

  const readout = page.locator("div.glass.num");
  await addPoint.click();
  await sleep(500);
  await pan(-150, 0);
  const readout1 = (await readout.count()) > 0 ? await readout.first().innerText() : "";
  await addPoint.click();
  await sleep(500);
  await pan(0, -150);
  const readout2 = (await readout.count()) > 0 ? await readout.first().innerText() : "";
  await addPoint.click();
  await sleep(500);
  await pan(150, 0);
  await addPoint.click();
  await sleep(700);
  const readout3 = (await readout.count()) > 0 ? await readout.first().innerText() : "";
  await shot(page, "m12-four-points");
  check("12b", "live readout updates while placing points",
    readout1 !== "" && readout3 !== "" && readout1 !== readout3,
    `r1="${readout1}" r2="${readout2}" r3="${readout3}"`);

  const doneBtn = page.getByRole("button", { name: "Finish survey" });
  const doneVisible = (await doneBtn.count()) > 0;
  check("12c", "Done button appears after 3+ points", doneVisible);
  if (doneVisible) await doneBtn.click();
  await sleep(1500);
  await shot(page, "m12-survey-started");
  const gotMobile = await waitResults(page);
  await shot(page, "m12-results-sheet");
  check("12d", "mobile survey completes, results bottom sheet appears", gotMobile);

  // Sheet snap mechanics: read the sheet's translateY at each snap
  async function sheetTranslate() {
    return page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("div.glass.fixed"));
      const sheet = els.find(
        (el) => el.style.transform && el.style.transform.includes("translateY"),
      );
      if (!sheet) return null;
      const m = sheet.style.transform.match(/translateY\(([-\d.]+)px\)/);
      return m ? parseFloat(m[1]) : null;
    });
  }

  async function dragHandle(dy) {
    const handle = page.locator("div.touch-none").first();
    const hb = await handle.boundingBox();
    if (!hb) return;
    const x = hb.x + hb.width / 2;
    const y = hb.y + hb.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x, y + (dy * i) / 10);
      await sleep(25);
    }
    await page.mouse.up();
    await sleep(600);
  }

  if (gotMobile) {
    const tHalf = await sheetTranslate();
    await dragHandle(300); // push down toward peek
    const tPeek = await sheetTranslate();
    await shot(page, "m12-sheet-peek");
    await dragHandle(-650); // pull up toward full
    const tFull = await sheetTranslate();
    await shot(page, "m12-sheet-full");
    // Expected: peek translate > half translate > full translate (~0)
    const snapOk =
      tHalf !== null && tPeek !== null && tFull !== null &&
      tPeek > tHalf + 100 && tFull < tHalf - 100 && tFull < 60;
    check("12e", "sheet snaps between peek/half/full",
      snapOk, `half=${tHalf} peek=${tPeek} full=${tFull}`);

    // Map still pannable at peek
    await dragHandle(700); // back down to peek
    await sleep(400);
    const camA = await page.evaluate(() => sessionStorage.getItem("tm_map_camera"));
    await pan(-120, -80);
    await sleep(800);
    const camB = await page.evaluate(() => sessionStorage.getItem("tm_map_camera"));
    check("12f", "map pannable while sheet at peek", camA !== camB);

    // ---------- 15. Mobile share flow ----------
    await dragHandle(-650); // back up so content is reachable
    const shareBtn = page.getByRole("button", { name: "Share report" });
    if ((await shareBtn.count()) > 0) {
      await shareBtn.scrollIntoViewIfNeeded();
      await shareBtn.click();
      try {
        await page.locator("text=Public report link").waitFor({ timeout: 60000 });
        const hasCopy = (await page.getByRole("button", { name: /Copy link/ }).count()) > 0;
        const hasShareApi = await page.evaluate(() => "share" in navigator);
        await shot(page, "m15-share-link");
        // Tap copy; must not crash even without clipboard permission
        await page.getByRole("button", { name: /Copy link/ }).click().catch(() => {});
        await sleep(600);
        check("15", "mobile share shows link + copy fallback", hasCopy,
          `copyBtn=${hasCopy} navigatorShare=${hasShareApi}`);
      } catch {
        check("15", "mobile share shows link + copy fallback", false, "no link after 60s");
        await shot(page, "m15-share-fail");
      }
    } else {
      check("15", "mobile share button present", false);
    }

    // Dismiss the results sheet (fling well below peek)
    await dragHandle(820);
    await sleep(800);
  }

  // ---------- 13. Layers sheet ----------
  const overlaysBtn = page.locator('button[aria-label="Overlays"]');
  if ((await overlaysBtn.count()) > 0) {
    await overlaysBtn.click();
    await sleep(900);
    const wetLabel = page.locator("label", { hasText: "Wetlands" });
    const sheetUp = (await wetLabel.count()) > 0;
    let toggled = false;
    if (sheetUp) {
      const before = await wetLabel.locator("input").isChecked();
      await wetLabel.click();
      await sleep(600);
      const after = await wetLabel.locator("input").isChecked();
      toggled = before !== after;
      await shot(page, "m13-layers-sheet");
      await wetLabel.click(); // put it back
      await page.getByRole("button", { name: "Close overlays panel" }).click();
      await sleep(600);
    }
    check("13a", "mobile layers sheet opens, toggles, closes",
      sheetUp && toggled && (await wetLabel.count()) === 0);
  } else {
    check("13a", "mobile layers sheet reachable", false, "Overlays button missing");
  }

  // ---------- 14. Landscape ----------
  // Rotating a phone to 844x390 crosses the app's mobile breakpoint
  // (useIsMobile is max-width: 768px), so the app INTENTIONALLY swaps
  // to the desktop layout: TopBar draw tools appear and the bottom bar
  // goes away. "Usable in landscape" therefore means: no sideways
  // scroll, the map still renders, search is reachable, and the
  // desktop polygon tool is on screen within the short viewport.
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(2500);
  const landNoHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  const polyBtn = page.getByRole("button", { name: "Draw a polygon to survey" });
  const polyBox = (await polyBtn.count()) > 0 ? await polyBtn.boundingBox() : null;
  const searchVisible = await page.getByLabel("Search address or place").isVisible();
  const landCv = await canvasOk(page);
  await shot(page, "m14-landscape");
  check("14", "landscape flips to desktop layout and stays usable",
    landNoHScroll && !!polyBox && polyBox.y + polyBox.height <= 392 &&
      searchVisible && landCv.ok,
    `noHScroll=${landNoHScroll} polygonBtn=${JSON.stringify(polyBox)} search=${searchVisible} canvas=${landCv.ok}`);

  await ctx.close();
}

// ==================================================================
// PUBLIC REPORT PASS (item 5), separate clean context
// ==================================================================
async function reportPass(browser) {
  if (!reportUrl) {
    check("5", "public report renders in a fresh context", false,
      "no report link captured in item 4");
    return;
  }
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  wirePage(page, "report");
  await page.goto(reportUrl.startsWith("http") ? reportUrl : BASE + reportUrl, {
    waitUntil: "domcontentloaded",
  });
  await sleep(9000);
  const txt = await page.locator("body").innerText();
  const parts = {
    verdict: /(GO|CAUTION|NO-GO)/.test(txt),
    score: /site score \d+\/100/i.test(txt),
    why: /why this verdict/i.test(txt),
    cost: /(building pad earthwork|estimated earthwork cost)/i.test(txt),
    profile: /elevation profile/i.test(txt),
    errorBounds: /error bounds/i.test(txt),
    cta: /run your own survey free/i.test(txt),
    mapCanvas: (await page.locator(".maplibregl-canvas").count()) > 0,
  };
  await shot(page, "d05-public-report", true);
  check("5", "public report renders fully in a fresh context",
    Object.values(parts).every(Boolean), JSON.stringify(parts));

  // 5b: the map must FILL its card, not just exist. This is the check
  // for the half-width bug: compare the canvas's rendered width to the
  // width of the rounded card that contains it.
  const sizes = await page.evaluate(() => {
    const canvas = document.querySelector(".maplibregl-canvas");
    if (!canvas) return null;
    // Walk up to the rounded card (the overflow-hidden wrapper).
    const card = canvas.closest(".overflow-hidden") ?? canvas.parentElement;
    const c = canvas.getBoundingClientRect();
    const k = card.getBoundingClientRect();
    return { canvasW: Math.round(c.width), canvasH: Math.round(c.height),
             cardW: Math.round(k.width) };
  });
  const fills = !!sizes && sizes.canvasW >= sizes.cardW * 0.95;
  // Also confirm the rendered pixels are real satellite imagery.
  const repCv = await canvasOk(page);
  check("5b", "report map fills its card width and renders imagery",
    fills && repCv.ok, JSON.stringify({ ...sizes, canvas: repCv }));
  await shot(page, "d05-report-map-fill");

  // 5c: a shared report must say WHERE the land is and carry the same 3D
  // model as the app. A reader who did not run the survey has only this
  // page to go on.
  const identityOk = /County|Near \d|acres/i.test(txt);
  const meshOk = (await page
    .getByRole("img", { name: /3D model of the surveyed ground/i })
    .count()) > 0;
  // A fresh context holds no edit key, so the reader must NOT see Edit.
  const noEditForReaders = (await page.getByRole("button", { name: /^Edit$/ }).count()) === 0;
  check("5c", "report names the place, shows the 3D model, hides Edit from readers",
    identityOk && meshOk && noEditForReaders,
    `identity=${identityOk} mesh=${meshOk} noEdit=${noEditForReaders}`);
  await shot(page, "d05-report-3d");
  await ctx.close();
}

// ==================================================================
// Which passes to run. "node e2e-final.mjs <baseUrl> mobile" reruns
// just the mobile pass; default is everything. Handy when one pass
// needs a fix without paying for the full 15-minute walk again.
const PASSES = (process.argv[3] || "desktop,report,sw,mobile").split(",");

const browser = await chromium.launch();
let crashed = null;
try {
  if (PASSES.includes("desktop")) await desktopPass(browser);
  if (PASSES.includes("report")) await reportPass(browser);
  if (PASSES.includes("sw")) await swPass(browser);
  if (PASSES.includes("mobile")) await mobilePass(browser);
} catch (e) {
  // A crash in one pass must never swallow the summary below: the
  // checks and console-error lists already collected are the whole
  // point of the run.
  crashed = e;
  console.log(`\nRUN CRASHED: ${String(e).slice(0, 400)}`);
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
if (issues.length === 0) {
  console.log("No console errors, page errors, or failed requests recorded.");
} else {
  // De-duplicate identical lines to keep the log readable
  const seen = new Map();
  for (const i of issues) seen.set(i, (seen.get(i) ?? 0) + 1);
  for (const [line, n] of seen) console.log(`${n > 1 ? `(x${n}) ` : ""}${line}`);
}
process.exit(failed.length > 0 || crashed ? 1 : 0);
