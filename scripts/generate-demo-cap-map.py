#!/usr/bin/env python3
"""Draw the world as a large, cropped spherical cap: the map wrapped onto a
tilted sphere and seen in perspective, filling the width with the sides and
bottom running out of frame.

Only the shape differs from /demo/world-map/arch-3d; the dot style is the
same (see scripts/generate-demo-arch-map-globe.py): evenly spaced round land
dots on a staggered screen grid, a dotted coastline, and a gap between them.
Screen-grid dots are traced back onto the sphere to test for land.

Land comes from Natural Earth 1:110m (the 3D globe demo's source). China is
drawn in the accent orange with a dotted border, from Natural Earth 1:110m
countries (world-atlas: mainland, Hainan, Taiwan, Aksai Chin), completed
here with South Tibet, the South China Sea islands, the Diaoyu Islands and
the ten-dash line, which the source data lacks. Keep the
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
COUNTRIES = ROOT / "scripts" / "data" / "countries-110m.json"
CHINA_IDS = {"156", "158"}  # China, Taiwan
NEIGHBOUR_IDS = {"064", "104"}  # Bhutan, Myanmar: kept out of South Tibet

# South Tibet, which Natural Earth leaves on the Indian side. Its southern
# edge (west → east, along the foothills from Bhutan to the Myanmar
# trijunction) becomes China's border; the ring closes well inside Tibet.
# Approximate: fine at this map's scale (about 5 view units per degree).
SOUTH_TIBET_LINE = [
    (91.65, 27.95), (91.9, 27.4), (92.05, 27.05), (92.1, 26.85), (92.6, 26.98),
    (93.2, 26.95), (93.8, 27.1), (94.3, 27.4), (94.8, 27.6), (95.3, 27.9),
    (95.9, 27.95), (95.75, 27.5), (95.45, 27.2), (95.25, 26.95), (95.45, 26.72),
    (95.9, 26.9), (96.3, 27.2), (96.9, 27.25), (97.15, 27.75), (97.35, 28.2),
]
SOUTH_TIBET_RING = SOUTH_TIBET_LINE + [(97.35, 29.8), (91.65, 29.8)]

# The ten-dash line (nine in the South China Sea, one east of Taiwan), each
# dash as its two ends. Approximate positions.
TEN_DASH_LINE = [
    [(107.9, 18.2), (108.3, 17.3)],
    [(109.5, 15.5), (109.6, 14.3)],
    [(109.6, 11.3), (109.3, 10.1)],
    [(108.5, 7.3), (108.9, 6.2)],
    [(111.6, 3.8), (112.8, 3.5)],
    [(115.2, 5.9), (116.0, 6.8)],
    [(116.5, 8.3), (117.2, 9.4)],
    [(119.0, 14.6), (119.3, 15.9)],
    [(120.9, 19.9), (121.3, 21.0)],
    [(122.5, 24.4), (122.7, 23.3)],
]

# Islands too small for 1:110m land: one dot each.
ISLANDS = [
    (123.47, 25.74),  # Diaoyu Dao
    (116.72, 20.70),  # Dongsha Qundao
    (112.34, 16.83),  # Xisha: Yongxing Dao
    (111.70, 16.45),  # Xisha: Yongle Qundao
    (117.76, 15.15),  # Zhongsha: Huangyan Dao
    (114.36, 10.38),  # Nansha: Taiping Dao
    (114.08, 10.92),  # Nansha: Zhubi Jiao
    (112.89, 9.55),   # Nansha: Yongshu Jiao
    (115.53, 9.92),   # Nansha: Meiji Jiao
    (111.92, 8.64),   # Nansha: Nanwei Dao
    (112.28, 3.97),   # Nansha: Zengmu Ansha
]
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


def lines(paths, spacing):
    """Evenly spaced dots along open polylines of (lon, lat) points."""
    return coastline([([path], None) for path in paths], spacing, 0)


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


def render(dots, land_radius, coast_radius):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{VIEW_WIDTH}" height="{VIEW_HEIGHT}" viewBox="0 0 {VIEW_WIDTH} {VIEW_HEIGHT}" fill="none">\n'
        '<!-- Natural Earth 1:110m (same land as the 3D globe demo) on a cropped spherical cap. -->\n'
        f'<g id="land-dots" fill="#2662FF" opacity=".72"><path d="{circles(dots["land"], land_radius)}"/></g>\n'
        f'<g id="coast-dots" fill="#2662FF" opacity=".95"><path d="{circles(dots["coast"], coast_radius)}"/></g>\n'
        f'<g id="china-land-dots" fill="#F45300" opacity=".72"><path d="{circles(dots["china_land"], land_radius)}"/></g>\n'
        f'<g id="china-coast-dots" fill="#F45300" opacity=".95"><path d="{circles(dots["china_coast"] + dots["border"], coast_radius)}"/></g>\n'
        '</svg>\n'
    )


MASK_STEP = 0.5  # degrees per land-mask cell
MASK_COLUMNS = round(360 / MASK_STEP)
MASK_ROWS = round((NORTH - SOUTH) / MASK_STEP)


def mask(polygons, is_land, extra=None):
    """Mask of cells inside `polygons`, or where `extra(lon, lat)` holds."""
    bits = bytearray((MASK_COLUMNS * MASK_ROWS + 7) // 8)
    for row in range(MASK_ROWS):
        lat = NORTH - (row + 0.5) * MASK_STEP
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for column in range(MASK_COLUMNS):
            lon = -180 + (column + 0.5) * MASK_STEP
            if is_land(lon, lat, candidates) or (extra and extra(lon, lat)):
                index = row * MASK_COLUMNS + column
                bits[index >> 3] |= 0x80 >> (index & 7)
    return bits


def mask_lookup(bits, reach=0):
    """Test a lon/lat against a mask; `reach` also accepts cells that many
    steps away (coast dots sit right on the land edge). Mirrors cap-dots.ts."""
    def test(lon, lat):
        row = math.floor((NORTH - lat) / MASK_STEP)
        column = math.floor((lon + 180) / MASK_STEP)
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                r = row + dr
                if not 0 <= r < MASK_ROWS:
                    continue
                index = r * MASK_COLUMNS + (column + dc) % MASK_COLUMNS
                if bits[index >> 3] & (0x80 >> (index & 7)):
                    return True
        return False
    return test


def china(topology, decode_topology, in_ring, is_land):
    """China's mask and borders. The mask is China and Taiwan plus South
    Tibet (less any of Bhutan or Myanmar); borders are the arcs China shares
    with another country (arcs used by one country only are coastline), cut
    where they cross South Tibet, plus South Tibet's southern edge and the
    ten-dash line."""
    geometries = topology["objects"]["countries"]["geometries"]
    uses = {}
    for geometry in geometries:
        stack = [geometry["arcs"]]
        while stack:
            item = stack.pop()
            if isinstance(item, int):
                uses.setdefault(item if item >= 0 else ~item, set()).add(geometry.get("id"))
            else:
                stack.extend(item)
    def shapes(ids):
        found = []
        for geometry in geometries:
            if geometry.get("id") in ids:
                found += [geometry["arcs"]] if geometry["type"] == "Polygon" else geometry["arcs"]
        return decode_topology({**topology, "objects": {"land": {"geometries": [{"arcs": found}]}}})

    neighbours = shapes(NEIGHBOUR_IDS)

    def south_tibet(lon, lat):
        if not in_ring(lon, lat, SOUTH_TIBET_RING):
            return False
        return not is_land(lon, lat, [item for item in neighbours if item[1][0][1] <= lat <= item[1][0][3]])

    bits = mask(shapes(CHINA_IDS), is_land, south_tibet)

    scale_x, scale_y = topology["transform"]["scale"]
    offset_x, offset_y = topology["transform"]["translate"]
    borders = []
    for index in sorted(uses):
        if "156" in uses[index] and len(uses[index]) > 1:
            x = y = 0
            path = []
            for delta_x, delta_y in topology["arcs"][index]:
                x += delta_x
                y += delta_y
                path.append((x * scale_x + offset_x, y * scale_y + offset_y))
            # Drop the stretch inside South Tibet (now China on both sides).
            piece = []
            for point in path:
                if in_ring(*point, SOUTH_TIBET_RING):
                    if len(piece) > 1:
                        borders.append(piece)
                    piece = []
                else:
                    piece.append(point)
            if len(piece) > 1:
                borders.append(piece)
    return bits, borders + [SOUTH_TIBET_LINE] + TEN_DASH_LINE


def classify(land, coast, china_bits):
    """Split land/coast dots (screen points) into China and the rest. Coast
    dots also match one mask cell out, as they sit right on the land edge."""
    in_china = mask_lookup(china_bits)
    near_china = mask_lookup(china_bits, reach=1)

    def test(point, lookup):
        hit = unproject(*point)
        return bool(hit) and lookup(*lonlat(*hit))

    return {
        "land": [p for p in land if not test(p, in_china)],
        "china_land": [p for p in land if test(p, in_china)],
        "coast": [p for p in coast if not test(p, near_china)],
        "china_coast": [p for p in coast if test(p, near_china)],
    }


def runtime_data(polygons, is_land, china_bits, borders):
    """Land mask and coastline rings for the in-browser rotating renderer
    (src/lib/demo/cap-dots.ts), which redraws the same dots every frame as
    the seam longitude moves; plus China's mask and land borders."""
    columns, rows = MASK_COLUMNS, MASK_ROWS
    bits = mask(polygons, is_land)
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
        "china": base64.b64encode(bytes(china_bits)).decode("ascii"),
        "borders": [[value for lon, lat in path for value in (round(lon, 3), round(lat, 3))] for path in borders],
        "islands": [value for lon, lat in ISLANDS for value in (lon, lat)],
    }, separators=(",", ":")) + "\n"


