#!/usr/bin/env python3
"""Project the demo's verified land dots into a horizontal arch.

Reads world-map-points.json, so both demo views use identical geography and
longitude order. The generated coordinates can also drive later animations.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "demo"
SOURCE = OUTPUT / "world-map-points.json"
WIDTH = 1600
HEIGHT = 560
NORTH = 84
SOUTH = -60


def project(points, square_size, step_degrees, row_stride, column_stride):
    projected = []
    segments = []
    half = square_size / 2
    selected_count = 0
    source_step_x = WIDTH * step_degrees / 360
    source_step_y = 800 * step_degrees / 180
    for x, flat_y in points:
        latitude = 90 - flat_y / 800 * 180
        if not SOUTH <= latitude <= NORTH:
            continue
        row = round(flat_y / source_step_y - .5)
        column = round(x / source_step_x - .5)
        if row % row_stride or column % column_stride:
            continue
        selected_count += 1
        # A vertical arch retains the flat view's longitude positions. Its
        # centre rises while the edges bend down, like the homepage map.
        arch = 100 * ((x - WIDTH / 2) / (WIDTH / 2)) ** 2
        y = round(26 + (NORTH - latitude) * 3 + arch, 2)
        if not 0 <= y <= HEIGHT:
            raise ValueError(f"Land dot projected outside canvas: {x}, {latitude}, {y}")
        projected.append([x, y])
        segments.append(
            f"M{x-half:.2f} {y-half:.2f}"
            f"h{square_size:.2f}v{square_size:.2f}h-{square_size:.2f}z"
        )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" '
        'fill="none" shape-rendering="crispEdges">\n'
        '<!-- Same Natural Earth dots as the flat demo; polar latitudes omitted. -->\n'
        '<g id="land-dots" fill="#2662FF" opacity=".9">'
        f'<path d="{"".join(segments)}"/></g>\n'
        '</svg>\n'
    )
    assert projected and len(projected) == selected_count
    assert all(0 <= x <= WIDTH and 0 <= y <= HEIGHT for x, y in projected)
    return svg, projected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare assets without writing")
    args = parser.parse_args()
    source = json.loads(SOURCE.read_text())
    assert source["viewBox"] == [0, 0, WIDTH, 800]
    assert source["seamLongitude"] == -30

    # The arch compresses latitude rows. Sample every other row so square dots
    # remain separated rather than rasterizing into vertical stripes.
    desktop_svg, desktop_points = project(
        source["desktop"]["points"], 1.8,
        source["desktop"]["stepDegrees"], 2, 1,
    )
    mobile_svg, mobile_points = project(
        source["mobile"]["points"], 5.5,
        source["mobile"]["stepDegrees"], 2, 2,
    )
    manifest = {
        "viewBox": [0, 0, WIDTH, HEIGHT],
        "source": "world-map-points.json",
        "seamLongitude": source["seamLongitude"],
        "latitudeRange": [SOUTH, NORTH],
        "samplingStride": {"desktop": [2, 1], "mobile": [2, 2]},
        "desktop": {"points": desktop_points},
        "mobile": {"points": mobile_points},
    }
    files = {
        OUTPUT / "world-map-arch-desktop.svg": desktop_svg,
        OUTPUT / "world-map-arch-mobile.svg": mobile_svg,
        OUTPUT / "world-map-arch-points.json": json.dumps(manifest, separators=(",", ":")) + "\n",
    }
    if args.check:
        mismatches = [str(path) for path, content in files.items()
                      if not path.exists() or path.read_text() != content]
        if mismatches:
            raise SystemExit("Generated arch assets differ: " + ", ".join(mismatches))
        print("Arch map assets are reproducible")
        return

    for path, content in files.items():
        path.write_text(content)
    print(f"Generated {len(desktop_points)} desktop and {len(mobile_points)} mobile arch dots")


if __name__ == "__main__":
    main()
