// components/map/MapView.tsx
// The full-bleed map that everything else floats on top of.
//
// Built with @vis.gl/react-maplibre, the React wrapper around MapLibre GL.
// The wrapper's superpower: <Source> and <Layer> are declarative React
// children, so when we switch basemap styles React automatically re-adds
// our overlays (drawn polygon, flood zones, etc.) to the new style.
// That is why the finished polygon lives in the Zustand store and is
// rendered here, rather than living inside terra-draw.

import { useMemo } from "react";
import {
  Map,
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
} from "@vis.gl/react-maplibre";
import type { MapLayerMouseEvent, ViewStateChangeEvent } from "@vis.gl/react-maplibre";
import type { Feature, Polygon } from "geojson";
import { useAppStore } from "@/store/appStore";
import { loadCamera, saveCamera } from "@/lib/mapState";
import { demCorners } from "@/lib/site3d";
import type { LatLon } from "@/lib/geo";
import {
  DARK_STYLE_URL,
  SATELLITE_STYLE,
  TERRARIUM_TILES,
  FEMA_NFHL_TILES,
  WETLANDS_WMS_TILES,
} from "./basemaps";
import { DrawTools } from "./DrawTools";
import { ReticleLayers } from "./ReticleLayers";

interface MapViewProps {
  onShapeFinished: (vertices: LatLon[]) => void;
  // Called with lat/lon when the user taps the bare map (used for the
  // tap-to-parcel lookup; the page decides whether the tap counts).
  onMapClick?: (lat: number, lon: number) => void;
}

