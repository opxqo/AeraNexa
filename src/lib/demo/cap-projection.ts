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
const TOP_Y = 40;
const FRAME_EDGE = 14;
const FRAME_EDGE_LAT = 25;

// The map can curl from the cap into a whole globe (the /demo/world-map/cap
// scroll effect): `curl` runs 0 → 1 and every shape parameter below is
// interpolated between the cap (0, the constants the generator mirrors) and
// the globe (1): longitudes wrap all the way round, latitudes run pole to
// pole, the tilt swings the north toward the viewer and the camera pulls back until the whole sphere sits
// in the view. Everything in this module reads the current shape, so dots,
// cities, routes and markers curl together. The home page never sets curl.
type Shape = {
  north: number;
  south: number;
  spanLon: number;
  spanLat: number;
  latCenter: number;
  tilt: number;
  camera: number;
  halfTheta: number;
  phiMin: number;
  phiMax: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  centreUnits: number;
};

const CAP = { spanLon: 0.28, spanLat: 0.18, latCenter: (CAP_NORTH + CAP_SOUTH) / 2, tilt: 33, camera: 2.75, north: CAP_NORTH, south: CAP_SOUTH };
const GLOBE = { spanLon: 1, spanLat: 1, latCenter: 0, tilt: -18, camera: 4.2, north: 90, south: -90 };
// Globe diameter as a share of the view height, and where its top sits.
const GLOBE_FILL = 0.88;

export const CAP_SPAN_LON = CAP.spanLon;
/** Half the visible longitude sweep of the cap in sphere degrees (θ runs ±this). */
export const CAP_HALF_THETA = 180 * CAP.spanLon;
// Projected sphere angles are sampled this far apart for surface frames.
const FRAME_STEP = 0.5;

export type Angles = { theta: number; phi: number };
type Place = { longitude: number; latitude: number };

