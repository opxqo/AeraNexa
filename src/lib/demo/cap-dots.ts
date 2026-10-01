// Per-frame land dots for the rotating spherical-cap map. Every dot is fixed
// to a longitude/latitude on the globe, so the dots travel with the land as
// the map turns (rather than the land sliding under a fixed screen grid).
// scripts/generate-demo-cap-map.py picks the dots once: a staggered lon/lat
// lattice of land dots kept clear of the coast, and evenly spaced coast and
// border dots, with China sorted out for the accent colour. It writes them to
// public/demo/world-cap-land.json; this module only projects them each frame.

import { CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capProjectionParameters, getCapCurl } from "@/lib/demo/cap-projection";

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

  // Lattice points share longitudes and latitudes. Index them once instead
  // of calculating the same trigonometry for every dot on every frame.
  const longitudes: number[] = [];
  const latitudes: number[] = [];
  const longitudeIndex = new Map<number, number>();
  const latitudeIndex = new Map<number, number>();
  const coordinateIndex = (value: number, values: number[], indices: Map<number, number>) => {
    let index = indices.get(value);
    if (index === undefined) {
      index = values.length;
      values.push(value);
      indices.set(value, index);
    }
    return index;
  };
  const prepare = (points: number[], stride: number) => {
    const count = points.length / stride;
    const lon = new Uint32Array(count);
    const lat = new Uint32Array(count);
    const columns = stride === 3 ? new Uint32Array(count) : null;
    for (let index = 0; index < count; index += 1) {
      lon[index] = coordinateIndex(points[index * stride], longitudes, longitudeIndex);
      lat[index] = coordinateIndex(points[index * stride + 1], latitudes, latitudeIndex);
      if (columns) columns[index] = points[index * stride + 2];
    }
    return { lon, lat, columns, placed: new Array<number>(count * 2) };
  };
  const groups = {
    land: prepare(land, 3),
    chinaLand: prepare(chinaLand, 3),
    coast: prepare(coast, 2),
    chinaCoast: prepare(chinaCoast, 2),
    border: prepare(border, 2),
  };
  const sinTheta = new Float64Array(longitudes.length);
  const cosTheta = new Float64Array(longitudes.length);
  const sinPhi = new Float64Array(latitudes.length);
  const cosPhi = new Float64Array(latitudes.length);
  const shares = new Float64Array(latitudes.length);
  const evenShares = latitudes.map((latitude) => Math.min(1, ((360 / set.cols) * Math.cos((latitude * Math.PI) / 180)) / (180 / set.rows)));
  let cachedCurl = -1;

  function frame(seam: number): CapDotFrame {
    const curl = getCapCurl();
    const { north, south, spanLon, spanLat, latCenter, tilt, camera, scale, offsetX, offsetY } = capProjectionParameters();
    const sinTilt = Math.sin((tilt * Math.PI) / 180);
    const cosTilt = Math.cos((tilt * Math.PI) / 180);
    if (curl !== cachedCurl) {
      cachedCurl = curl;
      for (let index = 0; index < latitudes.length; index += 1) {
        const phi = ((latitudes[index] - latCenter) * spanLat * Math.PI) / 180;
        sinPhi[index] = Math.sin(phi);
        cosPhi[index] = Math.cos(phi);
        shares[index] = 1 + (evenShares[index] - 1) * curl;
      }
    }
    for (let index = 0; index < longitudes.length; index += 1) {
      const norm = (((longitudes[index] - seam) % 360) + 360) % 360;
      const theta = ((norm - 180) * spanLon * Math.PI) / 180;
      sinTheta[index] = Math.sin(theta);
      cosTheta[index] = Math.cos(theta);
    }

    // Project lon/lat dots (`stride` values each) to the view, leaving out
    // latitudes the shape crops, the far side once curled, and anything off
    // the canvas. The lattice is spaced for the cap, which squeezes latitude
    // more than longitude; on a whole globe its rows would read as solid
    // lines. So as the map curls, each row keeps an evenly spread share of
    // its dots, easing toward the share that makes the gap along the row
    // match the gap between rows.
    function place({ lon, lat, columns, placed }: ReturnType<typeof prepare>) {
      let count = 0;
      for (let index = 0; index < lon.length; index += 1) {
        const latitude = latitudes[lat[index]];
        if (latitude < south || latitude > north) continue;
        if (columns && curl > 0) {
          const share = shares[lat[index]];
          const col = columns[index];
          if (Math.floor((col + 1) * share) === Math.floor(col * share)) continue;
        }
        // Same perspective math as toView/capFacing, sharing one projection
        // for culling and placement, without intermediate point objects.
        const x0 = cosPhi[lat[index]] * sinTheta[lon[index]];
        const y0 = sinPhi[lat[index]];
        const z0 = cosPhi[lat[index]] * cosTheta[lon[index]];
        const y = y0 * cosTilt + z0 * sinTilt;
        const z = -y0 * sinTilt + z0 * cosTilt;
        if (curl > 0 && z - 1 / camera <= 0) continue;
        const depth = camera - z;
        const px = (x0 / depth) * scale + offsetX;
        const py = (-y / depth) * scale + offsetY;
        if (px >= -4 && px <= CAP_VIEW_WIDTH + 4 && py >= -4 && py <= CAP_VIEW_HEIGHT + 4) {
          placed[count++] = px;
          placed[count++] = py;
        }
      }
      placed.length = count;
      return placed;
    }

    return {
      land: place(groups.land),
      chinaLand: place(groups.chinaLand),
      coast: place(groups.coast),
      chinaCoast: place(groups.chinaCoast),
      border: place(groups.border),
    };
  }

  // Output arrays belong to this renderer and are reused by the next frame.
  return { frame };
}
