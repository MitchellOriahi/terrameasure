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
import type { MapLayerMouseEvent } from "@vis.gl/react-maplibre";
import type { Feature, Polygon } from "geojson";
import { useAppStore } from "@/store/appStore";
import type { LatLon } from "@/lib/geo";
import {
  DARK_STYLE_URL,
  SATELLITE_STYLE,
  TERRARIUM_TILES,
  FEMA_NFHL_TILES,
  WETLANDS_WMS_TILES,
} from "./basemaps";
import { DrawTools } from "./DrawTools";

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

  // Where to pin the contour image overlay: the backend tells us the DEM's
  // center and size in meters; convert that to the four corner coordinates
  // an image source needs (top-left, top-right, bottom-right, bottom-left).
  const contourCorners = useMemo(() => {
    if (!survey || !survey.contour_map_clean_b64 || !survey.dem_center_lat) {
      return null;
    }
    const mPerDegLat = 111_320;
    const mPerDegLon =
      111_320 * Math.cos((survey.dem_center_lat * Math.PI) / 180);
    const halfW = survey.dem_width_m / 2 / mPerDegLon;
    const halfH = survey.dem_height_m / 2 / mPerDegLat;
    const { dem_center_lat: lat, dem_center_lon: lon } = survey;
    return [
      [lon - halfW, lat + halfH],
      [lon + halfW, lat + halfH],
      [lon + halfW, lat - halfH],
      [lon - halfW, lat - halfH],
    ] as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
  }, [survey]);

  return (
    <Map
      id="main"
      initialViewState={{
        // Continental US, comfortably framed
        longitude: -98.5,
        latitude: 39.5,
        zoom: 4,
      }}
      mapStyle={basemap === "map" ? DARK_STYLE_URL : SATELLITE_STYLE}
      // When 3D is on, tell MapLibre to drape the map over the elevation
      // tiles declared in the "terrain-dem" source below.
      terrain={
        terrain3d ? { source: "terrain-dem", exaggeration: 1.3 } : undefined
      }
      maxPitch={terrain3d ? 70 : 60}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
      onClick={(e: MapLayerMouseEvent) =>
        onMapClick?.(e.lngLat.lat, e.lngLat.lng)
      }
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
           the exact ground footprint the backend reported ---- */}
      {layers.contours && contourCorners && survey && (
        <Source
          id="survey-contours"
          type="image"
          url={`data:image/png;base64,${survey.contour_map_clean_b64}`}
          coordinates={contourCorners}
        >
          <Layer
            id="survey-contours-layer"
            type="raster"
            paint={{ "raster-opacity": 0.9, "raster-fade-duration": 0 }}
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
    </Map>
  );
}
