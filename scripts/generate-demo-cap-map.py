#!/usr/bin/env python3
"""Draw the world as a large, cropped spherical cap: the map wrapped onto a
tilted sphere and seen in perspective, filling the width with the sides and
bottom running out of frame.

Only the shape differs from /demo/world-map/arch-3d; the dot style is the
same (see scripts/generate-demo-arch-map-globe.py): evenly spaced round land
dots on a staggered screen grid, a dotted coastline, and a gap between them.
Screen-grid dots are traced back onto the sphere to test for land.

Land comes from Natural Earth 1:110m (the 3D globe demo's source). Keep the
projection constants in sync with src/lib/demo/cap-projection.ts.
Run ``python3 scripts/generate-demo-cap-map.py --check`` to verify.
"""

import argparse
import base64
import json
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "data" / "land-110m.json"
OUTPUT = ROOT / "public" / "demo"

# --- projection (mirror of src/lib/demo/cap-projection.ts) ---
VIEW_WIDTH = 1600
VIEW_HEIGHT = 640
SEAM_LONGITUDE = -95  # seam through North America puts Asia near the centre
NORTH = 84
SOUTH = -60
LAT_CENTER = (NORTH + SOUTH) / 2
SPAN_LON = 0.28
SPAN_LAT = 0.18
TILT = math.radians(33)
CAMERA = 2.75
FRAME_EDGE = 14       # map longitudes this far inside the seam touch the view's sides
FRAME_EDGE_LAT = 25
TOP_Y = 40            # where the top of the cap rim sits
HALF_THETA = 180 * SPAN_LON
PHI_MIN, PHI_MAX = (SOUTH - LAT_CENTER) * SPAN_LAT, (NORTH - LAT_CENTER) * SPAN_LAT


def sphere_angles(lon, lat):
    theta = (((lon - SEAM_LONGITUDE) % 360) - 180) * SPAN_LON
    return theta, (lat - LAT_CENTER) * SPAN_LAT


def lonlat(theta, phi):
    lon = (theta / SPAN_LON + 180 + SEAM_LONGITUDE + 180) % 360 - 180
    return lon, phi / SPAN_LAT + LAT_CENTER


def raw(theta, phi):
    t, p = math.radians(theta), math.radians(phi)
    x = math.cos(p) * math.sin(t)
    y0, z0 = math.sin(p), math.cos(p) * math.cos(t)
    y = y0 * math.cos(TILT) + z0 * math.sin(TILT)
    z = -y0 * math.sin(TILT) + z0 * math.cos(TILT)
    depth = CAMERA - z
    return x / depth, -y / depth


def frame():
    left = raw(*sphere_angles(SEAM_LONGITUDE + FRAME_EDGE, FRAME_EDGE_LAT))[0]
    right = raw(*sphere_angles(SEAM_LONGITUDE - FRAME_EDGE, FRAME_EDGE_LAT))[0]
    scale = VIEW_WIDTH / (right - left)
    top = raw(*sphere_angles(SEAM_LONGITUDE + 180, NORTH))[1]
    return scale, VIEW_WIDTH / 2 - (left + right) / 2 * scale, TOP_Y - top * scale


SCALE, OFFSET_X, OFFSET_Y = frame()


def project(theta, phi):
    x, y = raw(theta, phi)
    return x * SCALE + OFFSET_X, y * SCALE + OFFSET_Y


def unproject(px, py):
    """Trace a screen point back to (theta, phi) on the front of the sphere."""
    u = (px - OFFSET_X) / SCALE
    v = -(py - OFFSET_Y) / SCALE
    a = u * u + v * v + 1
    disc = CAMERA * CAMERA - a * (CAMERA * CAMERA - 1)
    if disc < 0:
        return None
    s = (CAMERA - math.sqrt(disc)) / a
    x, y, z = u * s, v * s, CAMERA - s
    y0 = y * math.cos(TILT) - z * math.sin(TILT)
    z0 = y * math.sin(TILT) + z * math.cos(TILT)
    phi = math.degrees(math.asin(max(-1, min(1, y0))))
    theta = math.degrees(math.atan2(x, z0))
    if not (-HALF_THETA <= theta <= HALF_THETA and PHI_MIN <= phi <= PHI_MAX):
        return None
    return theta, phi


def inside(x, y, pad=4):
    return -pad <= x <= VIEW_WIDTH + pad and -pad <= y <= VIEW_HEIGHT + pad


# --- sampling (same approach as the arch-3d generator, in screen pixels) ---
def coastline(polygons, spacing, min_perimeter):
    dots = []
    for rings, _ in polygons:
        for ring in rings:
            path = []
            for lon, lat in ring:
                if SOUTH <= lat <= NORTH:
                    theta, phi = sphere_angles(lon, lat)
                    path.append((theta, project(theta, phi)))
            segments = [(a[1], b[1]) for a, b in zip(path, path[1:]) if abs(b[0] - a[0]) < 30]
            if sum(math.dist(a, b) for a, b in segments) < min_perimeter:
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
    return [(x, y) for x, y in dots if inside(x, y)]


