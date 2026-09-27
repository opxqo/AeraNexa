#!/usr/bin/env python3
"""Draw the 3D globe demo's land (Natural Earth 1:110m, the same source as
world-globe-points.json) as a horizontal arch, styled like the globe: evenly
spaced round interior dots plus a crisp dotted coastline.

Uses the same seam longitude, latitude window and vertical bulge as
scripts/generate-demo-arch-map.py. Dots are sampled on a staggered grid in
*projected* pixels (not in degrees), because the arch squeezes latitude and a
degree grid turns into vertical stripes.
Run ``python3 scripts/generate-demo-arch-map-globe.py --check`` to verify.
"""

import argparse
import hashlib
import json
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "data" / "land-110m.json"
OUTPUT = ROOT / "public" / "demo"
WIDTH = 1600
HEIGHT = 560
SEAM_LONGITUDE = -30
NORTH = 84
SOUTH = -60


def bulge(x):
    return 100 * ((x - WIDTH / 2) / (WIDTH / 2)) ** 2


def project(lon, lat):
    x = ((lon - SEAM_LONGITUDE) % 360) / 360 * WIDTH
    return x, 26 + (NORTH - lat) * 3 + bulge(x)


def unproject(x, y):
    lat = NORTH - (y - 26 - bulge(x)) / 3
    lon = (x / WIDTH * 360 + SEAM_LONGITUDE + 180) % 360 - 180
    return lon, lat


def coastline(polygons, spacing, min_perimeter):
    """Dots at even projected spacing along every land ring."""
    dots = []
    for rings, _ in polygons:
        for ring in rings:
            path = [project(lon, lat) for lon, lat in ring if SOUTH <= lat <= NORTH]
            segments = [(a, b) for a, b in zip(path, path[1:]) if abs(b[0] - a[0]) < WIDTH / 4]
            perimeter = sum(math.dist(a, b) for a, b in segments)
            if perimeter < min_perimeter:
                continue
            carry = 0.0
            for a, b in segments:
                length = math.dist(a, b)
                position = carry
                while position < length:
                    t = position / length
                    dots.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                    position += spacing
                carry = position - length
    return [(x, y) for x, y in dots if 0 <= x <= WIDTH and 0 <= y <= HEIGHT]


def interior(polygons, is_land, column_gap, row_gap, coast, clearance):
    """Staggered grid of land dots, kept clear of the coastline dots."""
    cell = clearance
    buckets = {}
    for x, y in coast:
        buckets.setdefault((int(x // cell), int(y // cell)), []).append((x, y))

    def near_coast(x, y):
        cx, cy = int(x // cell), int(y // cell)
        return any(
            math.dist((x, y), point) < clearance
            for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            for point in buckets.get((cx + dx, cy + dy), ())
        )

    dots = []
    row = 0
    y = row_gap / 2
    while y < HEIGHT:
        x = column_gap / 2 + (column_gap / 2 if row % 2 else 0)
        while x < WIDTH:
            lon, lat = unproject(x, y)
            if SOUTH <= lat <= NORTH:
                candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
                if is_land(lon, lat, candidates) and not near_coast(x, y):
                    dots.append((x, y))
            x += column_gap
        y += row_gap
        row += 1
    return dots


def circles(points, radius):
    r = f"{radius:.2f}"
    d = f"{radius * 2:.2f}"
    return "".join(f"M{x - radius:.1f} {y:.1f}a{r} {r} 0 1 0 {d} 0a{r} {r} 0 1 0 -{d} 0" for x, y in points)


def render(land, coast, land_radius, coast_radius):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" fill="none">\n'
        '<!-- Natural Earth 1:110m (same land as the 3D globe demo), arch-projected. -->\n'
        f'<g id="land-dots" fill="#2662FF" opacity=".72"><path d="{circles(land, land_radius)}"/></g>\n'
        f'<g id="coast-dots" fill="#2662FF" opacity=".95"><path d="{circles(coast, coast_radius)}"/></g>\n'
        '</svg>\n'
    )


def build(polygons, is_land, column_gap, row_gap, coast_spacing, clearance, min_perimeter):
    coast = coastline(polygons, coast_spacing, min_perimeter)
    land = interior(polygons, is_land, column_gap, row_gap, coast, clearance)
    return land, coast


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare generated assets without writing")
    args = parser.parse_args()

    geometry = runpy.run_path(str(ROOT / "scripts" / "generate-demo-world-map.py"))
    source_bytes = SOURCE.read_bytes()
    polygons = geometry["decode_topology"](json.loads(source_bytes))
    is_land = geometry["is_land"]

    land, coast = build(polygons, is_land, 6.0, 5.2, 2.6, 3.4, 14)
    mobile_land, mobile_coast = build(polygons, is_land, 14, 12, 6, 7, 40)

    def rounded(points):
        return [[round(x, 1), round(y, 1)] for x, y in points]

    manifest = {
        "viewBox": [0, 0, WIDTH, HEIGHT],
        "source": "Natural Earth 1:110m (world-globe-points.json source)",
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "seamLongitude": SEAM_LONGITUDE,
        "latitudeRange": [SOUTH, NORTH],
        "desktop": {"land": rounded(land), "coast": rounded(coast)},
        "mobile": {"land": rounded(mobile_land), "coast": rounded(mobile_coast)},
    }
    files = {
        OUTPUT / "world-map-arch-globe-desktop.svg": render(land, coast, 1.35, 1.05),
        OUTPUT / "world-map-arch-globe-mobile.svg": render(mobile_land, mobile_coast, 3.4, 2.6),
        OUTPUT / "world-map-arch-globe-points.json": json.dumps(manifest, separators=(",", ":")) + "\n",
    }
    if args.check:
        mismatches = [str(path) for path, content in files.items()
                      if not path.exists() or path.read_text() != content]
        if mismatches:
            raise SystemExit("Generated arch (globe source) assets differ: " + ", ".join(mismatches))
        print("Arch (globe source) assets are reproducible")
        return

    for path, content in files.items():
        path.write_text(content)
    print(f"Desktop: {len(land)} land + {len(coast)} coast dots; mobile: {len(mobile_land)} + {len(mobile_coast)}")


if __name__ == "__main__":
    main()
