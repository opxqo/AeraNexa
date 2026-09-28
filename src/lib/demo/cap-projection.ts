// Spherical-cap projection for /demo/world-map/cap. Mirrors the constants
// and math in scripts/generate-demo-cap-map.py, which draws the land dots;
// this side places cities and routes on the same surface.

export const CAP_VIEW_WIDTH = 1600;
export const CAP_VIEW_HEIGHT = 640;
// Map edge longitude at rest. The rotating renderer moves this over time;
// every projection below takes it as an optional `seam` argument.
export const CAP_SEAM_LONGITUDE = -95;
const SEAM_LONGITUDE = CAP_SEAM_LONGITUDE;
export const CAP_NORTH = 84;
export const CAP_SOUTH = -60;
const NORTH = CAP_NORTH;
const SOUTH = CAP_SOUTH;
const LAT_CENTER = (NORTH + SOUTH) / 2;
export const CAP_SPAN_LON = 0.28;
const SPAN_LON = CAP_SPAN_LON;
const SPAN_LAT = 0.18;
/** Half the visible longitude sweep in sphere degrees (θ runs ±this). */
export const CAP_HALF_THETA = 180 * SPAN_LON;
const TILT = (33 * Math.PI) / 180;
const CAMERA = 2.75;
const FRAME_EDGE = 14;
const FRAME_EDGE_LAT = 25;
const TOP_Y = 40;

export type Angles = { theta: number; phi: number };
type Place = { longitude: number; latitude: number };

export function sphereAngles(longitude: number, latitude: number, seam = SEAM_LONGITUDE): Angles {
  const lonNorm = (((longitude - seam) % 360) + 360) % 360;
  return { theta: (lonNorm - 180) * SPAN_LON, phi: (latitude - LAT_CENTER) * SPAN_LAT };
}

function raw({ theta, phi }: Angles, radius = 1) {
  const t = (theta * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  const x = radius * Math.cos(p) * Math.sin(t);
  const y0 = radius * Math.sin(p);
  const z0 = radius * Math.cos(p) * Math.cos(t);
  const y = y0 * Math.cos(TILT) + z0 * Math.sin(TILT);
  const z = -y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
  const depth = CAMERA - z;
  return { x: x / depth, y: -y / depth };
}

// Same framing as frame() in the generator: two map longitudes near the seam
// touch the view's sides, and the top of the rim sits at TOP_Y. θ/φ are
// measured from the seam, so the framing doesn't change as the seam moves.
const { scale, offsetX, offsetY } = (() => {
  const left = raw(sphereAngles(SEAM_LONGITUDE + FRAME_EDGE, FRAME_EDGE_LAT)).x;
  const right = raw(sphereAngles(SEAM_LONGITUDE - FRAME_EDGE, FRAME_EDGE_LAT)).x;
  const fit = CAP_VIEW_WIDTH / (right - left);
  const top = raw(sphereAngles(SEAM_LONGITUDE + 180, NORTH)).y;
  return { scale: fit, offsetX: CAP_VIEW_WIDTH / 2 - ((left + right) / 2) * fit, offsetY: TOP_Y - top * fit };
})();

export function toView(angles: Angles, radius = 1) {
  const point = raw(angles, radius);
  return { x: point.x * scale + offsetX, y: point.y * scale + offsetY };
}

export function projectCapCity(longitude: number, latitude: number, seam = SEAM_LONGITUDE) {
  return toView(sphereAngles(longitude, latitude, seam));
}

/** Longitude/latitude under sphere angles θ/φ for a given seam. */
export function capLonLat({ theta, phi }: Angles, seam = SEAM_LONGITUDE) {
  const longitude = ((((theta / SPAN_LON + 180 + seam + 180) % 360) + 360) % 360) - 180;
  return { longitude, latitude: phi / SPAN_LAT + LAT_CENTER };
}

const PHI_MIN = (SOUTH - LAT_CENTER) * SPAN_LAT;
const PHI_MAX = (NORTH - LAT_CENTER) * SPAN_LAT;

/** Trace a view-box point back onto the front of the sphere (mirror of the
 *  generator's unproject). Returns null off the sphere or outside the map. */
export function unprojectCap(px: number, py: number): Angles | null {
  const u = (px - offsetX) / scale;
  const v = -(py - offsetY) / scale;
  const a = u * u + v * v + 1;
  const disc = CAMERA * CAMERA - a * (CAMERA * CAMERA - 1);
  if (disc < 0) return null;
  const s = (CAMERA - Math.sqrt(disc)) / a;
  const x = u * s;
  const y = v * s;
  const z = CAMERA - s;
  const y0 = y * Math.cos(TILT) - z * Math.sin(TILT);
  const z0 = y * Math.sin(TILT) + z * Math.cos(TILT);
  const phi = (Math.asin(Math.max(-1, Math.min(1, y0))) * 180) / Math.PI;
  const theta = (Math.atan2(x, z0) * 180) / Math.PI;
  if (theta < -CAP_HALF_THETA || theta > CAP_HALF_THETA || phi < PHI_MIN || phi > PHI_MAX) return null;
  return { theta, phi };
}

function unitVector({ theta, phi }: Angles) {
  const t = (theta * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
}

// A low arc hugging the cap: peak height grows gently with distance
// (0.02 + chord × 0.01, capped), raised by 4·h·t·(1 − t) along the route.
/** The route as view-box points [x0, y0, x1, y1, …], origin first. */
export function capRoutePoints(from: Place, to: Place, seam = SEAM_LONGITUDE) {
  const a = sphereAngles(from.longitude, from.latitude, seam);
  const b = sphereAngles(to.longitude, to.latitude, seam);
  const chord = Math.hypot(...unitVector(a).map((value, index) => value - unitVector(b)[index]));
  const height = 0.02 + Math.min(0.5, chord * 0.01);
  const steps = 32;
  const points: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const radius = 1.002 + 4 * height * t * (1 - t);
    const { x, y } = toView({ theta: a.theta + (b.theta - a.theta) * t, phi: a.phi + (b.phi - a.phi) * t }, radius);
    points.push(x, y);
  }
  return points;
}

export function capRoutePath(from: Place, to: Place, seam = SEAM_LONGITUDE) {
  const points = capRoutePoints(from, to, seam);
  let d = "";
  for (let index = 0; index < points.length; index += 2) {
    d += `${index ? " L" : "M"} ${points[index].toFixed(1)} ${points[index + 1].toFixed(1)}`;
  }
  return d;
}
