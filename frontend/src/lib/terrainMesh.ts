// lib/terrainMesh.ts
// A tiny 3D terrain renderer that draws the surveyed ground as a solid
// block you can spin, on a plain 2D canvas.
//
// WHY NOT USE THE MAP FOR THIS? The map's 3D mode (lib/site3d.ts) tilts
// the whole screen and drapes satellite imagery over the world. That is
// a great "walk the site" view, but it is the WHOLE WORLD, it needs
// tiles to download, and MapLibre v6 has a nasty black-screen bug around
// animated camera moves with terrain on. What the results panel wants is
// smaller and more honest: THIS parcel, cut out of the ground, floating
// in the dark, so the shape of the land is the only thing you look at.
//
// WHY NOT THREE.JS? A WebGL library would add a few hundred kilobytes to
// the download and a second WebGL context next to the map's, which is a
// real risk on older phones (browsers cap how many contexts a page may
// have). A height grid is a special, easy case: it never self-overlaps,
// so drawing its faces back-to-front with the painter's algorithm gives
// a correct picture with plain canvas 2D. Around 3,000 faces is nothing
// for a modern browser, and it works on every device with no fallback.
//
// The two halves of this file:
//   buildTerrainMesh() : survey response -> a small grid of heights,
//                        trimmed to the shape the user actually drew
//   renderTerrain()    : that grid + a camera angle -> pixels
// Both are pure functions with no React in them, so the component that
// uses them stays about gestures and buttons.

import type { SurveyResponse } from "@/lib/api";

/**
 * The only parts of a survey this renderer needs: the height grid, how
 * big a cell is, and where on earth the grid sits.
 *
 * Why not just take a whole SurveyResponse: the landing page draws a
 * small stored sample of real terrain that carries none of the score,
 * cost or context fields. Asking for exactly what we use lets both feed
 * the same renderer with no casting and no fake data.
 */
export type TerrainSource = Pick<
  SurveyResponse,
  "dem_grid" | "cell_size_m" | "dem_center_lat" | "dem_center_lon"
>;

// ------------------------------------------------------------------
// The mesh
// ------------------------------------------------------------------

export interface TerrainMesh {
  /** Grid size AFTER downsampling (points, not cells). */
  cols: number;
  rows: number;
  /** Metres between neighbouring grid points. */
  cell: number;
  /** Heights in metres, row-major, NaN where the ground is outside the
      drawn outline. Row 0 is the NORTHERNMOST row (same convention as
      the DEM everywhere else in the project). */
  z: Float32Array;
  /** Height range of the valid cells, in metres. */
  minZ: number;
  maxZ: number;
  /** How many valid (non-NaN) points survived the outline trim. */
  validCount: number;
}

/** A latitude/longitude corner of the drawn shape. */
export interface Vertex {
  lat: number;
  lon: number;
}

/**
 * Is a point inside a polygon? The classic ray-casting test: shoot a ray
 * east and count how many edges it crosses. Odd means inside. Runs once
 * per grid cell, so a few thousand cheap tests.
 */
