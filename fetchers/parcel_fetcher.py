"""
fetchers/parcel_fetcher.py
==========================
"Whose land is this?" Free county parcel lookup, pilot edition.

THE PILOT-VS-REGRID PLAN (read this before adding counties):
  A "parcel" is the legal unit of land ownership. Counties publish parcel
  maps through their assessor's office, and many expose them as free ArcGIS
  REST services (the same API style as our context layers). There is no free
  NATIONWIDE parcel service: each county has its own server, its own field
  names, its own gaps. So this file is a PILOT: a small registry of counties
  we verified by hand, wired up through one generic query class.

  When the product needs full national coverage, the plan is to buy access
  to Regrid (a commercial nationwide parcel dataset). Because everything
  here goes through the ParcelSource interface below, plugging in Regrid is
  ONE new class that implements get_parcel(lat, lon) and returns the same
  dict. Nothing else in the app changes. This is the exact same seam
  philosophy as DEMFetcher: callers never know where the data came from.

VERIFIED COUNTIES (each endpoint tested with a real point query):
  - Maricopa County, AZ   (Phoenix)      APN + owner + address
  - Travis County, TX     (Austin)       parcel id + acreage + address
  - King County, WA       (Seattle)      parcel id (PIN) only
  - Mecklenburg County, NC (Charlotte)   parcel id (PID/NC_PIN) only
  - Miami-Dade County, FL (Miami)        folio + owner + value + zoning

  Some counties publish rich data (Miami-Dade includes assessed values),
  others only publish the boundary and an id (King, Mecklenburg). When a
  county does not publish a field we return it as null WITH A NOTE saying
  the county does not publish it: an honest null, never a silent drop.
"""

from __future__ import annotations

import json
import math

import requests
from shapely.geometry import Polygon as ShapelyPolygon

M_PER_DEG_LAT = 111_320.0
SQFT_PER_ACRE = 43_560.0
SQM_PER_ACRE = 4_046.8564224


# ---------------------------------------------------------------------------
# The interface: any parcel source (county pilot today, Regrid later) must
# provide get_parcel(lat, lon) returning the standard dict below.
# ---------------------------------------------------------------------------
class ParcelSource:
    def get_parcel(self, lat: float, lon: float) -> dict:
        raise NotImplementedError("Each parcel source implements this.")


def _empty_parcel(status: str, note: str) -> dict:
    """The standard parcel dict with everything nulled out."""
    return {
        "status": status,          # "ok" | "no_coverage" | "unavailable"
        "parcel_id": None,         # APN / PIN / folio, whatever the county calls it
        "owner": None,
        "address": None,
        "acreage": None,
        "land_use": None,
        "zoning": None,
        "assessed_value": None,    # county-assessed total value in USD
        "last_sale_price": None,   # most recent sale price in USD
        "last_sale_date": None,    # most recent sale date (string)
        "boundary": None,          # GeoJSON Polygon of the parcel outline
        "source": None,
        "county": None,
        "note": note,
    }


