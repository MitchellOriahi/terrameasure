# TerraMeasure Mobile UX Specification

Target: React + Vite + MapLibre GL + Tailwind, installable PWA. Devices: iPhone (Safari), Android (Chrome), iPad. Product thesis: a go/no-go land decision in about 60 seconds, one-handed, standing in a field.

Competitive frame: Land id's mobile app is documented (app store reviews, G2) as suffering from crashes, black screens, login failures, slow layer loading, and desktop features missing on mobile. onX Hunt is the benchmark. We win by being faster to first insight, polished on touch, and never gating core analysis behind "use desktop."

## 0. Global principles

1. The map is the app. Full-bleed behind everything. No screen fully replaces the map except report preview and auth. Everything else is a sheet or drawer.
2. One-thumb rule. Every golden-path action lives in the bottom 40% of the screen.
3. Sheet-first, modal-never. No centered modal dialogs on mobile. Destructive confirms are bottom action sheets.
4. Precision via reticle, not fingertips. All vertex placement uses pan-map-under-fixed-crosshair (the ArcGIS ReticleVertexTool / Touch GIS pattern). The user never taps the map to place a point; they move the map and press a big button. The single most important mobile decision in this spec.
5. Every measurement shows its error estimate as a subdued suffix: `4.21 ac +/- 0.06`.
6. Never blank. Every async state has a skeleton or cached-last-value. Layer toggles apply optimistically.

### Layout and CSS foundation

```css
/* index.html */
<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">

/* App shell */
html, body, #root { height: 100%; overscroll-behavior: none; }
#root {
  height: 100dvh;              /* dynamic: tracks Safari toolbar collapse */
  min-height: 100svh;
  display: grid;
}
.map-canvas { position: fixed; inset: 0; touch-action: none; } /* MapLibre owns all gestures */
.safe-top    { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: max(env(safe-area-inset-bottom), 12px); }
input, textarea, select { touch-action: auto; }
* { -webkit-tap-highlight-color: transparent; }
.no-select { -webkit-user-select: none; user-select: none; }
```

Rules:
- `viewport-fit=cover` is mandatory or all safe-area insets resolve to 0 on iOS.
- `100dvh` for the shell, never `100vh` (Safari toolbar bug). Fallback chain: `height: 100vh; height: 100dvh;`.
- `overscroll-behavior: none` on body kills pull-to-refresh fighting map pan.
- `touch-action: none` on the map container only; `pan-y` on scrollable sheet content; `none` on the sheet drag handle. Never set touch-action globally.
- Tap targets min 44x44pt (iOS HIG), golden-path buttons 56pt.
- iPad: same layout under 744px width; at 744px+ the sheet becomes a left-docked 380px panel (Apple Maps iPad pattern). One codebase, one breakpoint.

### Haptics (2026 state)

`navigator.vibrate` works on Android Chrome: 10ms ticks for vertex placement, 20ms for snaps. iOS Safari has no public API (the checkbox trick was patched in iOS 26.5): treat as progressive enhancement, never load-bearing. Pair every haptic with a visual pulse (120ms scale 1.0 to 1.06 to 1.0 on the reticle).

### Bottom sheet system (ONE component, used everywhere)

Three snap points (Apple Maps / Google Maps convention):

| Snap | Height | Shows |
|---|---|---|
| Peek | 88px + safe-area-bottom | Drag handle, title line, one primary stat or CTA |
| Half | 45dvh | Key content, primary actions; map still visible above |
| Full | 100dvh - safe-area-top - 8px | Everything scrollable; map dimmed by scrim rgba(0,0,0, progress * 0.4) |

Physics and gestures:
- Position driven ONLY by `transform: translateY()` with `will-change: transform`. Never animate height or top. Drag = 1:1 finger tracking, no transition; on release, spring to nearest snap (stiffness 380, damping 36, ~250ms feel).
- Velocity rules: release velocity > 0.5 px/ms skips to next snap in fling direction; > 1.2 px/ms skips intermediate snaps entirely.
- Slow drag past 50% of the inter-snap distance commits to the next snap, otherwise snaps back.
- Nested scroll: at Full, inner content scrolls (`overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y`). Drag-down moves the sheet only when inner scrollTop === 0.
- Map with sheet up: at Peek and Half the map accepts all gestures; starting a map pan while at Half auto-drops the sheet to Peek (Google Maps behavior). At Full, map is inert behind scrim; tapping scrim drops to Half.
- Drag handle: 36x5px pill inside a 44px-tall invisible hit zone. Corners rounded-t-2xl, shadow 0 -8px 30px rgba(0,0,0,.35).
- Keyboard: input focus inside a sheet forces Full + scrollIntoView center; listen to `visualViewport.resize` to reflow above the iOS keyboard.

