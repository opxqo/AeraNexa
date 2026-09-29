// Projection for the home page's 3D globe (src/components/world-globe.tsx),
// hand-rolled so the city tags and comets, drawn on 2D layers over the WebGL
// canvas, follow the very same camera three.js renders with: a perspective
// camera on the z axis (vertical fov 42°) looking at a globe turned by
// rotation.y = −(longitude at the middle) and tilted by rotation.x = pitch
// (three's XYZ order: turn first, then tilt). The sphere is the /globe demo's:
// ocean r = 1, land dots on r = 1.074, coast dots 1.078.

export const GLOBE_FOV = 42;
/** The dots' sphere; the globe's outline on screen is this sphere's. */
export const GLOBE_DOTS = 1.074;
/** North tilts this far toward the viewer (the demo's 18°). */
export const GLOBE_PITCH = 18;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const TAN_HALF = Math.tan(rad(GLOBE_FOV) / 2);

type Vector = [number, number, number];

export function createGlobeView() {
  let width = 1;
  let height = 1;
  let distance = 3.4;
  let focal = 1;
  let cosY = 1;
  let sinY = 0;
  let cosX = 1;
  let sinX = 0;

  /** Size the view: the dots' outline is `fill` of the height across. */
  function resize(nextWidth: number, nextHeight: number, fill: number) {
    width = nextWidth;
    height = nextHeight;
    focal = height / 2 / TAN_HALF;
    // tan(half the angle the sphere fills) = R / sqrt(d² − R²).
    const target = (height * fill) / 2 / focal;
    distance = GLOBE_DOTS * Math.sqrt(1 + 1 / (target * target));
  }

  /** Put `centerLongitude` in the middle, tilted by `pitch` degrees. */
  function orient(centerLongitude: number, pitch = GLOBE_PITCH) {
    cosY = Math.cos(rad(-centerLongitude));
    sinY = Math.sin(rad(-centerLongitude));
    cosX = Math.cos(rad(pitch));
    sinX = Math.sin(rad(pitch));
  }

  const turn = ([x, y, z]: Vector): Vector => {
    const turnedX = x * cosY + z * sinY;
    const turnedZ = -x * sinY + z * cosY;
    return [turnedX, y * cosX - turnedZ * sinX, y * sinX + turnedZ * cosX];
  };

  const surface = (longitude: number, latitude: number, radius: number): Vector => {
    const lon = rad(longitude);
    const lat = rad(latitude);
    return [radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.cos(lon)];
  };

  const screen = ([x, y, z]: Vector) => {
    const depth = distance - z;
    return { x: width / 2 + (focal * x) / depth, y: height / 2 - (focal * y) / depth };
  };

  /** Where a place is on screen (px), how squarely it faces the camera (above
   *  0 on the visible side of the dots' sphere) and whether the ocean hides it. */
  function project(longitude: number, latitude: number, radius = GLOBE_DOTS) {
    const point = turn(surface(longitude, latitude, radius));
    return { ...screen(point), facing: point[2] / radius - GLOBE_DOTS / distance };
  }

  // Is the world point hidden behind the ocean sphere (r = 1)?
  function hidden(point: Vector) {
    const dx = -point[0];
    const dy = -point[1];
    const dz = distance - point[2];
    // |p + s·(c − p)|² = 1, for the first s in (0, 1).
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (point[0] * dx + point[1] * dy + point[2] * dz);
    const c = point[0] * point[0] + point[1] * point[1] + point[2] * point[2] - 1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const s = (-b - Math.sqrt(disc)) / (2 * a);
    return s > 0 && s < 1;
  }

  /** The ground under a place: its position plus the screen vectors of one
   *  unit east and north along the surface (1 at the middle of the face, in
   *  the convention of cap-projection's capSurfaceFrame), for shockwaves and
   *  pins laid flat on the globe. */
  function surfaceFrame(longitude: number, latitude: number) {
    const lon = rad(longitude);
    const lat = rad(latitude);
    const base = turn(surface(longitude, latitude, GLOBE_DOTS));
    const step = 0.01;
    const eastWorld = turn([Math.cos(lon), 0, -Math.sin(lon)]);
    const northWorld = turn([-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)]);
    const centre = screen(base);
    const scale = (step * focal) / (distance - GLOBE_DOTS);
    const move = (direction: Vector) => {
      const moved = screen([base[0] + step * direction[0], base[1] + step * direction[1], base[2] + step * direction[2]]);
      return [(moved.x - centre.x) / scale, (moved.y - centre.y) / scale] as const;
    };
    return { x: centre.x, y: centre.y, east: move(eastWorld), north: move(northWorld) };
  }

  /** A comet's route, [x0, y0, x1, y1, …] in px, origin first: an arc over
   *  the surface (higher the longer the trip), cut where the ocean hides it.
   *  Keeps the visible run that holds the destination, else the origin. */
  function routePoints(from: { longitude: number; latitude: number }, to: { longitude: number; latitude: number }) {
    const a = surface(from.longitude, from.latitude, 1);
    const b = surface(to.longitude, to.latitude, 1);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const angle = Math.acos(dot);
    const chord = 2 * Math.sin(angle / 2);
    const peak = 0.04 + 0.05 * chord;
    const steps = 48;
    const runs: number[][] = [];
    let run: number[] = [];
    let lastVisible = false;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const sine = Math.sin(angle);
      const wa = sine < 1e-6 ? 1 - t : Math.sin((1 - t) * angle) / sine;
      const wb = sine < 1e-6 ? t : Math.sin(t * angle) / sine;
      const radius = 1.09 + peak * Math.sin(Math.PI * t);
      const point = turn([(a[0] * wa + b[0] * wb) * radius, (a[1] * wa + b[1] * wb) * radius, (a[2] * wa + b[2] * wb) * radius]);
      if (hidden(point)) {
        if (run.length) runs.push(run);
        run = [];
        lastVisible = false;
        continue;
      }
      const { x, y } = screen(point);
      run.push(x, y);
      lastVisible = index === steps;
    }
    if (run.length) runs.push(run);
    if (runs.length <= 1) return runs[0] ?? [];
    return lastVisible ? runs[runs.length - 1] : runs[0];
  }

  return { resize, orient, project, surfaceFrame, routePoints, get distance() { return distance; } };
}

export type GlobeView = ReturnType<typeof createGlobeView>;