# ---------------------------------------------------------------------------
# The registry: one entry per verified county.
#
# "bbox" is a rough lat/lon rectangle around the county so we only query the
# server that could actually contain the point (no point asking Seattle's
# server about a spot in Miami).
#
# "fields" maps our standard names to that county's column names. None means
# the county does not publish that field. "field_note" explains the gaps.
# ---------------------------------------------------------------------------
COUNTY_REGISTRY = [
    {
        "county": "Maricopa County, AZ",
        "url": ("https://gis.mcassessor.maricopa.gov/arcgis/rest/services/"
                "Parcels/MapServer/0/query"),
        "bbox": (32.4, -113.4, 34.1, -111.0),   # (min_lat, min_lon, max_lat, max_lon)
        "fields": {
            "parcel_id": "APN",
            "owner": "OWNER_NAME",
            "address": "PHYSICAL_ADDRESS",
            "acreage": None,          # not published; we compute from geometry
            "land_use": None,
            "zoning": None,
            "assessed_value": None,
            "last_sale_price": None,
            "last_sale_date": None,
        },
        "field_note": ("Maricopa publishes APN, owner, and address. Values, "
                       "zoning, and sales are not in this layer; acreage is "
                       "computed from the boundary geometry."),
    },
    {
        "county": "Travis County, TX",
        "url": ("https://gis.traviscountytx.gov/server1/rest/services/"
                "Boundaries_and_Jurisdictions/TCAD_public/MapServer/0/query"),
        "bbox": (30.0, -98.2, 30.65, -97.35),
        "fields": {
            "parcel_id": "geo_id",
            "owner": None,            # TCAD public layer omits owner names
            "address": "situs_address",
            "acreage": "tcad_acres",
            "land_use": None,
            "zoning": None,
            "assessed_value": None,
            "last_sale_price": None,
            "last_sale_date": None,
        },
        "field_note": ("Travis publishes parcel id, address, and acreage. "
                       "Owner, values, and sales are not in the public layer "
                       "(available from TCAD's website by parcel id)."),
    },
    {
        "county": "King County, WA",
        "url": ("https://gismaps.kingcounty.gov/arcgis/rest/services/"
                "Property/KingCo_Parcels/MapServer/0/query"),
        "bbox": (47.05, -122.55, 47.8, -121.0),
        "fields": {
            "parcel_id": "PIN",
            "owner": None,
            "address": None,
            "acreage": None,
            "land_use": None,
            "zoning": None,
            "assessed_value": None,
            "last_sale_price": None,
            "last_sale_date": None,
        },
        "field_note": ("King County's map layer publishes boundary and PIN "
                       "only; other attributes live in a separate assessor "
                       "database. Acreage is computed from the boundary."),
    },
    {
        "county": "Mecklenburg County, NC",
        "url": ("https://gis.charlottenc.gov/arcgis/rest/services/"
                "CountyData/Parcels/MapServer/0/query"),
        "bbox": (35.0, -81.1, 35.55, -80.55),
        "fields": {
            "parcel_id": "PID",
            "owner": None,
            "address": None,
            "acreage": None,
            "land_use": None,
            "zoning": None,
            "assessed_value": None,
            "last_sale_price": None,
            "last_sale_date": None,
        },
        "field_note": ("Mecklenburg's map layer publishes boundary and PID "
                       "only; CAMA attributes are a separate download. "
                       "Acreage is computed from the boundary."),
    },
    {
        "county": "Miami-Dade County, FL",
        "url": ("https://gisweb.miamidade.gov/arcgis/rest/services/"
                "MD_LandInformation/MapServer/26/query"),
        "bbox": (25.1, -80.9, 26.0, -80.05),
        "fields": {
            "parcel_id": "FOLIO",
            "owner": "TRUE_OWNER1",
            "address": "TRUE_SITE_ADDR",
            "acreage": None,          # LOT_SIZE is in sq ft; handled specially
            "land_use": "DOR_DESC",
            "zoning": "PRIMARY_ZONE",
            "assessed_value": "TOTAL_VAL_CUR",
            "last_sale_price": None,
            "last_sale_date": None,
        },
        # Miami-Dade special: LOT_SIZE (sq ft) converts to acreage below.
        "lot_size_sqft_field": "LOT_SIZE",
        "field_note": ("Miami-Dade publishes folio, owner, address, land use, "
                       "zoning, and assessed value. Sale history is not in "
                       "this layer."),
    },
]