/** Turn stored vertices back into a GeoJSON polygon for display. */
function verticesToFeature(vertices: LatLon[]): Feature<Polygon> {
  const ring = vertices.map((v) => [v.lon, v.lat]);
  ring.push(ring[0]); // GeoJSON rings must close on themselves
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export function MapView({ onShapeFinished, onMapClick }: MapViewProps) {
  const basemap = useAppStore((s) => s.basemap);
  const terrain3d = useAppStore((s) => s.terrain3d);
  const layers = useAppStore((s) => s.layers);
  const drawnVertices = useAppStore((s) => s.drawnVertices);
  const survey = useAppStore((s) => s.survey);
  const parcel = useAppStore((s) => s.parcel);
  // Site 3D mode (the "View site in 3D" experience): while active it
  // owns the terrain (with its own exaggeration) and may drape one of
  // the survey's images over the site footprint.
  const site3d = useAppStore((s) => s.site3d);
  const site3dDrape = useAppStore((s) => s.site3dDrape);
  const site3dExaggeration = useAppStore((s) => s.site3dExaggeration);

  // Where the user last left the map in this tab. Read once per mount:
  // it survives the Google sign-in round trip, which reloads the page.
  const savedCamera = loadCamera();

  // The looked-up parcel's outline as a GeoJSON feature for display.
  const parcelFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!parcel?.boundary) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: parcel.boundary as Polygon,
    };
  }, [parcel]);

  // The finished shape as GeoJSON (memoized so the map is not poked on
  // every unrelated re-render).
  const drawnFeature = useMemo(
    () => (drawnVertices ? verticesToFeature(drawnVertices) : null),
    [drawnVertices],
  );

  // Where to pin image overlays (contours, the Site 3D drape): the
  // backend tells us the DEM's center and size in meters; demCorners
  // (lib/site3d.ts) converts that to the four corner coordinates an
  // image source needs (top-left, top-right, bottom-right, bottom-left).
  const surveyCorners = useMemo(() => demCorners(survey), [survey]);

  // Which of the survey's images (if any) is draped over the site in
  // Site 3D mode. "satellite" deliberately maps to no extra image: the
  // satellite basemap is already stretched over the terrain, and its
  // live tiles are sharper than any snapshot pinned on top.
  const drapeB64 =
    site3d && survey
      ? site3dDrape === "slope"
        ? survey.slope_map_clean_b64
        : site3dDrape === "contours"
          ? survey.contour_map_clean_b64
          : undefined
      : undefined;

  return (
    <Map
      id="main"
      initialViewState={savedCamera
        ? {
            longitude: savedCamera.lon,
            latitude: savedCamera.lat,
            zoom: savedCamera.zoom,
          }
        : {
            // First visit in this tab: continental US, comfortably framed
            longitude: -98.5,
            latitude: 39.5,
            zoom: 4,
          }}
      // Stash the camera after every pan/zoom settles, so a reload at
      // any moment comes back to the same view.
      onMoveEnd={(e: ViewStateChangeEvent) =>
        saveCamera({
          lat: e.viewState.latitude,
          lon: e.viewState.longitude,
          zoom: e.viewState.zoom,
        })
      }
      mapStyle={basemap === "map" ? DARK_STYLE_URL : SATELLITE_STYLE}
      // When 3D is on, tell MapLibre to drape the map over the elevation
      // tiles declared in the "terrain-dem" source below.
      // IMPORTANT: when 3D is off this must be null, NOT undefined.
      // react-maplibre treats undefined as "not my job, leave the map
      // alone", so the terrain would silently stay on forever. That
      // stuck terrain then wrecks 2D rendering: at high-elevation spots
      // (like Colorado) the camera ends up almost touching the ground,
      // and the map looks insanely zoomed in and blurry. null means
      // "actively remove the terrain".
      // (The cast is needed because the wrapper's TypeScript types only
      // admit undefined, while its runtime code specifically handles null
      // as the "remove terrain" signal. Runtime wins here.)
      // Site 3D mode owns the terrain while it runs (with its user-set
      // exaggeration); otherwise the TopBar's global 3D toggle does.
      terrain={
        site3d
          ? { source: "terrain-dem", exaggeration: site3dExaggeration }
          : terrain3d
            ? { source: "terrain-dem", exaggeration: 1.3 }
            : (null as unknown as undefined)
      }
      // Why this flag: by default MapLibre "clamps" the camera's focal
      // point to the ground. The moment terrain switches on, the ground
      // under the camera JUMPS UP by the local elevation (Golden, CO is
      // ~1,700 m high), MapLibre recomputes the zoom against that raised
      // ground, and the view dives to a featureless ultra-close-up that
      // looks like a black screen. With clamping off, the focal point
      // stays at sea level, so toggling 3D keeps the view scale the user
      // had; the mountains simply rise toward the camera as expected.
      centerClampedToGround={false}
      maxPitch={terrain3d || site3d ? 70 : 60}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
      onClick={(e: MapLayerMouseEvent) =>
        onMapClick?.(e.lngLat.lat, e.lngLat.lng)
      }
      // Dev-only escape hatch: expose the raw MapLibre map on window so
      // diagnostic scripts (scripts/e2e-diagnose.mjs) can inspect layers
      // and sources. Stripped from production builds by the DEV guard.
      onLoad={(e) => {
        if (import.meta.env.DEV) {
          (window as unknown as { __tmMap?: unknown }).__tmMap = e.target;
        }
      }}
    >
      {/* ---- Built-in map controls (bottom right, above mobile sheet) ---- */}
      <NavigationControl position="bottom-right" showCompass visualizePitch />
      <GeolocateControl
        position="bottom-right"
        trackUserLocation
        positionOptions={{ enableHighAccuracy: true }}
      />
      <ScaleControl position="bottom-left" unit="imperial" />

      {/* ---- Elevation tiles: consumed by 3D terrain and hillshade ----
           Declaring a source costs nothing until a layer (or terrain)
           actually uses it, so it is fine to keep it always present. */}
      <Source
        id="terrain-dem"
        type="raster-dem"
        tiles={[TERRARIUM_TILES]}
        encoding="terrarium"
        tileSize={256}
        maxzoom={15}
      />
      {/* Hillshade wants its own copy of the source; sharing one source
           between terrain and hillshade causes rendering artifacts. */}
      <Source
        id="hillshade-dem"
        type="raster-dem"
        tiles={[TERRARIUM_TILES]}
        encoding="terrarium"
        tileSize={256}
        maxzoom={15}
      >
        {layers.hillshade && (
          <Layer
            id="hillshade-layer"
            type="hillshade"
            paint={{
              "hillshade-exaggeration": 0.45,
              "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#5c5850",
            }}
          />
        )}
      </Source>

      {/* ---- FEMA flood zones (live raster export service) ---- */}
      {layers.flood && (
        <Source
          id="fema-flood"
          type="raster"
          tiles={[FEMA_NFHL_TILES]}
          tileSize={256}
          minzoom={9}
          attribution="FEMA National Flood Hazard Layer"
        >
          <Layer
            id="fema-flood-layer"
            type="raster"
            paint={{ "raster-opacity": 0.6 }}
          />
        </Source>
      )}

      {/* ---- USFWS wetlands (live WMS service) ---- */}
      {layers.wetlands && (
        <Source
          id="wetlands"
          type="raster"
          tiles={[WETLANDS_WMS_TILES]}
          tileSize={256}
          minzoom={9}
          attribution="U.S. Fish and Wildlife Service National Wetlands Inventory"
        >
          <Layer
            id="wetlands-layer"
            type="raster"
            paint={{ "raster-opacity": 0.6 }}
          />
        </Source>
      )}

      {/* ---- Contour overlay: the survey's contour map image, pinned to
           the exact ground footprint the backend reported. Hidden while
           Site 3D is up: the 3D drape below covers the same ground and
           double-drawing the contours would look muddy. ---- */}
      {layers.contours &&
        surveyCorners &&
        survey?.contour_map_clean_b64 &&
        !site3d && (
          <Source
            id="survey-contours"
            type="image"
            url={`data:image/png;base64,${survey.contour_map_clean_b64}`}
            coordinates={surveyCorners}
          >
            <Layer
              id="survey-contours-layer"
              type="raster"
              paint={{ "raster-opacity": 0.9, "raster-fade-duration": 0 }}
            />
          </Source>
        )}

      {/* ---- Site 3D drape: one of the survey's images stretched over
           the surveyed ground while in 3D mode. The key forces a clean
           source swap when the user picks a different drape (image
           sources cache their URL, so remounting is the reliable way).
           MapLibre automatically molds a raster image source onto the
           3D terrain, which is exactly the draped-mesh effect the old
           Three.js panel had. ---- */}
      {site3d && surveyCorners && drapeB64 && (
        <Source
          key={`site3d-drape-${site3dDrape}`}
          id="site3d-drape"
          type="image"
          url={`data:image/png;base64,${drapeB64}`}
          coordinates={surveyCorners}
        >
          <Layer
            id="site3d-drape-layer"
            type="raster"
            paint={{ "raster-opacity": 0.92, "raster-fade-duration": 0 }}
          />
        </Source>
      )}

      {/* ---- Looked-up parcel boundary (tap-to-parcel) ----
           Same emerald accent family as the drawn shape, but lighter
           fill and a dashed line so the two never read as the same
           thing when both are on screen. */}
      {parcelFeature && (
        <Source id="parcel-boundary" type="geojson" data={parcelFeature}>
          <Layer
            id="parcel-boundary-fill"
            type="fill"
            paint={{ "fill-color": "#34d399", "fill-opacity": 0.08 }}
          />
          <Layer
            id="parcel-boundary-line"
            type="line"
            paint={{
              "line-color": "#34d399",
              "line-width": 2,
              "line-dasharray": [2, 1.5],
            }}
          />
        </Source>
      )}

      {/* ---- The finished survey polygon (survives basemap switches) ---- */}
      {drawnFeature && (
        <Source id="drawn-shape" type="geojson" data={drawnFeature}>
          <Layer
            id="drawn-shape-fill"
            type="fill"
            paint={{ "fill-color": "#34d399", "fill-opacity": 0.12 }}
          />
          <Layer
            id="drawn-shape-line"
            type="line"
            paint={{ "line-color": "#34d399", "line-width": 2.5 }}
          />
        </Source>
      )}

      {/* ---- Drawing wiring (renders nothing) ---- */}
      <DrawTools onShapeFinished={onShapeFinished} />

      {/* ---- Mobile reticle drawing: in-progress vertices, dashed
           segments, and the live rubber-band line. Renders nothing
           unless reticle mode is active. ---- */}
      <ReticleLayers />
    </Map>
  );
}