## 1. Map Home

Layout, bottom to top:
- Bottom bar (56pt + safe-area, floating, inset 12px): Layers (left), Survey primary pill button (center, widest, THE button), Saved (right). Mirrors onX's bottom toolbar.
- Right edge stack above the bar (44pt circular, 12px gap): Locate, Compass (appears only when rotated; tap resets north).
- Top: search pill (44pt, full width minus 24px, below safe-area-top), backdrop-filter blur(12px).
- No sheet by default. Clean map.

Locate button (onX pattern):
- Tap 1: fly to GPS (blue dot + accuracy ring), enter follow mode (icon fills solid).
- Tap 2: heading-up mode, map rotates with compass (`DeviceOrientationEvent.requestPermission()` on this tap, must be a user gesture on iOS).
- Tap 3: back to north-up, still following. Manual pan exits follow mode.
- Geolocation denied: slash badge; tap opens Peek sheet explaining browser re-enable. Never a dead button.

Gestures (MapLibre defaults, tuned): pan, pinch zoom+rotate, two-finger tilt, double-tap zoom, two-finger-tap zoom out, double-tap-and-drag one-handed zoom (keep enabled). Rotation snap-to-north within 7 degrees.

Tapping a parcel (layer on): highlight boundary (2px accent stroke, 12% fill), open Parcel Card at Peek.

## 2. Search

- Opens the sheet at Full with the input at the top, keyboard up, results in the sheet. Not a separate page.
- Accepts address, place, lat/lon, APN (when available). Debounce 250ms. Cached recents shown instantly (last 8 + "Current location").
- Select: keyboard dismisses, sheet drops to Peek as a location/parcel card, map flies (800ms easeOutCubic).
- Offline: recents still work, inline "You're offline, showing saved places" row.

## 3. Layers Drawer

A sheet (opens Half, drags Full):
- Basemap row: segmented Satellite / Streets / Topo thumbnail chips 64x48, current ringed.
- OVERLAYS list: Parcels, Contours, Slope, Flood, Wetlands. Rows 44pt: name + toggle + status dot.
- Optimistic + honest loading: toggle flips instantly; dot shows amber loading, green on first rendered tile, red with Retry on error. Nothing is ever "random."
- Tapping the row (not the toggle) expands an inline 44pt opacity slider (28px thumb, touch-action none on slider only).
- Choices persist in localStorage, restore before network on next launch.
- Map stays interactive above the Half sheet so users watch layers appear.

## 4. Survey Flow (reticle drawing, the crown jewel)

Entered via the Survey button:
- Fixed crosshair reticle at the center of the unobstructed map area (~42% from top). 28px crosshair, 2px center dot, accent color. Map moves under it; reticle never moves.
- Bottom tool tray replaces the bar: giant "+ Add Point" (56pt, 60% width, center), Undo (left, count badge, long-press = "Clear all?" action sheet), Done (right, appears after 3 points).
- Live readout strip above the tray (32pt, monospace): distance from point 1 to 2, running area + perimeter from 3+, with error suffix. This live number IS the dopamine loop.
- First-use hint pill: "Move the map to aim, tap Add Point" (auto-hides after first vertex; never shown after 2 completed surveys).

Placement:
- Add Point drops a vertex at reticle position. Haptic tick (Android), reticle pulse (all). Vertices: 14px white-ring dots; dashed accent segments; rubber-band dashed line from last vertex to reticle.
- Snap-to-close: reticle within 24 screen px of first vertex balloons it to 20px and pulses; button becomes "Close Shape". Done auto-closes anytime after 3 points.
- Zoom-adaptive precision chip below zoom 16: "Zoom in for +/- Xm precision."
- Vertex editing: tap an existing vertex (44px hit area), map animates it under the reticle, tray becomes Move Here / Delete Point / Cancel. Never finger-drag vertices.
- Undo pops last vertex, camera stays put. Unlimited undo in session.
- Escape hatch: back button / edge swipe shows "Discard survey?" action sheet only if a vertex exists (register a history entry on entering draw mode, handle popstate).
- Tray overflow: "Walk the boundary" GPS mode, vertex at GPS position per tap or auto-drop every N meters.

On Done: 250ms fill animation, POST to API, Results sheet at Half with skeletons that resolve as the engine returns (area/perimeter instant client-side; slope/volume/profile stream in).

