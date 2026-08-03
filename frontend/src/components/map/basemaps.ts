// components/map/basemaps.ts
// The two basemap "styles" the user can switch between.
//
// A MapLibre "style" is a JSON document that says which tile servers to
// load and how to draw them. For the dark map we point at a ready-made
// style hosted by CARTO (free for light use). For satellite we build a
// tiny style object ourselves around Esri's free World Imagery tiles.

import type { StyleSpecification } from "maplibre-gl";

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
export const FEMA_NFHL_TILES =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export" +
  "?dpi=96&transparent=true&format=png32&bbox={bbox-epsg-3857}" +
  "&bboxSR=3857&imageSR=3857&size=256,256&f=image";

// US Fish and Wildlife Service wetlands, via the standard WMS protocol.
export const WETLANDS_WMS_TILES =
  "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/services/Wetlands/MapServer/WMSServer" +
  "?service=WMS&request=GetMap&version=1.1.1&layers=1&styles=" +
  "&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256" +
  "&format=image%2Fpng&transparent=true";