class CountyArcGISParcelSource(ParcelSource):
    """
    The pilot source: point-in-polygon queries against county ArcGIS servers.

    How a lookup works:
      1. Find registry entries whose bounding box contains the point.
      2. POST an ArcGIS point query ("which parcel polygon contains this
         lat/lon?") to that county's server.
      3. Translate the county's field names into our standard dict.
      4. If the county did not publish acreage, compute it from the boundary
         polygon (flatten to local meters, let shapely measure the area).
    """

    def __init__(self, registry: list | None = None, timeout: int = 15):
        self.registry = registry if registry is not None else COUNTY_REGISTRY
        self.timeout = timeout

    def get_parcel(self, lat: float, lon: float) -> dict:
        # Step 1: which counties could contain this point?
        matches = [c for c in self.registry if self._in_bbox(c, lat, lon)]
        if not matches:
            return _empty_parcel(
                "no_coverage",
                "No free county parcel source covers this location yet. "
                "Pilot counties: "
                + ", ".join(c["county"] for c in self.registry) + ".",
            )

        errors = []
        for county in matches:
            try:
                parcel = self._query_county(county, lat, lon)
            except Exception as e:
                errors.append(f"{county['county']}: {type(e).__name__}: {e}")
                continue
            if parcel is not None:
                return parcel

        if errors:
            return _empty_parcel(
                "unavailable",
                "Parcel server(s) could not be reached: " + "; ".join(errors)
                + ". Treat as unknown, not as vacant.",
            )
        # Server answered but no parcel contains the point (street, water,
        # public right-of-way). That is a real answer, not an error.
        return _empty_parcel(
            "ok",
            "No parcel found at this exact point (it may be a road, water, "
            "or unparceled public land). County checked: "
            + ", ".join(c["county"] for c in matches) + ".",
        )

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _in_bbox(county: dict, lat: float, lon: float) -> bool:
        min_lat, min_lon, max_lat, max_lon = county["bbox"]
        return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon

    def _query_county(self, county: dict, lat: float, lon: float):
        """Query one county. Returns the standard dict, or None if no hit."""
        params = {
            "geometry": json.dumps({"x": lon, "y": lat,
                                    "spatialReference": {"wkid": 4326}}),
            "geometryType": "esriGeometryPoint",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": 4326,
            "f": "json",
        }
        resp = requests.post(county["url"], data=params, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"server error: {data['error']}")

        feats = data.get("features", [])
        if not feats:
            return None

        fields = county["fields"]

        # Some counties stack "placeholder" polygons (id of all zeros) over
        # rights-of-way on top of real parcels. Prefer a feature with a real
        # parcel id; fall back to the first feature if none qualifies.
        def looks_real(feat):
            pid = feat.get("attributes", {}).get(fields.get("parcel_id"))
            return pid not in (None, "") and str(pid).strip("0") != ""

        chosen = next((f for f in feats if looks_real(f)), feats[0])
        attrs = chosen.get("attributes", {})
        geometry = chosen.get("geometry", {})

        def grab(std_name):
            col = fields.get(std_name)
            return attrs.get(col) if col else None

        # Boundary: esri rings (lon/lat) -> GeoJSON Polygon.
        # GeoJSON coordinates are [lon, lat], same order esri uses, so the
        # rings copy straight across.
        rings = geometry.get("rings") or []
        boundary = {"type": "Polygon", "coordinates": rings} if rings else None

        # Acreage: prefer the county's own number, then a published lot size
        # in square feet, then compute from the boundary geometry.
        acreage = grab("acreage")
        if acreage is None:
            sqft_field = county.get("lot_size_sqft_field")
            lot_sqft = attrs.get(sqft_field) if sqft_field else None
            if lot_sqft:
                acreage = round(float(lot_sqft) / SQFT_PER_ACRE, 4)
        if acreage is None and rings:
            acreage = self._acreage_from_rings(rings)

        parcel = _empty_parcel("ok", county["field_note"])
        parcel.update({
            "parcel_id": grab("parcel_id"),
            "owner": grab("owner"),
            "address": grab("address"),
            "acreage": acreage,
            "land_use": grab("land_use"),
            "zoning": grab("zoning"),
            "assessed_value": grab("assessed_value"),
            "last_sale_price": grab("last_sale_price"),
            "last_sale_date": grab("last_sale_date"),
            "boundary": boundary,
            "source": county["url"].split("/query")[0],
            "county": county["county"],
        })
        return parcel

    @staticmethod
    def _acreage_from_rings(rings: list) -> float | None:
        """
        Measure a parcel's area from its lat/lon outline.

        Same trick as the context layers: flatten the small patch of Earth
        onto a local meter grid (1 deg lat = ~111,320 m, longitude scaled by
        cos(lat)), then let shapely compute the area and convert to acres.
        """
        best = 0.0
        for ring in rings:
            if len(ring) < 3:
                continue
            ref_lat = sum(p[1] for p in ring) / len(ring)
            ref_lon = sum(p[0] for p in ring) / len(ring)
            m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(ref_lat))
            pts = [((lo - ref_lon) * m_per_deg_lon,
                    (la - ref_lat) * M_PER_DEG_LAT) for lo, la in ring]
            poly = ShapelyPolygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            best = max(best, poly.area)
        if best == 0.0:
            return None
        return round(best / SQM_PER_ACRE, 4)


# The default source the API uses. Swapping to Regrid later means changing
# this ONE line to RegridParcelSource() once that class exists.
def get_parcel(lat: float, lon: float) -> dict:
    """Module-level convenience wrapper around the default pilot source."""
    return CountyArcGISParcelSource().get_parcel(lat, lon)


# ===========================================================================
# Quick live self-test against all five pilot counties plus a no-coverage
# spot. Run:  python fetchers/parcel_fetcher.py    (needs internet)
# ===========================================================================
if __name__ == "__main__":
    spots = {
        "Phoenix, AZ (Maricopa)": (33.4484, -112.0740),
        "Austin, TX (Travis)": (30.2355, -97.8215),
        "Seattle, WA (King)": (47.6062, -122.3321),
        "Charlotte, NC (Mecklenburg)": (35.2100, -80.8100),
        "Miami, FL (Miami-Dade)": (25.8994, -80.2366),
        "Rural Kansas (no coverage)": (38.5, -98.5),
    }
    for name, (lat, lon) in spots.items():
        p = get_parcel(lat, lon)
        print("=" * 64)
        print(f"{name}  [{p['status']}]")
        print(f"  id={p['parcel_id']}  owner={p['owner']}")
        print(f"  acreage={p['acreage']}  value={p['assessed_value']}  "
              f"zoning={p['zoning']}  land_use={p['land_use']}")
        print(f"  county={p['county']}")
        print(f"  note={p['note'][:110]}")
