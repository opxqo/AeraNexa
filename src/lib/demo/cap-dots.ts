// Per-frame land dots for the rotating spherical-cap map. Same sampling as
// scripts/generate-demo-cap-map.py (staggered screen grid, dotted coastline,
// a gap between them), but recomputed for any seam longitude so the map can
// turn. Data comes from public/demo/world-cap-land.json (same generator).

import { CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capLonLat, sphereAngles, toView, unprojectCap } from "@/lib/demo/cap-projection";

export type CapLandData = {
  north: number;
  south: number;
  step: number;
  columns: number;
  rows: number;
  mask: string;
  rings: number[][];
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

export type CapDotFrame = { land: number[]; coast: number[] };

export function createCapDots(data: CapLandData, params: CapDotParams) {
  const binary = atob(data.mask);
  const bits = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bits[index] = binary.charCodeAt(index);

  function isLand(longitude: number, latitude: number) {
    const row = Math.floor((data.north - latitude) / data.step);
    if (row < 0 || row >= data.rows) return false;
    const column = ((Math.floor((longitude + 180) / data.step) % data.columns) + data.columns) % data.columns;
    const index = row * data.columns + column;
    return (bits[index >> 3] & (0x80 >> (index & 7))) !== 0;
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

  function coastline(seam: number) {
    const dots: number[] = [];
    for (const ring of data.rings) {
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
      if (perimeter < params.minPerimeter) continue;
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
    const coast = coastline(seam);
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
    for (let index = 0; index < grid.length; index += 4) {
      const { longitude, latitude } = capLonLat({ theta: grid[index + 2], phi: grid[index + 3] }, seam);
      const x = grid[index];
      const y = grid[index + 1];
      if (isLand(longitude, latitude) && !nearCoast(x, y)) land.push(x, y);
    }
    return { land, coast };
  }

  return { frame };
}
