"""
fetchers/photo_fetcher.py
=========================
TerraPhoto's data source: extract location from uploaded photos, then
fetch the best available elevation data for that location.

Why are photos more accurate than clicking on a map?
  A user clicking on a map is lucky to land within 50 meters of what they
  intend. A smartphone photo contains GPS coordinates in its EXIF metadata —
  the location where the photo was taken — accurate to ±3-5 meters. When a
  user uploads 5-20 photos of a site, we get multiple precise GPS fixes that
  together define both the center and the extent of the survey area.

What is EXIF?
  Every photo file (JPEG in particular) contains a hidden block of metadata
  called EXIF (Exchangeable Image File Format). It records the camera model,
  shutter speed, focal length, date/time — and, for phones, the GPS latitude,
  longitude, and altitude. We read this with Pillow, a Python imaging library.

What we do:
  1. Read GPS from EXIF in each photo.
  2. Average the positions to get the survey center.
  3. Use the spread of GPS points to estimate how large the area is.
  4. Fetch USGS 3DEP (US) or Open-Elevation (global) for that area.
  5. Return the same DEMResult the engine always expects.
"""

from __future__ import annotations

import math
from io import BytesIO
from typing import Optional

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

from fetchers.dem_source import DEMFetcher, DEMResult, OpenElevationFetcher


# Minimum survey size if only one photo is uploaded — we have a point but
# no sense of scale, so we default to a 200m x 200m area.
DEFAULT_AREA_M = 200.0

# If GPS points spread over a large distance, cap the survey area to avoid
# fetching hundreds of megabytes of elevation data.
MAX_SURVEY_SIDE_M = 2000.0