## 5. Results Sheet

- Opens Half. Peek line: `4.21 ac +/- 0.06 · avg slope 8.4%` so numbers stay visible while panning.
- Half: 2-column stat grid, monospace values with error bounds (Area, Perimeter, Avg/Max Slope, Elevation range). Action row: Full Report, Share, Save (48pt).
- Full: adds elevation profile chart (in overflow-x auto container), slope histogram, contour preview, cut/fill calculator, accuracy card ("Source: USGS 3DEP 1m, vertical error +/- 0.15m") with "What does this mean?" expander. Nothing desktop-only: that is the Land id kill shot.
- "Edit boundary" returns to draw mode with vertices intact.

## 6. Parcel Card

- Peek: owner/APN line + acreage. Half: address, county, land use, actions: "Survey this parcel" (pre-loads the parcel boundary as polygon, jumps straight to Results: the fastest golden path), Directions (maps:// / geo: deep link), Save. Full: full attribute table.
- Horizontal swipe on the card at Peek cycles tapped-parcel history (Google Maps POI pattern).

## 7. Saved

- Sheet at Half: rows 56pt with pre-rendered 96x64 mini-map thumbnail cached at save time, name, area, date. Tap = fly-to + open its sheet at Peek. Swipe-left = Delete with 5s undo snackbar. Saved items fully offline (geometry + last results JSON + thumbnail in IndexedDB).

## 8. Report Share

- `navigator.share({files})` with a rendered PNG summary card + link; fallback = copy-link + download in a Peek sheet. Card: map snapshot with boundary, big area number with error bound, TerraMeasure mark, and "Preliminary, uncertified" baked into the image so honesty travels with every screenshot.

## 9. Auth (fixing Land id's login disaster)

- Auth NEVER required to survey. Full golden path works anonymously; auth gates only Save and Share-link persistence, requested contextually in a sheet.
- Supabase session in localStorage, silent refresh on launch; on failure degrade to anonymous with a small "Signed out" pill, never block the map.
- OAuth redirect returns to exact map state (persist camera + draft geometry to sessionStorage before redirect).

## 10. PWA checklist

- Install: Android captures beforeinstallprompt, show custom "Add TerraMeasure" row after the 2nd completed survey (earned moment, not a nag). iOS: one-time instructional sheet (Share, Add to Home Screen), same trigger, dismiss = never again.
- Manifest: standalone, theme_color matching chrome, maskable icons, orientation any. iOS: apple-touch-startup-image set, status-bar black-translucent, pad with safe-top.
- Offline: precache app shell (Workbox via vite-plugin-pwa). Tiles: stale-while-revalidate, LRU ~200MB cap, satellite excluded by default. No offline-area-download promises in v1; honest thin "offline, cached tiles only" banner.
- Push: defer entirely in v1 (iOS allows Web Push only for installed PWAs).
- Performance budget: first map tile < 2.5s cold on 4G; sheet drag 60fps (transform-only, no layout reads in drag handler); layer sources lazy-added on first toggle.

## Golden path: survey in 60 seconds, one-handed

1. 0-5s: open from home screen, map at last camera instantly (cached tiles). No login wall.
2. 5-8s: tap Locate. GPS dot + accuracy ring.
3. 8-10s: tap Survey.
4. 10-40s: pan corner under crosshair, tap Add Point, repeat. Rubber band + live area readout. Mistake costs one Undo tap. Six corners ~25s.
5. 40-42s: reticle nears first corner, it pulses, tap Close Shape.
6. 42-50s: Results at Half. Drag to Peek, pan to eyeball boundary, numbers stay visible.
7. 50-60s: flick to Full, check slope histogram, tap Share, native share sheet. Done. Zero typing, zero login, zero desktop.

Four distinct controls touched: Locate, Survey, Add Point, Close/Share. All in the bottom 40%.

## Implementation notes

- Build ONE Sheet primitive (or adopt react-modal-sheet / vaul and enforce the snap/velocity rules). Results, Parcel, Layers, Search, Saved are instances. Never ship five sheet implementations.
- Reticle placement is pure client geometry: map.getCenter() on Add Point. Area/perimeter live-compute client-side; the engine supplies slope/volume/contours after Done. DEMResult seam untouched.
- Test matrix: iPhone SE (smallest), iPhone Pro (Dynamic Island), Pixel (Android Chrome), iPad Safari at 744px+. Verify keyboard-over-sheet, landscape safe areas (keep controls out of the top 24px in landscape), pull-to-refresh suppressed, OAuth state restore.
