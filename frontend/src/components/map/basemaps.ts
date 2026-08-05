// components/map/basemaps.ts
// The two basemap "styles" the user can switch between.
//
// A MapLibre "style" is a JSON document that says which tile servers to
// load and how to draw them. For the dark map we point at a ready-made
// style hosted by CARTO (free for light use). For satellite we build a
// tiny style object ourselves around Esri's free World Imagery tiles.

import type { StyleSpecification } from "maplibre-gl";
import { API_BASE } from "@/lib/api";

// CARTO's dark basemap: vector tiles, crisp labels, perfect for dark chrome.
export const DARK_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Esri requires this attribution text when using World Imagery tiles.
const ESRI_ATTRIBUTION =
  "Powered by Esri | Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

// A minimal hand-built style: one raster source, one raster layer.
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "esri-imagery",
      type: "raster",
      source: "esri-imagery",
    },
  ],
};

// Free worldwide elevation tiles from AWS (the "terrarium" encoding packs
// height values into the red/green/blue channels of a PNG). MapLibre can
// read these directly for 3D terrain and hillshading.
export const TERRARIUM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// FEMA's National Flood Hazard Layer, served as map images. The special
// {bbox-epsg-3857} token is filled in by MapLibre for each tile request.
// "layers=show:27,28" limits the picture to Flood Hazard Boundaries and
// Flood Hazard Zones. Without it the service also draws FIRM panel
// labels, survey baselines, and a dozen other engineering layers, which
// buries the map under red "PANEL 08059C0188G" text.
export const FEMA_NFHL_TILES =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export" +
  "?dpi=96&transparent=true&format=png32&layers=show:27,28&bbox={bbox-epsg-3857}" +
  "&bboxSR=3857&imageSR=3857&size=256,256&f=image";

// US Fish and Wildlife Service wetlands.
// The USFWS server sends no CORS header, so the browser is not allowed
// to fetch its images directly (the old direct URL failed silently and
// the overlay never drew). Instead we ask OUR OWN backend, which
// fetches the image server-to-server (no CORS there) and passes it
// back: see the /tiles/wetlands endpoint in api/server.py. MapLibre
// still fills in the {bbox-epsg-3857} token per tile.
export const WETLANDS_WMS_TILES =
  `${API_BASE}/tiles/wetlands?bbox={bbox-epsg-3857}`;
