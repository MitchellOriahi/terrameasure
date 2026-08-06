// components/results/SiteMesh3D.tsx
// The 3D model of the surveyed ground, sitting right inside the site
// assessment: a block of terrain shaped like the parcel you drew,
// floating on a near-black background, which you spin with a finger or
// the mouse.
//
// This is deliberately NOT the map's 3D mode (the "View site in 3D"
// button, lib/site3d.ts). That one takes over the whole screen to fly
// you around the real world with satellite imagery on it. This one stays
// in the results panel and answers a different question at a glance:
// "what shape is this piece of land?" No tiles to download, no map, no
// waiting. It draws from the very same elevation grid the numbers above
// it were computed from, so what you see and what you read always agree.
//
// How the drawing works: lib/terrainMesh.ts. This file is only about
// the canvas element, the gestures, and the buttons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw, Grid3x3, Play, Pause } from "lucide-react";
import type { LatLon } from "@/lib/geo";
import {
  buildTerrainMesh,
  type TerrainSource,
  renderTerrain,
  suggestExaggeration,
  northScreenAngle,
  DEFAULT_VIEW,
  type TerrainView,
} from "@/lib/terrainMesh";
import { elevValue, elevUnit } from "@/lib/units";
import { useAppStore } from "@/store/appStore";

interface SiteMesh3DProps {
  survey: TerrainSource;
  vertices: LatLon[] | null;
  /** Compact height for tight spaces (the shared report page). */
  compact?: boolean;
}

