#!/usr/bin/env python3
"""Build the home hero's dot map from Natural Earth 1:50m land TopoJSON.

Source: https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json
Usage: python3 scripts/generate-hero-pixel-map.py /path/to/land-50m.json
The generated SVG is static; no map data is fetched in the browser.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "hero" / "pixel-world.svg"


def decode_topology(path):
    topology = json.loads(Path(path).read_text())
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
        return points

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
    for rings, boxes in candidates:
        x1, y1, x2, y2 = boxes[0]
        if not (x1 <= lon <= x2 and y1 <= lat <= y2):
            continue
        if not in_ring(lon, lat, rings[0]):
            continue
        if any(
            box[0] <= lon <= box[2] and box[1] <= lat <= box[3] and in_ring(lon, lat, ring)
            for ring, box in zip(rings[1:], boxes[1:])
        ):
            continue
        return True
    return False


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Pass the Natural Earth 1:50m land TopoJSON path")
    polygons = decode_topology(sys.argv[1])
    paths = {"soft": [], "bright": [], "deep": [], "gold": []}
    # A 0.9° grid produces small, dense 2–3px squares at the 1676px reference size.
    for row in range(157):
        lat = 82 - row * 0.9
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for column in range(400):
            lon = -179.55 + column * 0.9
            if not is_land(lon, lat, candidates):
                continue
            # Wrap in the Atlantic: Europe/Africa left, Asia center, Americas right.
            unit_x = ((lon + 30) % 360) / 360
            # Compress the Americas toward the right-hand arc, as in the
            # reference's panoramic projection, while preserving coastlines.
            if unit_x > 0.7:
                unit_x = 0.7 + (unit_x - 0.7) * 0.7
            x = 260 + unit_x * 1380
            edge = abs((x - 838) / 650)
            y = 4 + (86 - lat) * 3.16 + 92 * edge * edge
            upper_arc = 13 + 100 * ((x - 838) / 838) ** 2
            if y < upper_arc or y > 438:
                continue
            # Let the world dissolve into the scattered edge particles instead
            # of exposing the hard seam where longitude wraps around.
            edge_fade = min(1.0, (x - 255) / 90, (1530 - x) / 100)
            if ((column * 73856093) ^ (row * 19349663)) % 101 > edge_fade * 100:
                continue
            noise = (column * 37 + row * 53) % 101
            if noise < 8:
                group = "gold"
            elif y < 112 and noise < 70:
                group = "soft"
            elif noise < 34:
                group = "bright"
            elif noise < 91:
                group = "deep"
            else:
                group = "soft"
            size = 2.1 if edge < 0.76 else 1.9
            paths[group].append(f"M{x:.1f} {y:.1f}h{size:.1f}v{size:.1f}h-{size:.1f}z")

    colors = {
        "soft": ("#BDD4FF", ".75"),
        "bright": ("#6398FF", ".88"),
        "deep": ("#2662FF", ".92"),
        "gold": ("#FFC21A", ".83"),
    }
    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1676" height="460" viewBox="0 0 1676 460" fill="none">',
        '<!-- Derived from Natural Earth 1:50m land via world-atlas@2. -->',
    ]
    for name, segments in paths.items():
        color, opacity = colors[name]
        lines.append(f'<path fill="{color}" opacity="{opacity}" d="{"".join(segments)}"/>')
    lines.append('</svg>')
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUTPUT} with {sum(map(len, paths.values()))} dots")


if __name__ == "__main__":
    main()
