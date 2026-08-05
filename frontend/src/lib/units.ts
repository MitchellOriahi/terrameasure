// lib/units.ts
// The one home for unit conversion and unit formatting.
//
// Why this file exists: the backend measures everything in metric
// (meters, square meters, cubic meters) because that is what the DEM
// math uses. But our audience is American: contractors bid in feet and
// cubic yards, and land is bought in acres. So the app DISPLAYS
// imperial by default, with a compact toggle back to metric.
//
// Ground rules, all enforced here so no screen can drift:
//   1. Area is always acres once a site is big enough (both systems).
//   2. Slope stays in degrees in both systems (an angle is an angle).
//   3. Volumes use REAL superscripts ("yd³", "m³"), never "m^3".
//   4. Error bounds convert together with their values, in the SAME
//      unit as the value, so "1,234 ± 56 yd³" always reads cleanly.
//   5. The choice persists in localStorage so it survives reloads.

import { fmt } from "./geo";

export type UnitSystem = "imperial" | "metric";

// ------------------------------------------------------------------
// Persistence: remember the user's choice across visits
// ------------------------------------------------------------------
export const UNITS_STORAGE_KEY = "terrameasure_units";

/** Read the saved preference; US audience means imperial by default. */
export function loadUnitSystem(): UnitSystem {
  try {
    const saved = localStorage.getItem(UNITS_STORAGE_KEY);
    if (saved === "metric" || saved === "imperial") return saved;
  } catch {
    // Private browsing or blocked storage: just use the default.
  }
  return "imperial";
}

/** Save the preference (ignore storage errors, they only cost memory). */
export function saveUnitSystem(u: UnitSystem): void {
  try {
    localStorage.setItem(UNITS_STORAGE_KEY, u);
  } catch {
    // Nothing to do; the in-memory choice still works this session.
  }
}

// ------------------------------------------------------------------
// The raw conversion factors (exact definitions, not approximations)
// ------------------------------------------------------------------
export const FT_PER_M = 3.28084; // 1 meter = 3.28084 feet
export const YD3_PER_M3 = 1.30795; // 1 cubic meter = 1.30795 cubic yards
export const M2_PER_ACRE = 4046.86; // 1 acre = 4,046.86 square meters
export const FT2_PER_M2 = FT_PER_M * FT_PER_M; // square feet per square meter

/** Meters to feet. */
export function mToFt(m: number): number {
  return m * FT_PER_M;
}

/** Cubic meters to cubic yards (the unit US earthwork is bid in). */
export function m3ToYd3(m3: number): number {
  return m3 * YD3_PER_M3;
}

/** A $/m³ rate to the $/CY (dollars per cubic yard) a contractor quotes. */
export function usdPerM3ToUsdPerYd3(rate: number): number {
  return rate / YD3_PER_M3;
}

// ------------------------------------------------------------------
// Real superscripts (punchlist rule: never "m^3" with a caret)
// ------------------------------------------------------------------
export const CUBIC_M = "m³"; // m³
export const CUBIC_YD = "yd³"; // yd³
export const SQ_M = "m²"; // m²
export const SQ_FT = "ft²"; // ft²

/**
 * Clean any caret-style units that arrive inside backend TEXT (notes
 * like "assumes $7 per m^3"). Numbers we format ourselves never need
 * this; free-text notes from older backends might.
 */
export function cleanUnitText(text: string): string {
  return text
    .replace(/m\^3|m3\b/g, CUBIC_M)
    .replace(/yd\^3|yd3\b/g, CUBIC_YD)
    .replace(/m\^2|m2\b/g, SQ_M)
    .replace(/ft\^2|ft2\b/g, SQ_FT);
}

// ------------------------------------------------------------------
// Formatting: a value AND its error bound, guaranteed same unit
// ------------------------------------------------------------------

/** A display-ready measurement: number string, error string, one unit. */
export interface UnitPair {
  value: string;
  err: string;
  unit: string;
}

/**
 * Elevations and elevation-like lengths (heights, ranges, accuracy).
 * Imperial: feet. Metric: meters. One decimal by default because DEM
 * heights are only good to a fraction of a meter anyway.
 */
export function elevationPair(
  m: number,
  errM: number,
  u: UnitSystem,
  decimals = 1,
): UnitPair {
  if (u === "imperial") {
    return {
      value: fmt(mToFt(m), decimals),
      err: fmt(mToFt(errM), decimals),
      unit: "ft",
    };
  }
  return { value: fmt(m, decimals), err: fmt(errM, decimals), unit: "m" };
}

/** One elevation number with no error (chart axis labels, notes). */
export function elevValue(m: number, u: UnitSystem, decimals = 0): string {
  return u === "imperial" ? fmt(mToFt(m), decimals) : fmt(m, decimals);
}

/** The short elevation unit word for the current system. */
export function elevUnit(u: UnitSystem): string {
  return u === "imperial" ? "ft" : "m";
}

/**
 * Ground distances (perimeter, profile distance). Imperial: feet, then
 * miles past about 2 miles (land pros talk in feet up to surprisingly
 * long distances). Metric: meters, then kilometers.
 */
export function distancePair(m: number, errM: number, u: UnitSystem): UnitPair {
  if (u === "imperial") {
    const ft = mToFt(m);
    if (ft >= 10_560) {
      // Past ~2 miles feet stop being readable; switch both numbers.
      return {
        value: fmt(ft / 5280, 2),
        err: fmt(mToFt(errM) / 5280, 2),
        unit: "mi",
      };
    }
    return { value: fmt(ft), err: fmt(mToFt(errM), 1), unit: "ft" };
  }
  if (m >= 1000) {
    return { value: fmt(m / 1000, 2), err: fmt(errM / 1000, 2), unit: "km" };
  }
  return { value: fmt(m), err: fmt(errM, 1), unit: "m" };
}

/**
 * Areas. Acres are the shared language of US land in BOTH systems (the
 * punchlist says keep acres), so any site over half an acre shows acres.
 * Below that, small areas show ft² (imperial) or m² (metric).
 */
export function areaPair(m2: number, errM2: number, u: UnitSystem): UnitPair {
  const acres = m2 / M2_PER_ACRE;
  if (acres >= 0.5) {
    return {
      value: fmt(acres, 2),
      err: fmt(errM2 / M2_PER_ACRE, 2),
      unit: "acres",
    };
  }
  if (u === "imperial") {
    return { value: fmt(m2 * FT2_PER_M2), err: fmt(errM2 * FT2_PER_M2), unit: SQ_FT };
  }
  return { value: fmt(m2), err: fmt(errM2), unit: SQ_M };
}

/**
 * Earthwork volumes. Imperial: cubic yards (what a dump truck holds and
 * what a grading bid quotes). Metric: cubic meters. Real superscripts.
 */
export function volumePair(m3: number, errM3: number, u: UnitSystem): UnitPair {
  if (u === "imperial") {
    return { value: fmt(m3ToYd3(m3)), err: fmt(m3ToYd3(errM3)), unit: CUBIC_YD };
  }
  return { value: fmt(m3), err: fmt(errM3), unit: CUBIC_M };
}