class PhotoFetcher(DEMFetcher):
    """
    Extracts GPS location from uploaded photo EXIF and fetches elevation data
    for that location at the highest available resolution.
    """

    def extract_location(self, image_bytes_list: list[bytes]) -> dict:
        """
        Given a list of raw image file bytes, extract GPS coordinates from
        each image's EXIF and compute the survey area.

        Returns a dict with keys:
          gps_found  — True if at least one photo had GPS
          lat        — center latitude (None if no GPS found)
          lon        — center longitude (None if no GPS found)
          width_m    — estimated survey width in meters
          height_m   — estimated survey height in meters
          note       — human-readable description of what we found
          gps_points — list of (lat, lon) extracted from photos
        """
        gps_points = []

        for raw_bytes in image_bytes_list:
            try:
                coords = self._extract_gps(raw_bytes)
                if coords is not None:
                    gps_points.append(coords)
            except Exception:
                # Skip images that can't be read — continue with the rest.
                pass

        if not gps_points:
            return {
                "gps_found": False,
                "lat": None,
                "lon": None,
                "width_m": DEFAULT_AREA_M,
                "height_m": DEFAULT_AREA_M,
                "note": "No GPS data found in uploaded photos.",
                "gps_points": [],
            }

        # Center = average of all GPS points
        center_lat = sum(p[0] for p in gps_points) / len(gps_points)
        center_lon = sum(p[1] for p in gps_points) / len(gps_points)

        # Estimate survey size from the spread of GPS points.
        width_m, height_m = self._estimate_area(gps_points, center_lat)

        note = (
            f"GPS extracted from {len(gps_points)}/{len(image_bytes_list)} photo(s). "
            f"Survey area estimated at {width_m:.0f}m × {height_m:.0f}m. "
            f"Center: {center_lat:.5f}°, {center_lon:.5f}°."
        )

        return {
            "gps_found": True,
            "lat": center_lat,
            "lon": center_lon,
            "width_m": width_m,
            "height_m": height_m,
            "note": note,
            "gps_points": gps_points,
        }

    def get_dem(self, lat: float, lon: float,
                width_m: float, height_m: float,
                resolution_m: float) -> DEMResult:
        """
        Fetch elevation data at the GPS-extracted location.
        Tries USGS 3DEP first (US-only, 1m/±0.2m), falls back globally.
        """
        try:
            from fetchers.usgs_fetcher import USGS3DEPFetcher
            fetcher = USGS3DEPFetcher()
            result = fetcher.get_dem(lat, lon, width_m, height_m, resolution_m)
            # Upgrade the note to explain the combined accuracy improvement
            result.note = (
                f"USGS 3DEP 1m lidar at GPS-precise location. "
                f"Location accuracy: ±3-5m (phone GPS). "
                f"Elevation accuracy: ±{result.vertical_error}m."
            )
            return result
        except Exception:
            # Fall back to Open-Elevation for non-US or when USGS fails
            fetcher = OpenElevationFetcher()
            result = fetcher.get_dem(lat, lon, width_m, height_m, resolution_m)
            result.note = (
                f"Open-Elevation at GPS-precise location. "
                f"Location accuracy: ±3-5m (phone GPS). "
                f"Elevation accuracy: ±{result.vertical_error}m. "
                f"Use USGS 3DEP for US sites for 25x better elevation accuracy."
            )
            return result

    # -----------------------------------------------------------------------
    # Private helpers
    # -----------------------------------------------------------------------

    def _extract_gps(self, raw_bytes: bytes) -> Optional[tuple[float, float]]:
        """
        Open an image from raw bytes and extract its GPS lat/lon from EXIF.
        Returns (lat, lon) in decimal degrees, or None if not found.
        """
        img = Image.open(BytesIO(raw_bytes))

        # Pillow exposes EXIF through _getexif() for JPEG files.
        # Some PNG or HEIC files store EXIF differently — we handle None gracefully.
        exif_raw = img._getexif() if hasattr(img, "_getexif") else None
        if not exif_raw:
            return None

        # EXIF is a dict of {tag_number: value}. We need to look up the
        # human-readable tag name to find "GPSInfo".
        gps_data = {}
        for tag_id, value in exif_raw.items():
            tag_name = TAGS.get(tag_id, str(tag_id))
            if tag_name == "GPSInfo":
                # GPSInfo is itself a nested dict with GPS-specific sub-tags.
                for gps_tag_id, gps_value in value.items():
                    gps_tag_name = GPSTAGS.get(gps_tag_id, str(gps_tag_id))
                    gps_data[gps_tag_name] = gps_value
                break

        if "GPSLatitude" not in gps_data or "GPSLongitude" not in gps_data:
            return None

        lat = self._dms_to_decimal(
            gps_data["GPSLatitude"],
            gps_data.get("GPSLatitudeRef", "N"),
        )
        lon = self._dms_to_decimal(
            gps_data["GPSLongitude"],
            gps_data.get("GPSLongitudeRef", "E"),
        )

        return lat, lon

    def _dms_to_decimal(self, dms, ref: str) -> float:
        """
        Convert GPS coordinates from Degrees-Minutes-Seconds format to
        decimal degrees. GPS EXIF stores lat/lon as (degrees, minutes, seconds)
        tuples; decimal degrees = degrees + minutes/60 + seconds/3600.

        'ref' is "N"/"S" for latitude or "E"/"W" for longitude.
        Southern latitudes and Western longitudes are negative.
        """
        # Each component can be an IFDRational or a plain number — normalize to float.
        d = float(dms[0])
        m = float(dms[1])
        s = float(dms[2])
        decimal = d + m / 60.0 + s / 3600.0
        if ref in ("S", "W"):
            decimal = -decimal
        return decimal

    def _estimate_area(self, gps_points: list[tuple[float, float]],
                       center_lat: float) -> tuple[float, float]:
        """
        Given a list of (lat, lon) GPS points, estimate the width and height
        of the survey area in meters.

        If only one photo → use DEFAULT_AREA_M.
        If multiple photos → use the bounding box of all GPS points, padded
        by 25% so the area includes a margin around the photo locations.
        """
        if len(gps_points) < 2:
            return DEFAULT_AREA_M, DEFAULT_AREA_M

        lats = [p[0] for p in gps_points]
        lons = [p[1] for p in gps_points]

        lat_span = max(lats) - min(lats)
        lon_span = max(lons) - min(lons)

        # Degrees to meters conversion at this latitude
        m_per_deg_lat = 111_320.0
        m_per_deg_lon = 111_320.0 * math.cos(math.radians(center_lat))

        height_m = lat_span * m_per_deg_lat * 1.25   # 25% padding
        width_m = lon_span * m_per_deg_lon * 1.25

        # Apply sane minimums and maximums
        width_m = max(DEFAULT_AREA_M, min(width_m, MAX_SURVEY_SIDE_M))
        height_m = max(DEFAULT_AREA_M, min(height_m, MAX_SURVEY_SIDE_M))

        return width_m, height_m