function rawWith(shape: Pick<Shape, "tilt" | "camera">, { theta, phi }: Angles, radius = 1) {
  const t = (theta * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  const tilt = (shape.tilt * Math.PI) / 180;
  const x = radius * Math.cos(p) * Math.sin(t);
  const y0 = radius * Math.sin(p);
  const z0 = radius * Math.cos(p) * Math.cos(t);
  const y = y0 * Math.cos(tilt) + z0 * Math.sin(tilt);
  const z = -y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
  const depth = shape.camera - z;
  return { x: x / depth, y: -y / depth, z };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function makeShape(curl: number): Shape {
  const spanLon = lerp(CAP.spanLon, GLOBE.spanLon, curl);
  const spanLat = lerp(CAP.spanLat, GLOBE.spanLat, curl);
  const latCenter = lerp(CAP.latCenter, GLOBE.latCenter, curl);
  const tilt = lerp(CAP.tilt, GLOBE.tilt, curl);
  const camera = lerp(CAP.camera, GLOBE.camera, curl);
  const north = lerp(CAP.north, GLOBE.north, curl);
  const south = lerp(CAP.south, GLOBE.south, curl);

  // Cap framing (same as frame() in the generator): two map longitudes near
  // the seam touch the view's sides, and the top of the rim sits at TOP_Y.
  const angles = (longitude: number, latitude: number) => ({
    theta: ((((longitude - SEAM_LONGITUDE) % 360) + 360) % 360 - 180) * CAP.spanLon,
    phi: (latitude - CAP.latCenter) * CAP.spanLat,
  });
  const left = rawWith(CAP, angles(SEAM_LONGITUDE + FRAME_EDGE, FRAME_EDGE_LAT)).x;
  const right = rawWith(CAP, angles(SEAM_LONGITUDE - FRAME_EDGE, FRAME_EDGE_LAT)).x;
  const capScale = CAP_VIEW_WIDTH / (right - left);
  const capTop = rawWith(CAP, angles(SEAM_LONGITUDE + 180, CAP.north)).y;
  const capOffsetX = CAP_VIEW_WIDTH / 2 - ((left + right) / 2) * capScale;
  const capOffsetY = TOP_Y - capTop * capScale;

  let scale = capScale;
  let offsetX = capOffsetX;
  let offsetY = capOffsetY;
  if (curl > 0) {
    // In between, follow the sphere's outline on screen: its radius shrinks
    // geometrically and its top edge glides to where the globe's will be.
    const silhouette = (camera: number) => 1 / Math.sqrt(camera * camera - 1);
    const capRadius = capScale * silhouette(CAP.camera);
    const globeRadius = (CAP_VIEW_HEIGHT * GLOBE_FILL) / 2;
    const radius = Math.exp(lerp(Math.log(capRadius), Math.log(globeRadius), curl));
    const top = lerp(capOffsetY - capRadius, CAP_VIEW_HEIGHT / 2 - globeRadius, curl);
    scale = radius / silhouette(camera);
    offsetX = lerp(capOffsetX, CAP_VIEW_WIDTH / 2, curl);
    offsetY = top + radius;
  }
  // Same arithmetic as toView, so the cap's surface frames stay bit-identical.
  const project = (theta: number) => rawWith({ tilt, camera }, { theta, phi: 0 }).x * scale + offsetX;
  return {
    north,
    south,
    spanLon,
    spanLat,
    latCenter,
    tilt,
    camera,
    halfTheta: 180 * spanLon,
    phiMin: (south - latCenter) * spanLat,
    phiMax: (north - latCenter) * spanLat,
    scale,
    offsetX,
    offsetY,
    centreUnits: project(FRAME_STEP) - project(0),
  };
}

let curl = 0;
let shape = makeShape(0);

/** Set how far the cap has curled into a globe (0 cap … 1 globe). */
export function setCapCurl(value: number) {
  const next = Math.min(1, Math.max(0, value));
  if (next === curl) return;
  curl = next;
  shape = makeShape(curl);
}

export function getCapCurl() {
  return curl;
}

/** The sphere's outline on screen (view units): centre and radius. */
export function capSilhouette() {
  return { x: shape.offsetX, y: shape.offsetY, radius: shape.scale / Math.sqrt(shape.camera * shape.camera - 1) };
}

/** Latitudes the current shape shows (the cap crops the poles). */
export function capLatRange() {
  return { north: shape.north, south: shape.south };
}

/** Half the visible longitude sweep for the current shape. */
export function capHalfTheta() {
  return shape.halfTheta;
}

export function sphereAngles(longitude: number, latitude: number, seam = SEAM_LONGITUDE): Angles {
  const lonNorm = (((longitude - seam) % 360) + 360) % 360;
  return { theta: (lonNorm - 180) * shape.spanLon, phi: (latitude - shape.latCenter) * shape.spanLat };
}

function raw(angles: Angles, radius = 1) {
  return rawWith(shape, angles, radius);
}

/** How squarely a point faces the camera: above 0 on the visible side of the
 *  sphere, 0 on its outline, below 0 round the back. */
export function capFacing(angles: Angles) {
  return raw(angles).z - 1 / shape.camera;
}

export function toView(angles: Angles, radius = 1) {
  const point = raw(angles, radius);
  return { x: point.x * shape.scale + shape.offsetX, y: point.y * shape.scale + shape.offsetY };
}

export function projectCapCity(longitude: number, latitude: number, seam = SEAM_LONGITUDE) {
  return toView(sphereAngles(longitude, latitude, seam));
}

/** Longitude/latitude under sphere angles θ/φ for a given seam. */
export function capLonLat({ theta, phi }: Angles, seam = SEAM_LONGITUDE) {
  const longitude = ((((theta / shape.spanLon + 180 + seam + 180) % 360) + 360) % 360) - 180;
  return { longitude, latitude: phi / shape.spanLat + shape.latCenter };
}

/** Trace a view-box point back onto the front of the sphere (mirror of the
 *  generator's unproject). Returns null off the sphere or outside the map. */
export function unprojectCap(px: number, py: number): Angles | null {
  const { scale, offsetX, offsetY, camera } = shape;
  const tilt = (shape.tilt * Math.PI) / 180;
  const u = (px - offsetX) / scale;
  const v = -(py - offsetY) / scale;
  const a = u * u + v * v + 1;
  const disc = camera * camera - a * (camera * camera - 1);
  if (disc < 0) return null;
  const s = (camera - Math.sqrt(disc)) / a;
  const x = u * s;
  const y = v * s;
  const z = camera - s;
  const y0 = y * Math.cos(tilt) - z * Math.sin(tilt);
  const z0 = y * Math.sin(tilt) + z * Math.cos(tilt);
  const phi = (Math.asin(Math.max(-1, Math.min(1, y0))) * 180) / Math.PI;
  const theta = (Math.atan2(x, z0) * 180) / Math.PI;
  if (theta < -shape.halfTheta || theta > shape.halfTheta || phi < shape.phiMin || phi > shape.phiMax) return null;
  return { theta, phi };
}

/** The ground plane under a place: its view position plus the view-box vectors
 *  one unit east and one unit north along the surface. Drawing through
 *  `context.transform(east[0], east[1], north[0], north[1], x, y)` lays shapes
 *  flat on the tilted sphere, so a circle lands as a foreshortened ellipse.
 *  Units are 1:1 with the view at the centre of the sphere's face. */
export function capSurfaceFrame(longitude: number, latitude: number, seam = SEAM_LONGITUDE) {
  const { theta, phi } = sphereAngles(longitude, latitude, seam);
  const centre = toView({ theta, phi });
  // θ steps shrink toward the poles; divide by cos φ to keep the frame square.
  const east = toView({ theta: theta + FRAME_STEP / Math.max(0.05, Math.cos((phi * Math.PI) / 180)), phi });
  const north = toView({ theta, phi: phi + FRAME_STEP });
  const units = shape.centreUnits;
  return {
    x: centre.x,
    y: centre.y,
    east: [(east.x - centre.x) / units, (east.y - centre.y) / units] as const,
    north: [(north.x - centre.x) / units, (north.y - centre.y) / units] as const,
  };
}

function unitVector({ theta, phi }: Angles) {
  const t = (theta * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
}

// Beyond this θ a route has left the cap past the seam; much further and the
// sphere turns away, where points would fold back over the front.
const ROUTE_THETA_MARGIN = 12;

// A low arc hugging the cap: peak height grows gently with distance
// (0.02 + chord × 0.01, capped), raised by 4·h·t·(1 − t) along the route.
// Routes take the shorter way round the globe. When that crosses the seam,
// the end nearer the edge is moved a full turn so the route runs off that
// edge, and only the part still on the visible side is kept: the comet flies
// in from (or out past) the edge of the map. Once the map curls into a
// globe, points round the back are dropped too, keeping the visible run
// that holds the destination (or failing that, the origin).
/** The route as view-box points [x0, y0, x1, y1, …], origin first. */
export function capRoutePoints(from: Place, to: Place, seam = SEAM_LONGITUDE) {
  const a = sphereAngles(from.longitude, from.latitude, seam);
  const b = sphereAngles(to.longitude, to.latitude, seam);
  const half = shape.halfTheta;
  if (Math.abs(b.theta - a.theta) > half) {
    const turn = 2 * half;
    if (Math.abs(a.theta) > Math.abs(b.theta)) a.theta -= Math.sign(a.theta) * turn;
    else b.theta -= Math.sign(b.theta) * turn;
  }
  const chord = Math.hypot(...unitVector(a).map((value, index) => value - unitVector(b)[index]));
  const height = 0.02 + Math.min(0.5, chord * 0.01);
  const steps = 48;
  const runs: number[][] = [];
  let run: number[] = [];
  let lastVisible = false;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angles = { theta: a.theta + (b.theta - a.theta) * t, phi: a.phi + (b.phi - a.phi) * t };
    const visible = Math.abs(angles.theta) <= half + ROUTE_THETA_MARGIN && (curl === 0 || capFacing(angles) > 0);
    if (!visible) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    const radius = 1.002 + 4 * height * t * (1 - t);
    const { x, y } = toView(angles, radius);
    run.push(x, y);
    lastVisible = index === steps;
  }
  if (run.length) runs.push(run);
  if (runs.length <= 1) return runs[0] ?? [];
  return lastVisible ? runs[runs.length - 1] : runs[0];
}

export function capRoutePath(from: Place, to: Place, seam = SEAM_LONGITUDE) {
  const points = capRoutePoints(from, to, seam);
  let d = "";
  for (let index = 0; index < points.length; index += 2) {
    d += `${index ? " L" : "M"} ${points[index].toFixed(1)} ${points[index + 1].toFixed(1)}`;
  }
  return d;
}
