// Per-frame land dots for the rotating spherical-cap map. Every dot is fixed
// to a longitude/latitude on the globe, so the dots travel with the land as
// the map turns (rather than the land sliding under a fixed screen grid).
// scripts/generate-demo-cap-map.py picks the dots once: a staggered lon/lat
// lattice of land dots kept clear of the coast, and evenly spaced coast and
// border dots, with China sorted out for the accent colour. It writes them to
// public/demo/world-cap-land.json; this module only projects them each frame.

import { CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capFacing, capLatRange, getCapCurl, sphereAngles, toView } from "@/lib/demo/cap-projection";

/** One parameter set (desktop or mobile) from the generator. */
export type CapDotSet = {
  rows: number;         // lattice rows, pole to pole
  cols: number;         // lattice columns round the globe
  land: string;         // base64 bits, one per lattice point: a land dot
  china: string;        // base64 bits: that land dot is in China
  coast: number[];      // [lon, lat, …] in hundredths of a degree
  chinaCoast: number[];
  border: number[];     // China's borders, the ten-dash line and small islands
};

export type CapLandData = { desktop: CapDotSet; mobile: CapDotSet };

export type CapDotParams = { landRadius: number; coastRadius: number };

// Dot sizes for the two parameter sets (spacing lives in the generator).
export const CAP_DOTS_DESKTOP: CapDotParams = { landRadius: 1.35, coastRadius: 1.05 };
export const CAP_DOTS_MOBILE: CapDotParams = { landRadius: 3.4, coastRadius: 2.6 };

export type CapDotFrame = {
  land: number[];
  coast: number[];
  chinaLand: number[];
  chinaCoast: number[];
  border: number[];
};

function decodeBits(base64: string) {
  const binary = atob(base64);
  const bits = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bits[index] = binary.charCodeAt(index);
  return bits;
}

/** Mirrors lattice_point() in the generator. */
function latticePoint(rows: number, cols: number, row: number, col: number) {
  const latitude = 90 - ((row + 0.5) * 180) / rows;
  const longitude = -180 + ((col + 0.5 + (row % 2 ? 0.5 : 0)) * 360) / cols;
  return { longitude, latitude };
}

const hundredths = (values: number[]) => values.map((value) => value / 100);

export function createCapDots(set: CapDotSet) {
  // Land dots as [lon, lat, column, …], split into China and the rest.
  const land: number[] = [];
  const chinaLand: number[] = [];
  const landBits = decodeBits(set.land);
  const chinaBits = decodeBits(set.china);
  for (let row = 0; row < set.rows; row += 1) {
    for (let col = 0; col < set.cols; col += 1) {
      const index = row * set.cols + col;
      const bit = 0x80 >> (index & 7);
      if ((landBits[index >> 3] & bit) === 0) continue;
      const { longitude, latitude } = latticePoint(set.rows, set.cols, row, col);
      ((chinaBits[index >> 3] & bit) !== 0 ? chinaLand : land).push(longitude, latitude, col);
    }
  }
  const coast = hundredths(set.coast);
  const chinaCoast = hundredths(set.chinaCoast);
  const border = hundredths(set.border);

  const lonStep = 360 / set.cols;
  const latStep = 180 / set.rows;
  const inside = (x: number, y: number) => x >= -4 && x <= CAP_VIEW_WIDTH + 4 && y >= -4 && y <= CAP_VIEW_HEIGHT + 4;

  function frame(seam: number): CapDotFrame {
    const curl = getCapCurl();
    const { north, south } = capLatRange();

    // Project lon/lat dots (`stride` values each) to the view, leaving out
    // latitudes the shape crops, the far side once curled, and anything off
    // the canvas. The lattice is spaced for the cap, which squeezes latitude
    // more than longitude; on a whole globe its rows would read as solid
    // lines. So as the map curls, each row keeps an evenly spread share of
    // its dots, easing toward the share that makes the gap along the row
    // match the gap between rows.
    function place(points: number[], stride: number, thin: boolean) {
      const placed: number[] = [];
      for (let index = 0; index < points.length; index += stride) {
        const longitude = points[index];
        const latitude = points[index + 1];
        if (latitude < south || latitude > north) continue;
        if (thin && curl > 0) {
          const even = Math.min(1, (lonStep * Math.cos((latitude * Math.PI) / 180)) / latStep);
          const share = 1 + (even - 1) * curl;
          const col = points[index + 2];
          if (Math.floor((col + 1) * share) === Math.floor(col * share)) continue;
        }
        const angles = sphereAngles(longitude, latitude, seam);
        if (curl > 0 && capFacing(angles) <= 0) continue;
        const point = toView(angles);
        if (inside(point.x, point.y)) placed.push(point.x, point.y);
      }
      return placed;
    }

    return {
      land: place(land, 3, true),
      chinaLand: place(chinaLand, 3, true),
      coast: place(coast, 2, false),
      chinaCoast: place(chinaCoast, 2, false),
      border: place(border, 2, false),
    };
  }

  return { frame };
}
