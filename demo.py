"""
demo.py
=======
The whole free-tier pipeline in one place, end to end:

    a real location  ->  fetch a real DEM  ->  run real measurements

Run it:   python demo.py

This is your "does the whole thing actually work" script. When you start
adding features in Claude Code, keep this running green.
"""

from fetchers.dem_source import OpenElevationFetcher
from engine import measurements as M


def main():
    print("STEP 1 — pick a location and pull real elevation data")
    print("-" * 55)

    fetcher = OpenElevationFetcher()
    dem = fetcher.get_dem(
        lat=39.7392, lon=-105.5,     # a varied spot in the Colorado Rockies
        width_m=300, height_m=300,    # a 300m x 300m site
        resolution_m=30,              # one height every 30 meters
    )
    print(f"  Got a {dem.heights.shape} grid from {dem.source}")
    print(f"  Ground ranges {dem.heights.min():.0f}m to {dem.heights.max():.0f}m")
    print(f"  Source vertical error: +/-{dem.vertical_error}m")
    print(f"  Caveat: {dem.note}\n")

    print("STEP 2 — measure the terrain (3D, uses the DEM)")
    print("-" * 55)

    avg = M.average_slope(dem.heights, dem.cell_size,
                          vertical_error=dem.vertical_error)
    print(f"  Average slope: {avg}")

    # Cut/fill to flatten the whole site to its own average height.
    target = float(dem.heights.mean())
    vols = M.volume_to_grade(dem.heights, dem.cell_size, target_height=target,
                             vertical_error=dem.vertical_error)
    print(f"  To flatten this site to {target:.0f}m:")
    for name, m in vols.items():
        print(f"      {name:5}: {m}")

    print("\nSTEP 3 — measure a flat boundary (2D, no heights needed)")
    print("-" * 55)
    # Imagine the user drew a 100m x 60m rectangular lot.
    lot = [(0, 0), (100, 0), (100, 60), (0, 60)]
    print(f"  Lot area:      {M.polygon_area(lot, point_error=1.0)}")
    print(f"  Lot perimeter: {M.perimeter(lot, point_error=1.0)}")

    print("\nSTEP 4 — contour lines + PNG map images")
    print("-" * 55)
    c = M.contours(dem.heights, dem.cell_size)
    print(f"  {c.note}")

    images = M.render_images(dem.heights, dem.cell_size)
    # Save images locally so you can open and inspect them.
    for name, png_bytes in images.items():
        out_path = f"{name}.png"
        with open(out_path, "wb") as f:
            f.write(png_bytes)
        print(f"  Saved {out_path}  ({len(png_bytes):,} bytes)")

    print("\nDONE — location in, measurements out, no equipment used.")


if __name__ == "__main__":
    main()