function pointInPolygon(
  x: number,
  y: number,
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const crosses =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Turn a survey response into a small height grid shaped like the drawn
 * outline.
 *
 * Two things happen here:
 *
 * 1. DOWNSAMPLE. A survey can come back as a 70 x 70 grid, and drawing
 *    every cell of that at 60 frames a second on a phone is wasteful.
 *    We average blocks of cells down to at most `maxSide` per side.
 *    Averaging (rather than picking one cell) keeps the shape honest and
 *    quietly smooths the noise in the free elevation source.
 *
 * 2. TRIM TO THE OUTLINE. The API sends back a RECTANGLE of ground with
 *    the outside-the-polygon cells filled in with the average height
 *    (that fill exists only so the JSON has no NaN in it). If we drew
 *    that we would show a flat apron of fake ground around the real
 *    site. So we redo the same point-in-polygon test the backend does
 *    and mark the outside cells NaN, which the renderer skips. The
 *    result is a block shaped like the parcel, not a square.
 *
 * Returns null when the survey has no usable grid.
 */
export function buildTerrainMesh(
  survey: TerrainSource | null | undefined,
  vertices: Vertex[] | null | undefined,
  maxSide = 56,
): TerrainMesh | null {
  const grid = survey?.dem_grid;
  if (!survey || !Array.isArray(grid) || grid.length < 2) return null;
  const srcRows = grid.length;
  const srcCols = Array.isArray(grid[0]) ? grid[0].length : 0;
  if (srcCols < 2) return null;

  // ---- 1. Downsample by block averaging ----
  const step = Math.max(1, Math.ceil(Math.max(srcRows, srcCols) / maxSide));
  const rows = Math.max(2, Math.floor(srcRows / step));
  const cols = Math.max(2, Math.floor(srcCols / step));
  const z = new Float32Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = 0; dr < step; dr++) {
        const sr = r * step + dr;
        if (sr >= srcRows) break;
        const row = grid[sr];
        for (let dc = 0; dc < step; dc++) {
          const sc = c * step + dc;
          if (sc >= srcCols) break;
          const v = row[sc];
          if (typeof v === "number" && Number.isFinite(v)) {
            sum += v;
            n++;
          }
        }
      }
      z[r * cols + c] = n > 0 ? sum / n : NaN;
    }
  }

  const cell = survey.cell_size_m * step;

  // ---- 2. Trim to the drawn outline ----
  // Work in metres east/north from the DEM centre, exactly like
  // engine/measurements.py does, so the client and the server agree on
  // which ground belongs to the site.
  if (vertices && vertices.length >= 3 && Number.isFinite(survey.dem_center_lat)) {
    const mPerDegLat = 111_320;
    const mPerDegLon =
      111_320 * Math.cos((survey.dem_center_lat * Math.PI) / 180);
    const poly = vertices.map((v) => ({
      x: (v.lon - survey.dem_center_lon) * mPerDegLon,
      y: (v.lat - survey.dem_center_lat) * mPerDegLat,
    }));
    for (let r = 0; r < rows; r++) {
      // Row 0 is the northernmost row, so north (positive y) decreases
      // as r grows.
      const y = (rows / 2 - r - 0.5) * cell;
      for (let c = 0; c < cols; c++) {
        const x = (c - cols / 2 + 0.5) * cell;
        if (!pointInPolygon(x, y, poly)) z[r * cols + c] = NaN;
      }
    }
  }

  // ---- Height range of what survived ----
  let minZ = Infinity;
  let maxZ = -Infinity;
  let validCount = 0;
  for (let i = 0; i < z.length; i++) {
    const v = z[i];
    if (Number.isFinite(v)) {
      validCount++;
      if (v < minZ) minZ = v;
      if (v > maxZ) maxZ = v;
    }
  }

  // A shape so thin that the trim ate everything: fall back to the
  // untrimmed rectangle rather than showing an empty box. Better a
  // slightly generous view than a blank one.
  if (validCount < 8) {
    return buildTerrainMesh(survey, null, maxSide);
  }

  return { cols, rows, cell, z, minZ, maxZ, validCount };
}

// ------------------------------------------------------------------
// The camera
// ------------------------------------------------------------------

export interface TerrainView {
  /** Compass spin in radians. 0 puts north at the top. */
  yaw: number;
  /** Tilt in radians. 0 is straight down, PI/2 is edge on. */
  pitch: number;
  /** How much of the box fills the frame (1 = fitted). */
  zoom: number;
  /** Vertical stretch. Terrain is almost always exaggerated to be
      readable; the UI must SAY the number it is using. */
  exaggeration: number;
}

export const DEFAULT_VIEW: TerrainView = {
  yaw: -0.5,
  pitch: 1.02, // about 58 degrees: enough tilt to read relief
  zoom: 1,
  exaggeration: 2,
};

/**
 * A sensible vertical exaggeration for this particular site.
 *
 * Real ground is mostly flatter than people imagine: a 300 m wide lot
 * with 4 m of fall is a 1.3% grade, and drawn true to scale it looks
 * like a sheet of paper. So we stretch height until the relief is about
 * a fifth of the site's width, then clamp to a range that stays
 * believable. The number is always shown on screen, never hidden.
 */
export function suggestExaggeration(mesh: TerrainMesh): number {
  const widthM = mesh.cols * mesh.cell;
  const relief = mesh.maxZ - mesh.minZ;
  if (!Number.isFinite(relief) || relief <= 0.01) return 3;
  const wanted = (0.2 * widthM) / relief;
  return Math.min(8, Math.max(1, Math.round(wanted * 2) / 2));
}

// ------------------------------------------------------------------
// The colours
// ------------------------------------------------------------------

// Elevation ramp, low to high. Cool and dark at the bottom, warm and
// pale at the top, which is how paper topo maps have shaded relief for a
// century: it reads instantly as "this end is higher".
const RAMP: [number, number, number][] = [
  [26, 54, 71], // deep slate blue
  [31, 92, 84], // teal
  [58, 124, 74], // green
  [138, 148, 74], // olive
  [193, 166, 104], // sand
  [231, 219, 194], // pale limestone
];

