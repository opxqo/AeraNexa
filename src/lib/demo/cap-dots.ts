// Per-frame land dots for the rotating spherical-cap map. Same sampling as
// scripts/generate-demo-cap-map.py (staggered screen grid, dotted coastline,
// a gap between them), but recomputed for any seam longitude so the map can
// turn. Data comes from public/demo/world-cap-land.json (same generator).
// China comes out as its own dot sets, with its dotted borders (land borders
// and the ten-dash line) and small islands, so it can be drawn in the accent
// colour.

import { CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capLonLat, sphereAngles, toView, unprojectCap } from "@/lib/demo/cap-projection";

export type CapLandData = {
  north: number;
  south: number;
  step: number;
  columns: number;
  rows: number;
  mask: string;
  rings: number[][];
  china: string;       // mask of China, same grid as `mask`
  borders: number[][]; // China's borders and the ten-dash line, [lon, lat, …] per line
  islands: number[];   // China's small islands, one dot each: [lon, lat, …]
};

export type CapDotParams = {
  columnGap: number;
  rowGap: number;
  coastSpacing: number;
  clearance: number;
  minPerimeter: number;
  landRadius: number;
  coastRadius: number;
};

// The two build(...) parameter sets in the generator.
export const CAP_DOTS_DESKTOP: CapDotParams = { columnGap: 6, rowGap: 5.2, coastSpacing: 2.6, clearance: 3.4, minPerimeter: 14, landRadius: 1.35, coastRadius: 1.05 };
export const CAP_DOTS_MOBILE: CapDotParams = { columnGap: 14, rowGap: 12, coastSpacing: 6, clearance: 7, minPerimeter: 40, landRadius: 3.4, coastRadius: 2.6 };

export type CapDotFrame = {
  land: number[];
  coast: number[];
  chinaLand: number[];
  chinaCoast: number[];
  border: number[];
};

function decodeMask(base64: string) {
  const binary = atob(base64);
  const bits = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bits[index] = binary.charCodeAt(index);
  return bits;
}