def interior(polygons, is_land, column_gap, row_gap, coast, clearance):
    buckets = {}
    for x, y in coast:
        buckets.setdefault((int(x // clearance), int(y // clearance)), []).append((x, y))

    def near_coast(x, y):
        cx, cy = int(x // clearance), int(y // clearance)
        return any(
            math.dist((x, y), point) < clearance
            for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            for point in buckets.get((cx + dx, cy + dy), ())
        )

    dots = []
    row = 0
    y = row_gap / 2
    while y < VIEW_HEIGHT:
        x = column_gap / 2 + (column_gap / 2 if row % 2 else 0)
        while x < VIEW_WIDTH:
            hit = unproject(x, y)
            if hit:
                lon, lat = lonlat(*hit)
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
        f'width="{VIEW_WIDTH}" height="{VIEW_HEIGHT}" viewBox="0 0 {VIEW_WIDTH} {VIEW_HEIGHT}" fill="none">\n'
        '<!-- Natural Earth 1:110m (same land as the 3D globe demo) on a cropped spherical cap. -->\n'
        f'<g id="land-dots" fill="#2662FF" opacity=".72"><path d="{circles(land, land_radius)}"/></g>\n'
        f'<g id="coast-dots" fill="#2662FF" opacity=".95"><path d="{circles(coast, coast_radius)}"/></g>\n'
        '</svg>\n'
    )


MASK_STEP = 0.5  # degrees per land-mask cell


def runtime_data(polygons, is_land):
    """Land mask and coastline rings for the in-browser rotating renderer
    (src/lib/demo/cap-dots.ts), which redraws the same dots every frame as
    the seam longitude moves."""
    columns = round(360 / MASK_STEP)
    rows = round((NORTH - SOUTH) / MASK_STEP)
    bits = bytearray((columns * rows + 7) // 8)
    for row in range(rows):
        lat = NORTH - (row + 0.5) * MASK_STEP
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for column in range(columns):
            lon = -180 + (column + 0.5) * MASK_STEP
            if is_land(lon, lat, candidates):
                index = row * columns + column
                bits[index >> 3] |= 0x80 >> (index & 7)
    # Same vertex filter as coastline(): keep in-range vertices in ring order.
    rings = []
    for ring_set, _ in polygons:
        for ring in ring_set:
            flat = []
            for lon, lat in ring:
                if SOUTH <= lat <= NORTH:
                    flat += [round(lon, 3), round(lat, 3)]
            if len(flat) >= 4:
                rings.append(flat)
    return json.dumps({
        "north": NORTH,
        "south": SOUTH,
        "step": MASK_STEP,
        "columns": columns,
        "rows": rows,
        "mask": base64.b64encode(bytes(bits)).decode("ascii"),
        "rings": rings,
    }, separators=(",", ":")) + "\n"


def build(polygons, is_land, column_gap, row_gap, coast_spacing, clearance, min_perimeter):
    coast = coastline(polygons, coast_spacing, min_perimeter)
    return interior(polygons, is_land, column_gap, row_gap, coast, clearance), coast


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare generated assets without writing")
    args = parser.parse_args()

    geometry = runpy.run_path(str(ROOT / "scripts" / "generate-demo-world-map.py"))
    polygons = geometry["decode_topology"](json.loads(SOURCE.read_bytes()))
    is_land = geometry["is_land"]

    # Same spacing, sizes and gap as the arch-3d assets.
    land, coast = build(polygons, is_land, 6.0, 5.2, 2.6, 3.4, 14)
    mobile_land, mobile_coast = build(polygons, is_land, 14, 12, 6, 7, 40)
    files = {
        OUTPUT / "world-map-cap-desktop.svg": render(land, coast, 1.35, 1.05),
        OUTPUT / "world-map-cap-mobile.svg": render(mobile_land, mobile_coast, 3.4, 2.6),
        OUTPUT / "world-cap-land.json": runtime_data(polygons, is_land),
    }
    if args.check:
        mismatches = [str(path) for path, content in files.items()
                      if not path.exists() or path.read_text() != content]
        if mismatches:
            raise SystemExit("Generated cap map assets differ: " + ", ".join(mismatches))
        print("Cap map assets are reproducible")
        return

    for path, content in files.items():
        path.write_text(content)
    print(f"Desktop: {len(land)} land + {len(coast)} coast; mobile: {len(mobile_land)} + {len(mobile_coast)}")


if __name__ == "__main__":
    main()