/** Pick a colour for a height fraction (0 = lowest, 1 = highest). */
function rampColor(t: number): [number, number, number] {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const pos = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// ------------------------------------------------------------------
// The renderer
// ------------------------------------------------------------------

export interface RenderOptions {
  /** CSS pixel size of the drawing area. */
  width: number;
  height: number;
  /** Draw the faint face edges (the "mesh" look). */
  wireframe?: boolean;
  /** Draw the solid sides under the surface (the "cut out of the
      ground" block look). */
  skirt?: boolean;
}

/** One face queued for drawing, with the depth used to sort it. */
interface Face {
  px: number[]; // 4 x, 4 y in screen pixels
  py: number[];
  depth: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Draw the mesh onto a canvas context.
 *
 * The whole trick is the painter's algorithm: work out where every face
 * lands on screen, sort them far-to-near, then paint them in that order
 * so nearer ground covers what is behind it. For a height grid that is
 * exactly right, because a heightfield can never wrap around itself.
 */
export function renderTerrain(
  ctx: CanvasRenderingContext2D,
  mesh: TerrainMesh,
  view: TerrainView,
  opts: RenderOptions,
): void {
  const { width, height } = opts;
  ctx.clearRect(0, 0, width, height);

  const { rows, cols, cell, z } = mesh;
  const relief = mesh.maxZ - mesh.minZ;
  const midZ = (mesh.maxZ + mesh.minZ) / 2;

  // ---- Project every grid point once ----
  const cosY = Math.cos(view.yaw);
  const sinY = Math.sin(view.yaw);
  const cosP = Math.cos(view.pitch);
  const sinP = Math.sin(view.pitch);

  const halfW = ((cols - 1) * cell) / 2;
  const halfH = ((rows - 1) * cell) / 2;
  // Distance from the camera to the middle of the model. Bigger means a
  // weaker perspective; this value gives depth without funhouse warping.
  const focal = 2.6 * Math.max(halfW, halfH, 1);

  const sx = new Float32Array(rows * cols);
  const sy = new Float32Array(rows * cols);
  const sd = new Float32Array(rows * cols);

  // The floor the sides drop to: a little below the lowest ground.
  const floorZ = mesh.minZ - Math.max(relief * 0.18, 0.5);
  const fx = new Float32Array(rows * cols);
  const fy = new Float32Array(rows * cols);

  let minPx = Infinity;
  let maxPx = -Infinity;
  let minPy = Infinity;
  let maxPy = -Infinity;

  /** World point -> screen point, before the fit-to-frame scaling. */
  function project(x: number, y: number, zz: number): [number, number, number] {
    const xr = x * cosY - y * sinY;
    const yr = x * sinY + y * cosY;
    // Tilt about the east-west axis. Up on screen = up in the world.
    const up = yr * cosP + zz * sinP;
    const depth = yr * sinP - zz * cosP;
    const k = focal / (focal + depth); // gentle perspective
    return [xr * k, -up * k, depth];
  }

  for (let r = 0; r < rows; r++) {
    const y = halfH - r * cell;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = c * cell - halfW;
      const h = z[i];
      const zz = (Number.isFinite(h) ? h - midZ : 0) * view.exaggeration;
      const [px, py, d] = project(x, y, zz);
      sx[i] = px;
      sy[i] = py;
      sd[i] = d;
      const [gx, gy] = project(x, y, (floorZ - midZ) * view.exaggeration);
      fx[i] = gx;
      fy[i] = gy;
      if (Number.isFinite(h)) {
        if (px < minPx) minPx = px;
        if (px > maxPx) maxPx = px;
        if (py < minPy) minPy = py;
        if (py > maxPy) maxPy = py;
        if (gy > maxPy) maxPy = gy; // the skirt hangs below the surface
      }
    }
  }

  if (!Number.isFinite(minPx) || maxPx <= minPx) return; // nothing to draw

  // ---- Fit the projected shape into the canvas ----
  const pad = 14;
  const scale =
    Math.min(
      (width - pad * 2) / (maxPx - minPx),
      (height - pad * 2) / Math.max(maxPy - minPy, 1e-6),
    ) * view.zoom;
  const offX = width / 2 - ((minPx + maxPx) / 2) * scale;
  const offY = height / 2 - ((minPy + maxPy) / 2) * scale;

  // ---- Build the face list ----
  // Light from the north-west and above, the cartographer's default.
  const lx = -0.55;
  const ly = 0.5;
  const lz = 0.67;

  const faces: Face[] = [];
  const exag = view.exaggeration;
  const safeRelief = relief > 0.01 ? relief : 1;

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i00 = r * cols + c;
      const i01 = i00 + 1;
      const i10 = i00 + cols;
      const i11 = i10 + 1;
      const h00 = z[i00];
      const h01 = z[i01];
      const h10 = z[i10];
      const h11 = z[i11];
      // Any missing corner means this square is off the parcel.
      if (
        !Number.isFinite(h00) ||
        !Number.isFinite(h01) ||
        !Number.isFinite(h10) ||
        !Number.isFinite(h11)
      ) {
        continue;
      }

      // Surface normal from the two diagonals, in world metres (with the
      // exaggeration applied, so the shading matches what you see).
      const dzdx = ((h01 - h00) + (h11 - h10)) / 2 * exag;
      const dzdy = ((h00 - h10) + (h01 - h11)) / 2 * exag;
      let nx = -dzdx;
      let ny = -dzdy;
      let nz = cell;
      const nlen = Math.hypot(nx, ny, nz) || 1;
      nx /= nlen;
      ny /= nlen;
      nz /= nlen;
      // Lambert shading with a soft ambient floor, so a shadowed slope
      // is dark but never a black hole.
      const lambert = nx * lx + ny * ly + nz * lz;
      const shade = 0.35 + 0.65 * Math.max(0, lambert);

      const meanH = (h00 + h01 + h10 + h11) / 4;
      const [cr, cg, cb] = rampColor((meanH - mesh.minZ) / safeRelief);

      faces.push({
        px: [
          sx[i00] * scale + offX,
          sx[i01] * scale + offX,
          sx[i11] * scale + offX,
          sx[i10] * scale + offX,
        ],
        py: [
          sy[i00] * scale + offY,
          sy[i01] * scale + offY,
          sy[i11] * scale + offY,
          sy[i10] * scale + offY,
        ],
        depth: (sd[i00] + sd[i01] + sd[i10] + sd[i11]) / 4,
        r: cr * shade,
        g: cg * shade,
        b: cb * shade,
      });

      // ---- The sides ----
      // A square on the EDGE of the parcel (its neighbour is missing or
      // off the grid) gets a wall dropped from it to the floor, which is
      // what makes the site read as a solid block of earth rather than a
      // floating sheet.
      if (opts.skirt !== false) {
        const edges: [number, number][] = [];
        if (r === 0 || !Number.isFinite(z[i00 - cols])) edges.push([i00, i01]);
        if (r === rows - 2 || !Number.isFinite(z[i10 + cols]))
          edges.push([i11, i10]);
        if (c === 0 || !Number.isFinite(z[i00 - 1])) edges.push([i10, i00]);
        if (c === cols - 2 || !Number.isFinite(z[i01 + 1])) edges.push([i01, i11]);
        for (const [a, b] of edges) {
          faces.push({
            px: [
              sx[a] * scale + offX,
              sx[b] * scale + offX,
              fx[b] * scale + offX,
              fx[a] * scale + offX,
            ],
            py: [
              sy[a] * scale + offY,
              sy[b] * scale + offY,
              fy[b] * scale + offY,
              fy[a] * scale + offY,
            ],
            // Nudge walls very slightly behind their own surface square
            // so they never paint over the ground they hang from.
            depth: (sd[a] + sd[b]) / 2 + 0.01,
            r: 28,
            g: 34,
            b: 40,
          });
        }
      }
    }
  }

  // ---- Paint, farthest first ----
  faces.sort((a, b) => b.depth - a.depth);

  const wire = opts.wireframe === true;
  ctx.lineJoin = "round";
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.px[0], f.py[0]);
    ctx.lineTo(f.px[1], f.py[1]);
    ctx.lineTo(f.px[2], f.py[2]);
    ctx.lineTo(f.px[3], f.py[3]);
    ctx.closePath();
    const fill = `rgb(${f.r | 0},${f.g | 0},${f.b | 0})`;
    ctx.fillStyle = fill;
    ctx.fill();
    // Stroking each face with its own colour hides the hairline seams
    // that antialiasing leaves between neighbouring fills. In wireframe
    // mode the stroke is dark instead, which turns the same faces into a
    // visible mesh.
    ctx.strokeStyle = wire ? "rgba(0,0,0,0.45)" : fill;
    ctx.lineWidth = wire ? 0.6 : 1;
    ctx.stroke();
  }
}

/**
 * Where does north point on screen, in radians, given the camera?
 * The little compass needle in the corner uses this so a spun view can
 * never leave you disoriented.
 */
export function northScreenAngle(view: TerrainView): number {
  // North is +y in world space; after the yaw spin it lands here.
  return -view.yaw;
}