def build(polygons, is_land, borders, china_bits, column_gap, row_gap, coast_spacing, clearance, min_perimeter):
    coast = coastline(polygons, coast_spacing, min_perimeter)
    border = lines(borders, coast_spacing)
    for lon, lat in ISLANDS:
        point = project(*sphere_angles(lon, lat))
        if inside(*point):
            border.append(point)
    # Border dots clear a gap in the land dots the same way the coast does.
    land = interior(polygons, is_land, column_gap, row_gap, coast + border, clearance)
    return {**classify(land, coast, china_bits), "border": border}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare generated assets without writing")
    args = parser.parse_args()

    geometry = runpy.run_path(str(ROOT / "scripts" / "generate-demo-world-map.py"))
    polygons = geometry["decode_topology"](json.loads(SOURCE.read_bytes()))
    is_land = geometry["is_land"]
    china_bits, borders = china(json.loads(COUNTRIES.read_bytes()), geometry["decode_topology"], geometry["in_ring"], is_land)

    # Same spacing, sizes and gap as the arch-3d assets.
    desktop = build(polygons, is_land, borders, china_bits, 6.0, 5.2, 2.6, 3.4, 14)
    mobile = build(polygons, is_land, borders, china_bits, 14, 12, 6, 7, 40)
    files = {
        OUTPUT / "world-map-cap-desktop.svg": render(desktop, 1.35, 1.05),
        OUTPUT / "world-map-cap-mobile.svg": render(mobile, 3.4, 2.6),
        OUTPUT / "world-cap-land.json": runtime_data(polygons, is_land, china_bits, borders),
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
    for name, dots in (("Desktop", desktop), ("Mobile", mobile)):
        print(name, {key: len(value) for key, value in dots.items()})


if __name__ == "__main__":
    main()