export function SiteMesh3D({ survey, vertices, compact }: SiteMesh3DProps) {
  const units = useAppStore((s) => s.units);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Phones get a coarser grid: fewer, bigger faces keep a finger-drag
  // smooth on hardware that is doing this on the CPU.
  const maxSide = typeof window !== "undefined" && window.innerWidth < 640 ? 40 : 56;
  const mesh = useMemo(
    () => buildTerrainMesh(survey, vertices, maxSide),
    [survey, vertices, maxSide],
  );

  // The camera. Kept in a ref (not state) because a drag updates it up
  // to 60 times a second and React does not need to know about any of
  // those; only the caption values below are mirrored into state.
  const viewRef = useRef<TerrainView>({ ...DEFAULT_VIEW });
  const [exag, setExag] = useState(2);
  const [wireframe, setWireframe] = useState(false);
  const [spinning, setSpinning] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // Rerender trigger for the compass needle, which lives in the DOM
  // rather than the canvas.
  const [needle, setNeedle] = useState(northScreenAngle(DEFAULT_VIEW));

  // Pick a starting exaggeration that suits THIS site, once per mesh.
  useEffect(() => {
    if (!mesh) return;
    const e = suggestExaggeration(mesh);
    viewRef.current = { ...DEFAULT_VIEW, exaggeration: e };
    setExag(e);
    setSpinning(true);
  }, [mesh]);

  // ---- The draw loop ----
  // One requestAnimationFrame loop that redraws only when something
  // changed (a drag, a button, the slow idle spin). An idle canvas costs
  // nothing, which matters on a phone battery.
  const dirtyRef = useRef(true);
  const spinRef = useRef(true);
  spinRef.current = spinning;
  const wireRef = useRef(false);
  wireRef.current = wireframe;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || !mesh) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 8 || h < 8) return;
    // Match the canvas to the screen's pixel density, capped at 2 so a
    // 3x phone display does not triple the work for no visible gain.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderTerrain(ctx, mesh, viewRef.current, {
      width: w,
      height: h,
      wireframe: wireRef.current,
      skirt: true,
    });
  }, [mesh]);

  useEffect(() => {
    if (!mesh) return;
    let raf = 0;
    let last = performance.now();
    let visible = true;

    // Only animate while the panel is actually on screen.
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    if (boxRef.current) io.observe(boxRef.current);

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (visible) {
        if (spinRef.current) {
          // A slow drift, about one turn every 40 seconds. Enough to
          // read the shape without being a distraction.
          viewRef.current.yaw += dt * 0.16;
          dirtyRef.current = true;
        }
        if (dirtyRef.current) {
          dirtyRef.current = false;
          draw();
          setNeedle(northScreenAngle(viewRef.current));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Redraw on resize (panel opens, phone rotates, window changes).
    const ro = new ResizeObserver(() => {
      dirtyRef.current = true;
    });
    if (boxRef.current) ro.observe(boxRef.current);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [mesh, draw]);

  // Redraw when a button changes something React knows about.
  useEffect(() => {
    dirtyRef.current = true;
  }, [wireframe, exag, expanded]);

  // ---- Gestures ----
  // Pointer events cover mouse, finger and stylus with one code path.
  // Two fingers pinch to zoom; one finger spins and tilts.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Any touch stops the idle spin: from here the user is in charge.
    if (spinning) setSpinning(false);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      // Pinch: the distance between the first two fingers sets the zoom.
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinchRef.current) {
        pinchRef.current = { dist, zoom: viewRef.current.zoom };
      } else if (pinchRef.current.dist > 0) {
        const factor = dist / pinchRef.current.dist;
        viewRef.current.zoom = clamp(pinchRef.current.zoom * factor, 0.6, 4);
        dirtyRef.current = true;
      }
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    const v = viewRef.current;
    v.yaw -= dx * 0.008;
    // Tilt between nearly overhead and nearly edge-on. Past those the
    // view stops being readable, so the clamp is a kindness.
    v.pitch = clamp(v.pitch - dy * 0.006, 0.18, 1.45);
    dirtyRef.current = true;
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    // No preventDefault: the panel behind this canvas must stay
    // scrollable. Zoom follows the wheel, the page keeps its scroll.
    viewRef.current.zoom = clamp(
      viewRef.current.zoom * Math.exp(-e.deltaY * 0.0012),
      0.6,
      4,
    );
    dirtyRef.current = true;
  }

  function resetView() {
    const e = mesh ? suggestExaggeration(mesh) : 2;
    viewRef.current = { ...DEFAULT_VIEW, exaggeration: e };
    setExag(e);
    setSpinning(true);
    dirtyRef.current = true;
  }

  /** Step the vertical stretch through a short, honest set of values. */
  function cycleExaggeration() {
    const steps = [1, 2, 3, 5, 8];
    const idx = steps.findIndex((s) => s >= exag);
    const next = steps[(idx + 1) % steps.length] ?? 2;
    viewRef.current.exaggeration = next;
    setExag(next);
    dirtyRef.current = true;
  }

  // Nothing to draw (a survey with no grid, which should not happen).
  if (!mesh) return null;

  const relief = mesh.maxZ - mesh.minZ;
  const boxHeight = expanded ? "min(70vh, 560px)" : compact ? "200px" : "260px";

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-widest text-muted">
          3D site model
        </span>
        <span className="num ml-auto text-[10px] text-muted">
          {exag}x vertical
        </span>
      </div>

      {/* The stage. Black on purpose: the land is the only thing lit. */}
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-lg border border-line bg-[#05070a]"
        style={{ height: boxHeight, touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          role="img"
          aria-label={`3D model of the surveyed ground, ${elevValue(
            relief,
            units,
            1,
          )} ${elevUnit(units)} from the lowest point to the highest`}
        />

        {/* Compass: which way is north after all that spinning */}
        <div className="pointer-events-none absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50">
          <span
            className="text-[10px] font-semibold text-accent-bright"
            style={{ transform: `rotate(${needle}rad)` }}
          >
            N
          </span>
        </div>

        {/* Controls, bottom right, out of the way of the model */}
        <div className="absolute bottom-2 right-2 flex gap-1">
          <MeshButton
            label={spinning ? "Pause the spin" : "Spin the model"}
            onClick={() => setSpinning((s) => !s)}
          >
            {spinning ? <Pause size={13} /> : <Play size={13} />}
          </MeshButton>
          <MeshButton
            label={`Vertical exaggeration, now ${exag} times. Tap to change`}
            onClick={cycleExaggeration}
          >
            <span className="num text-[10px] font-semibold">{exag}x</span>
          </MeshButton>
          <MeshButton
            label={wireframe ? "Hide the mesh lines" : "Show the mesh lines"}
            onClick={() => setWireframe((w) => !w)}
            active={wireframe}
          >
            <Grid3x3 size={13} />
          </MeshButton>
          <MeshButton label="Reset the view" onClick={resetView}>
            <RotateCcw size={13} />
          </MeshButton>
          <MeshButton
            label={expanded ? "Shrink the model" : "Enlarge the model"}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </MeshButton>
        </div>

        {/* One-line hint, fades out of the way visually but stays
            readable for anyone who has not tried dragging yet */}
        <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-white/45">
          drag to spin
        </div>
      </div>

      {/* The honesty line. Height is stretched to make the shape
          readable, and the number that does it is stated out loud. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Built from the same elevation grid as the measurements above, cut to
        your outline. Height is stretched {exag} times so the shape reads;
        colour is elevation, low to high, not photography. Relief here is{" "}
        <span className="num">
          {elevValue(relief, units, 1)} {elevUnit(units)}
        </span>{" "}
        across{" "}
        <span className="num">
          {elevValue(mesh.cols * mesh.cell, units, 0)} {elevUnit(units)}
        </span>{" "}
        of ground.
      </p>
    </div>
  );
}

/** Keep the value between a floor and a ceiling. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One small square control over the canvas. Every one carries a real
    label, so hovering on desktop and a screen reader on any device both
    explain what the button does. */
function MeshButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/55 backdrop-blur-sm transition-colors hover:bg-black/75 ${
        active ? "text-accent-bright" : "text-white/80"
      }`}
    >
      {children}
    </button>
  );
}
