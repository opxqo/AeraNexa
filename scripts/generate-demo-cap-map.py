#!/usr/bin/env python3
"""Draw the world as a large, cropped spherical cap: the map wrapped onto a
tilted sphere and seen in perspective, filling the width with the sides and
bottom running out of frame.

The dot style follows /demo/world-map/arch-3d: round land dots on a
staggered grid, a dotted coastline, and a gap between them. Here every dot is
fixed to a longitude/latitude, so it travels with the land as the map turns:
this script picks the dots once (public/demo/world-cap-land.json) and
src/lib/demo/cap-dots.ts projects them every frame; the SVGs are the resting
frame.

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


def sphere_angles(lon, lat):
    theta = (((lon - SEAM_LONGITUDE) % 360) - 180) * SPAN_LON
    return theta, (lat - LAT_CENTER) * SPAN_LAT


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


def inside(x, y, pad=4):
    return -pad <= x <= VIEW_WIDTH + pad and -pad <= y <= VIEW_HEIGHT + pad


# --- surface dots (fixed to the map; src/lib/demo/cap-dots.ts projects them) ---
# Every dot sits at a fixed longitude/latitude, so the dots move with the map
# as it turns instead of the land sliding under a screen grid. Spacing is set
# so that at REFERENCE_LATITUDE, where most of the land is, one step lands one
# screen gap apart; away from it the sphere's perspective spreads the rows
# (nearer the viewer) or squeezes them (toward the far rim).
REFERENCE_LATITUDE = 40


def _units():
    phi = (REFERENCE_LATITUDE - LAT_CENTER) * SPAN_LAT
    x0, y0 = project(0, phi)
    x1 = project(0.5, phi)[0]
    y1 = project(0, phi + 0.5)[1]
    return (x1 - x0) / 0.5 * SPAN_LON, (y0 - y1) / 0.5 * SPAN_LAT


UNITS_LON, UNITS_LAT = _units()  # view units per degree of longitude / latitude there


def lattice(column_gap, row_gap):
    """Rows and columns of the staggered lon/lat lattice (pole to pole, with a
    whole number of columns round the globe so it wraps without a seam)."""
    return round(180 / (row_gap / UNITS_LAT)), round(360 / (column_gap / UNITS_LON))


def lattice_point(rows, cols, row, col):
    """Mirrors latticePoint() in cap-dots.ts."""
    lat = 90 - (row + 0.5) * 180 / rows
    lon = -180 + (col + 0.5 + (0.5 if row % 2 else 0)) * 360 / cols
    return lon, lat


def sample(paths, spacing, min_perimeter):
    """Evenly spaced (lon, lat) dots along lon/lat polylines, measured in view
    units at the centre of the cap. Skips the edge Natural Earth runs along
    the South Pole to close Antarctica."""
    dots = []
    for path in paths:
        points = [(lon * UNITS_LON, lat * UNITS_LAT, lon, lat) for lon, lat in path]
        segments = [(a, b) for a, b in zip(points, points[1:]) if not (a[3] <= -89.9 and b[3] <= -89.9)]
        if sum(math.dist(a[:2], b[:2]) for a, b in segments) < min_perimeter:
            continue
        carry = 0.0
        for a, b in segments:
            length = math.dist(a[:2], b[:2])
            position = carry
            while position < length:
                t = position / length
                dots.append((a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t))
                position += spacing
            carry = position - length
    return [(((lon + 180) % 360) - 180, lat) for lon, lat in dots]


def encode(points):
    """(lon, lat) points as whole hundredths of a degree, flattened."""
    return [value for lon, lat in points for value in (round(lon * 100), round(lat * 100))]


def decode(values):
    return [(values[index] / 100, values[index + 1] / 100) for index in range(0, len(values), 2)]


def build(polygons, is_land, borders, china_bits, column_gap, row_gap, coast_spacing, clearance, min_perimeter):
    rings = [ring for ring_set, _ in polygons for ring in ring_set]
    coast = sample(rings, coast_spacing, min_perimeter)
    border = sample(borders, coast_spacing, 0) + list(ISLANDS)

    # Land dots keep a gap from the coast and border dots.
    buckets = {}
    for lon, lat in coast + border:
        x, y = lon * UNITS_LON, lat * UNITS_LAT
        buckets.setdefault((int(x // clearance), int(y // clearance)), []).append((x, y))

    def near_line(lon, lat):
        x, y = lon * UNITS_LON, lat * UNITS_LAT
        cx, cy = int(x // clearance), int(y // clearance)
        return any(
            math.dist((x, y), point) < clearance
            for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            for point in buckets.get((cx + dx, cy + dy), ())
        )

    in_china = mask_lookup(china_bits)
    near_china = mask_lookup(china_bits, reach=1)
    rows, cols = lattice(column_gap, row_gap)
    land_bits = bytearray((rows * cols + 7) // 8)
    china_land_bits = bytearray((rows * cols + 7) // 8)
    for row in range(rows):
        lat = lattice_point(rows, cols, row, 0)[1]
        candidates = [item for item in polygons if item[1][0][1] <= lat <= item[1][0][3]]
        for col in range(cols):
            lon = lattice_point(rows, cols, row, col)[0]
            if not is_land(lon, lat, candidates) or near_line(lon, lat):
                continue
            index = row * cols + col
            land_bits[index >> 3] |= 0x80 >> (index & 7)
            if in_china(lon, lat):
                china_land_bits[index >> 3] |= 0x80 >> (index & 7)

    return {
        "rows": rows,
        "cols": cols,
        "land": base64.b64encode(bytes(land_bits)).decode("ascii"),
        "china": base64.b64encode(bytes(china_land_bits)).decode("ascii"),
        "coast": encode([p for p in coast if not near_china(*p)]),
        "chinaCoast": encode([p for p in coast if near_china(*p)]),
        "border": encode(border),
    }


def at_rest(dots):
    """Screen positions at the resting seam, as the canvas draws its first
    frame (mirrors frame() in cap-dots.ts with no curl)."""
    def place(points):
        placed = []
        for lon, lat in points:
            if not SOUTH <= lat <= NORTH:
                continue
            point = project(*sphere_angles(lon, lat))
            if inside(*point):
                placed.append(point)
        return placed

    land, china_land = [], []
    land_bits = base64.b64decode(dots["land"])
    china_bits = base64.b64decode(dots["china"])
    for row in range(dots["rows"]):
        for col in range(dots["cols"]):
            index = row * dots["cols"] + col
            if land_bits[index >> 3] & (0x80 >> (index & 7)):
                target = china_land if china_bits[index >> 3] & (0x80 >> (index & 7)) else land
                target.append(lattice_point(dots["rows"], dots["cols"], row, col))
    return {
        "land": place(land),
        "china_land": place(china_land),
        "coast": place(decode(dots["coast"])),
        "china_coast": place(decode(dots["chinaCoast"])),
        "border": place(decode(dots["border"])),
    }


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
# The runtime data covers pole to pole: the demo page can curl the cap into a
# whole globe (src/lib/demo/cap-projection.ts). The cap itself still crops to
# SOUTH..NORTH.
MASK_NORTH = 90
MASK_SOUTH = -90
MASK_COLUMNS = round(360 / MASK_STEP)
MASK_ROWS = round((MASK_NORTH - MASK_SOUTH) / MASK_STEP)


def mask(polygons, is_land, extra=None):
    """Mask of cells inside `polygons`, or where `extra(lon, lat)` holds."""
    bits = bytearray((MASK_COLUMNS * MASK_ROWS + 7) // 8)
    for row in range(MASK_ROWS):
        lat = MASK_NORTH - (row + 0.5) * MASK_STEP
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
        row = math.floor((MASK_NORTH - lat) / MASK_STEP)
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
        OUTPUT / "world-map-cap-desktop.svg": render(at_rest(desktop), 1.35, 1.05),
        OUTPUT / "world-map-cap-mobile.svg": render(at_rest(mobile), 3.4, 2.6),
        OUTPUT / "world-cap-land.json": json.dumps({"desktop": desktop, "mobile": mobile}, separators=(",", ":")) + "\n",
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
        print(name, {key: len(value) for key, value in at_rest(dots).items()})


if __name__ == "__main__":
    main()
