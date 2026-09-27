#!/usr/bin/env python3
"""Generate reproducible land points for the standalone Three.js globe demo.

Source: world-atlas@2 land-110m.json (Natural Earth 1:110m).
Run with --check to verify the committed browser asset.
"""

import argparse
import hashlib
import json
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "data" / "land-110m.json"
OUTPUT = ROOT / "public" / "demo" / "world-globe-points.json"
STEP_DEGREES = 1.2


def generate():
    # Share the same dateline-safe containment logic as the flat map demo.
    geometry = runpy.run_path(str(ROOT / "scripts" / "generate-demo-world-map.py"))
    source = SOURCE.read_bytes()
    polygons = geometry["decode_topology"](json.loads(source))
    is_land = geometry["is_land"]
    points = []
    edge_points = set()

    for rings, _ in polygons:
        for ring in rings:
            for start, end in zip(ring, ring[1:]):
                lon_a, lat_a = start
                lon_b, lat_b = end
                distance = max(abs(lon_b - lon_a) * math.cos(math.radians((lat_a + lat_b) / 2)), abs(lat_b - lat_a))
                steps = max(1, math.ceil(distance / 0.9))
                for index in range(steps + 1):
                    t = index / steps
                    longitude = ((lon_a + (lon_b - lon_a) * t + 180) % 360) - 180
                    latitude = lat_a + (lat_b - lat_a) * t
                    edge_points.add((round(longitude, 3), round(latitude, 3)))

    for row in range(round(180 / STEP_DEGREES)):
        lat = 90 - (row + 0.5) * STEP_DEGREES
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for column in range(round(360 / STEP_DEGREES)):
            lon = -180 + (column + 0.5) * STEP_DEGREES
            if is_land(lon, lat, candidates):
                points.extend((round(lon, 2), round(lat, 2)))

    assert len(points) > 20000 and len(points) % 2 == 0
    edges = [coordinate for point in sorted(edge_points) for coordinate in point]
    return json.dumps({
        "source": "Natural Earth 1:110m via world-atlas@2",
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "stepDegrees": STEP_DEGREES,
        "pointCount": len(points) // 2,
        "points": points,
        "edgePointCount": len(edge_points),
        "edgePoints": edges,
    }, separators=(",", ":")) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = generate()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != content:
            raise SystemExit("Generated globe point asset differs")
        print("Globe point asset is reproducible")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(content)
    print(f"Generated {json.loads(content)['pointCount']} globe land dots")


if __name__ == "__main__":
    main()
