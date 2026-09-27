#!/usr/bin/env python3
"""Generate the complete, Asia-centred dot map and future animation coordinates.

Input: scripts/data/land-50m.json (Natural Earth 1:50m via world-atlas@2).
The output is deterministic and independent of the home hero's curved map.
Run ``python3 scripts/generate-demo-world-map.py --check`` to verify assets.
"""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "data" / "land-50m.json"
OUTPUT = ROOT / "public" / "demo"
WIDTH = 1600
HEIGHT = 800
SEAM_LONGITUDE = -30


def decode_topology(topology):
    scale_x, scale_y = topology["transform"]["scale"]
    offset_x, offset_y = topology["transform"]["translate"]
    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for delta_x, delta_y in arc:
            x += delta_x
            y += delta_y
            points.append((x * scale_x + offset_x, y * scale_y + offset_y))
        arcs.append(points)

    def ring(indices):
        points = []
        for index in indices:
            part = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
            points.extend(part if not points else part[1:])
        # GeoJSON longitudes jump from +180 to -180 at the date line. Unwrap
        # each ring before planar containment tests so Siberia cannot become
        # an artificial horizontal band spanning the whole map.
        unwrapped = [points[0]]
        for lon, lat in points[1:]:
            while lon - unwrapped[-1][0] > 180:
                lon -= 360
            while lon - unwrapped[-1][0] < -180:
                lon += 360
            unwrapped.append((lon, lat))
        return unwrapped

    polygons = []
    for polygon in topology["objects"]["land"]["geometries"][0]["arcs"]:
        rings = [ring(indices) for indices in polygon]
        boxes = [
            (min(point[0] for point in item), min(point[1] for point in item),
             max(point[0] for point in item), max(point[1] for point in item))
            for item in rings
        ]
        polygons.append((rings, boxes))
    return polygons


def in_ring(lon, lat, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = current
        x2, y2 = previous
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def is_land(lon, lat, candidates):
    def contains(ring, box):
        if not box[1] <= lat <= box[3]:
            return False
        for shifted_lon in (lon - 360, lon, lon + 360):
            if box[0] <= shifted_lon <= box[2] and in_ring(shifted_lon, lat, ring):
                return True
        return False

    for rings, boxes in candidates:
        if not contains(rings[0], boxes[0]):
            continue
        if any(
            contains(ring, box)
            for ring, box in zip(rings[1:], boxes[1:])
        ):
            continue
        return True
    return False


def render_grid(polygons, step_degrees, square_size, opacity):
    columns = round(360 / step_degrees)
    rows = round(180 / step_degrees)
    half_square = square_size / 2
    points = []
    segments = []

    for row in range(rows):
        lat = 90 - (row + 0.5) * step_degrees
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for column in range(columns):
            lon = -180 + (column + 0.5) * step_degrees
            if not is_land(lon, lat, candidates):
                continue
            # The Atlantic seam places Asia near the centre without discarding
            # longitude, compressing the Americas, or clipping polar land.
            x = round(((lon - SEAM_LONGITUDE) % 360) / 360 * WIDTH, 2)
            y = round((90 - lat) / 180 * HEIGHT, 2)
            points.append([x, y])
            segments.append(
                f"M{x - half_square:.2f} {y - half_square:.2f}"
                f"h{square_size:.2f}v{square_size:.2f}h-{square_size:.2f}z"
            )

    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" '
        'fill="none" shape-rendering="crispEdges">\n'
        '<!-- Natural Earth 1:50m land, Asia-centred equirectangular projection. -->\n'
        f'<g id="land-dots" fill="#2662FF" opacity="{opacity}">'
        f'<path d="{"".join(segments)}"/></g>\n'
        '</svg>\n'
    )
    assert points and all(0 <= x <= WIDTH and 0 <= y <= HEIGHT for x, y in points)
    return svg, points


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare generated content without writing")
    args = parser.parse_args()
    source_bytes = SOURCE.read_bytes()
    polygons = decode_topology(json.loads(source_bytes))
    for lon, lat in [(20, 0), (10, 50), (100, 30), (-100, 40),
                     (-60, -10), (135, -25), (0, -80)]:
        assert is_land(lon, lat, polygons), f"Missing continent near {lon}, {lat}"

    desktop_svg, desktop_points = render_grid(polygons, 0.75, 2.0, ".86")
    mobile_svg, mobile_points = render_grid(polygons, 1.5, 4.0, ".94")
    manifest = {
        "viewBox": [0, 0, WIDTH, HEIGHT],
        "projection": "equirectangular",
        "seamLongitude": SEAM_LONGITUDE,
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "desktop": {"stepDegrees": 0.75, "points": desktop_points},
        "mobile": {"stepDegrees": 1.5, "points": mobile_points},
    }
    files = {
        OUTPUT / "world-map-desktop.svg": desktop_svg,
        OUTPUT / "world-map-mobile.svg": mobile_svg,
        OUTPUT / "world-map-points.json": json.dumps(manifest, separators=(",", ":")) + "\n",
    }
    if args.check:
        mismatches = [str(path) for path, content in files.items()
                      if not path.exists() or path.read_text() != content]
        if mismatches:
            raise SystemExit("Generated map assets differ: " + ", ".join(mismatches))
        print("Map assets are reproducible")
        return

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for path, content in files.items():
        path.write_text(content)
    print(f"Generated {len(desktop_points)} desktop and {len(mobile_points)} mobile land dots")


if __name__ == "__main__":
    main()