export function createCapDots(data: CapLandData, params: CapDotParams) {
  const bits = decodeMask(data.mask);
  const chinaBits = decodeMask(data.china);

  // `reach` also accepts cells that many steps away (coast dots sit right on
  // the land edge). Mirrors mask_lookup() in the generator.
  function inMask(mask: Uint8Array, longitude: number, latitude: number, reach = 0) {
    const row = Math.floor((data.north - latitude) / data.step);
    const column = Math.floor((longitude + 180) / data.step);
    for (let dr = -reach; dr <= reach; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= data.rows) continue;
      for (let dc = -reach; dc <= reach; dc += 1) {
        const index = r * data.columns + ((((column + dc) % data.columns) + data.columns) % data.columns);
        if ((mask[index >> 3] & (0x80 >> (index & 7))) !== 0) return true;
      }
    }
    return false;
  }
  const isLand = (longitude: number, latitude: number) => inMask(bits, longitude, latitude);

  // Coast rings that come near China; only their dots need classifying.
  const chinaRings: number[][] = [];
  const otherRings: number[][] = [];
  for (const ring of data.rings) {
    let near = false;
    for (let index = 0; index < ring.length && !near; index += 2) near = inMask(chinaBits, ring[index], ring[index + 1], 2);
    (near ? chinaRings : otherRings).push(ring);
  }

  // Is this view point (on the sphere) over China?
  function overChina(x: number, y: number, seam: number, reach: number) {
    const hit = unprojectCap(x, y);
    if (!hit) return false;
    const { longitude, latitude } = capLonLat(hit, seam);
    return inMask(chinaBits, longitude, latitude, reach);
  }

  // Screen grid points and where they land on the sphere. The sphere angles
  // are measured from the seam, so this is fixed while the seam moves.
  const grid: number[] = [];
  let row = 0;
  for (let y = params.rowGap / 2; y < CAP_VIEW_HEIGHT; y += params.rowGap, row += 1) {
    for (let x = params.columnGap / 2 + (row % 2 ? params.columnGap / 2 : 0); x < CAP_VIEW_WIDTH; x += params.columnGap) {
      const hit = unprojectCap(x, y);
      if (hit) grid.push(x, y, hit.theta, hit.phi);
    }
  }

  const inside = (x: number, y: number) => x >= -4 && x <= CAP_VIEW_WIDTH + 4 && y >= -4 && y <= CAP_VIEW_HEIGHT + 4;

  // Evenly spaced dots along lon/lat lines (coast rings or borders).
  function trace(lines: number[][], minPerimeter: number, seam: number) {
    const dots: number[] = [];
    for (const ring of lines) {
      const thetas: number[] = [];
      const points: number[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const angles = sphereAngles(ring[index], ring[index + 1], seam);
        const point = toView(angles);
        thetas.push(angles.theta);
        points.push(point.x, point.y);
      }
      // Segments between consecutive vertices, skipping ones that cross the seam.
      const segments: number[] = [];
      let perimeter = 0;
      for (let index = 1; index < thetas.length; index += 1) {
        if (Math.abs(thetas[index] - thetas[index - 1]) >= 30) continue;
        const ax = points[index * 2 - 2], ay = points[index * 2 - 1];
        const bx = points[index * 2], by = points[index * 2 + 1];
        segments.push(ax, ay, bx, by);
        perimeter += Math.hypot(bx - ax, by - ay);
      }
      if (perimeter < minPerimeter) continue;
      let carry = 0;
      for (let index = 0; index < segments.length; index += 4) {
        const ax = segments[index], ay = segments[index + 1], bx = segments[index + 2], by = segments[index + 3];
        const length = Math.hypot(bx - ax, by - ay);
        let position = carry;
        while (position < length) {
          const t = position / length;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          if (inside(x, y)) dots.push(x, y);
          position += params.coastSpacing;
        }
        carry = position - length;
      }
    }
    return dots;
  }

  function frame(seam: number): CapDotFrame {
    const otherCoast = trace(otherRings, params.minPerimeter, seam);
    const nearChinaCoast = trace(chinaRings, params.minPerimeter, seam);
    const border = trace(data.borders, 0, seam);
    for (let index = 0; index < data.islands.length; index += 2) {
      const point = toView(sphereAngles(data.islands[index], data.islands[index + 1], seam));
      if (inside(point.x, point.y)) border.push(point.x, point.y);
    }
    // Border dots clear a gap in the land dots the same way the coast does.
    const coast = otherCoast.concat(nearChinaCoast, border);
    const cell = params.clearance;
    const buckets = new Map<number, number[]>();
    for (let index = 0; index < coast.length; index += 2) {
      const key = Math.floor(coast[index] / cell) * 4096 + Math.floor(coast[index + 1] / cell);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(coast[index], coast[index + 1]);
      else buckets.set(key, [coast[index], coast[index + 1]]);
    }
    const nearCoast = (x: number, y: number) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = buckets.get((cx + dx) * 4096 + cy + dy);
          if (!bucket) continue;
          for (let index = 0; index < bucket.length; index += 2) {
            if (Math.hypot(x - bucket[index], y - bucket[index + 1]) < cell) return true;
          }
        }
      }
      return false;
    };

    const land: number[] = [];
    const chinaLand: number[] = [];
    for (let index = 0; index < grid.length; index += 4) {
      const { longitude, latitude } = capLonLat({ theta: grid[index + 2], phi: grid[index + 3] }, seam);
      const x = grid[index];
      const y = grid[index + 1];
      if (!isLand(longitude, latitude) || nearCoast(x, y)) continue;
      if (inMask(chinaBits, longitude, latitude)) chinaLand.push(x, y);
      else land.push(x, y);
    }
    const plainCoast = otherCoast;
    const chinaCoast: number[] = [];
    for (let index = 0; index < nearChinaCoast.length; index += 2) {
      const x = nearChinaCoast[index];
      const y = nearChinaCoast[index + 1];
      if (overChina(x, y, seam, 1)) chinaCoast.push(x, y);
      else plainCoast.push(x, y);
    }
    return { land, coast: plainCoast, chinaLand, chinaCoast, border };
  }

  return { frame };
}
