// Three pixel-art scenes for the cosmic-zoom splash: Earth and Moon, the Solar System, the
// Milky Way. Same look as the /pricing plan cards (orange ramp, lit from the upper left, dithered
// edges), redrawn at 240×135 so they hold up full screen. The little drawing primitives
// (seeded / disc / shade / dotted arcs / specks) follow src/components/pricing/pricing-scenes.tsx,
// which keeps its own private copies.

import { clamp01, seeded } from "@/lib/ease";

export const SCENE_W = 240;
export const SCENE_H = 135;
const TAU = Math.PI * 2;

/** RGBA bytes for little-endian Uint32 storage. */
function pack(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const PALE = pack("#ffe6d4");
const LIGHT = pack("#ffc9a3");
const MID = pack("#ffa066");
const HOT = pack("#f45300");
const DEEP = pack("#c43c00");
const DARK = pack("#8a2c00");
const NIGHT = pack("#5c1a00");
const STAR = pack("#f8fafb");
const LILAC = pack("#c9b8ff");
const VIOLET = pack("#4a4396");

type Point = { x: number; y: number };
type Painter = (nx: number, ny: number, d: number, x: number, y: number) => number | undefined;

class Pixels {
  readonly data = new Uint32Array(SCENE_W * SCENE_H);

  put(x: number, y: number, color: number) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= SCENE_W || py >= SCENE_H) return;
    this.data[py * SCENE_W + px] = color;
  }

  /** A filled disc; `paint` returns the colour for a pixel (or nothing to leave it). */
  disc(cx: number, cy: number, radius: number, paint: Painter) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        const nx = (x + 0.5 - cx) / radius;
        const ny = (y + 0.5 - cy) / radius;
        const d = Math.hypot(nx, ny);
        if (d > 1) continue;
        const color = paint(nx, ny, d, x, y);
        if (color) this.put(x, y, color);
      }
    }
  }

  /** A dotted ellipse (every other sample), optionally only part of the way round. */
  dotted(cx: number, cy: number, rx: number, ry: number, tilt: number, color: number, from = 0, to = TAU) {
    const step = 1.6 / Math.max(rx, ry);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    let k = 0;
    for (let a = from; a < to; a += step, k += 1) {
      if (k % 2) continue;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      this.put(cx + x * cos - y * sin, cy + x * sin + y * cos, color);
    }
  }

  specks(random: () => number, count: number, colors: number[]) {
    for (let index = 0; index < count; index += 1) {
      this.put(random() * SCENE_W, random() * SCENE_H, colors[Math.floor(random() * colors.length)]);
    }
  }
}

/** Ramp (dark → light) indexed by light from the upper left, with a checker dither between steps. */
function shade(ramp: number[], nx: number, ny: number, x: number, y: number) {
  const lit = clamp01(0.5 + 0.5 * (-nx * 0.6 - ny * 0.78) + ((x + y) % 2 ? 0.045 : -0.045));
  return ramp[Math.min(ramp.length - 1, Math.floor(lit * ramp.length))];
}

// Smooth value noise, for continents and clouds.
function hash(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy, seed) + (hash(ix + 1, iy, seed) - hash(ix, iy, seed)) * sx;
  const bottom = hash(ix, iy + 1, seed) + (hash(ix + 1, iy + 1, seed) - hash(ix, iy + 1, seed)) * sx;
  return top + (bottom - top) * sy;
}
const fbm = (x: number, y: number, seed: number) => noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 3) * 0.3 + noise(x * 4.3, y * 4.3, seed + 7) * 0.15;

export type Scene = { pixels: Uint32Array; anchors: Record<string, Point> };

const SEA = [NIGHT, DARK, DEEP, HOT];
const LAND = [MID, LIGHT, PALE];

/** A planet with continents, an ice cap and dithered cloud and atmosphere. */
function earth(pixels: Pixels, cx: number, cy: number, radius: number, detail: number) {
  pixels.disc(cx, cy, radius, (nx, ny, d, x, y) => {
    const land = fbm(nx * detail + 3.1, ny * detail + 1.7, 5) > 0.53;
    const cloud = fbm(nx * detail * 1.4 - 2, ny * detail * 1.4 + 6, 11) > 0.62 && (x + y) % 2 === 0;
    if (Math.abs(ny) > 0.88) return shade([LIGHT, PALE, PALE], nx, ny, x, y);
    if (cloud) return shade([LIGHT, PALE, PALE], nx, ny, x, y);
    return shade(land ? LAND : SEA, nx, ny, x, y);
  });
  // Atmosphere: a dithered halo just outside the limb.
  for (let y = Math.floor(cy - radius - 3); y <= Math.ceil(cy + radius + 3); y += 1) {
    for (let x = Math.floor(cx - radius - 3); x <= Math.ceil(cx + radius + 3); x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      if (d > 1 && d < 1.09 && (x + y) % 2 === 0) pixels.put(x, y, d < 1.045 ? MID : DEEP);
    }
  }
}

export function earthMoonScene(): Scene {
  const pixels = new Pixels();
  const random = seeded(11);
  pixels.specks(random, 46, [STAR, STAR, LILAC, DARK]);

  const home = { x: 108, y: 76 };
  pixels.dotted(home.x, home.y, 92, 27, -0.28, DARK);
  earth(pixels, home.x, home.y, 38, 2.3);

  const moon = { x: 198, y: 38 };
  pixels.disc(moon.x, moon.y, 9, (nx, ny, d, x, y) => shade([DARK, DEEP, MID, LIGHT, PALE], nx, ny, x, y));
  for (const [dx, dy, r] of [[-3, -2, 1.7], [2, 3, 1.4], [3, -3, 1.1], [-2, 4, 1.2], [4, 1, 0.9]]) {
    pixels.disc(moon.x + dx, moon.y + dy, r, () => DEEP);
  }
  return { pixels: pixels.data, anchors: { earth: home } };
}

export function solarSystemScene(): Scene {
  const pixels = new Pixels();
  const random = seeded(7);
  pixels.specks(random, 40, [STAR, STAR, LILAC, DARK]);

  const sun = { x: 120, y: 67 };
  const FLAT = 0.38;
  const orbits = [16, 24, 33, 42, 58, 76, 94, 112];
  orbits.forEach((radius) => pixels.dotted(sun.x, sun.y, radius, radius * FLAT, 0, DARK));

  // The asteroid belt, between Mars and Jupiter.
  for (let index = 0; index < 70; index += 1) {
    const a = random() * TAU;
    const r = 49 + (random() - 0.5) * 5;
    pixels.put(sun.x + Math.cos(a) * r, sun.y + Math.sin(a) * r * FLAT, [DARK, DEEP, MID][Math.floor(random() * 3)]);
  }

  const at = (orbit: number, angle: number) => ({ x: sun.x + Math.cos(angle) * orbits[orbit], y: sun.y + Math.sin(angle) * orbits[orbit] * FLAT });
  const planet = (orbit: number, angle: number, radius: number, ramp: number[]) => {
    const place = at(orbit, angle);
    pixels.disc(place.x, place.y, radius, (nx, ny, d, x, y) => shade(ramp, nx, ny, x, y));
    return place;
  };

  planet(0, 2.4, 1.5, [DEEP, MID, LIGHT]);
  planet(1, -0.6, 3.4, [DARK, HOT, MID, LIGHT]);
  const earthAt = at(2, -0.55);
  earth(pixels, earthAt.x, earthAt.y, 3.8, 1.3);
  planet(3, 2.9, 2.4, [NIGHT, DEEP, HOT]);
  // Jupiter, banded.
  const jupiter = at(4, 0.7);
  pixels.disc(jupiter.x, jupiter.y, 6.4, (nx, ny, d, x, y) => shade(Math.round((ny + 1) * 3.2) % 2 ? [DEEP, MID, LIGHT] : [DARK, HOT, MID], nx, ny, x, y));
  // Saturn: the far half of the ring, the globe, then the near half.
  const saturn = at(5, -2.4);
  for (let a = Math.PI; a < TAU; a += 0.09) pixels.put(saturn.x + Math.cos(a) * 9.5, saturn.y + Math.sin(a) * 2.6, LIGHT);
  pixels.disc(saturn.x, saturn.y, 5.2, (nx, ny, d, x, y) => shade([DEEP, MID, LIGHT, PALE], nx, ny, x, y));
  for (let a = 0; a < Math.PI; a += 0.09) pixels.put(saturn.x + Math.cos(a) * 9.5, saturn.y + Math.sin(a) * 2.6, LIGHT);
  planet(6, 2.0, 4, [MID, LIGHT, PALE]);
  planet(7, -0.9, 3.8, [NIGHT, DEEP, HOT, MID]);

  // The sun, with a dithered corona.
  pixels.disc(sun.x, sun.y, 11, (nx, ny, d) => (d < 0.45 ? PALE : d < 0.7 ? LIGHT : d < 0.88 ? MID : HOT));
  for (let y = sun.y - 15; y <= sun.y + 15; y += 1) {
    for (let x = sun.x - 15; x <= sun.x + 15; x += 1) {
      const d = Math.hypot(x + 0.5 - sun.x, y + 0.5 - sun.y);
      if (d > 11 && d < 13.6 && (x + y) % 2 === 0) pixels.put(x, y, DEEP);
    }
  }
  return { pixels: pixels.data, anchors: { sun, earth: earthAt } };
}

export function galaxyScene(): Scene {
  const pixels = new Pixels();
  const random = seeded(23);
  const core = { x: 120, y: 67 };
  const TILT = -0.35;
  const FLATTEN = 0.5;
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  // A point on a spiral arm at angle θ (arm 0 or 1), tilted and flattened into the disc's plane.
  const arm = (theta: number, which: number, across = 0) => {
    const r = 6 + 9.5 * theta + across;
    const a = theta + which * Math.PI;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * FLATTEN;
    return { x: core.x + x * cos - y * sin, y: core.y + x * sin + y * cos };
  };

  pixels.specks(random, 70, [STAR, STAR, STAR, LILAC]);
  // A faint halo of far stars round the disc.
  for (let index = 0; index < 220; index += 1) {
    const a = random() * TAU;
    const r = Math.sqrt(random()) * 118;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * FLATTEN * 1.15;
    pixels.put(core.x + x * cos - y * sin, core.y + x * sin + y * cos, random() < 0.5 ? VIOLET : NIGHT);
  }

  for (let which = 0; which < 2; which += 1) {
    for (let theta = 0.25; theta < 10.4; theta += 0.014) {
      const radius = 6 + 9.5 * theta;
      const width = 1.2 + radius * 0.075;
      const fade = radius > 86 ? 1 - (radius - 86) / 22 : 1;
      for (let dot = 0; dot < (radius < 30 ? 4 : 3); dot += 1) {
        if (random() > fade) continue;
        const across = (random() + random() - 1) * width;
        const t = radius / 106;
        const pick = random();
        const color =
          t > 0.6 && pick < 0.08 ? LILAC : t < 0.2 ? (pick < 0.5 ? PALE : LIGHT) : t < 0.45 ? (pick < 0.5 ? LIGHT : MID) : t < 0.7 ? (pick < 0.5 ? MID : HOT) : pick < 0.6 ? HOT : DEEP;
        const point = arm(theta, which, across);
        pixels.put(point.x, point.y, color);
      }
      // A dust lane hugging the inside of the arm.
      if (random() < 0.3) {
        const lane = arm(theta, which, -width * 1.3);
        pixels.put(lane.x, lane.y, NIGHT);
      }
    }
  }

  // The bulge.
  pixels.disc(core.x, core.y, 13, (nx, ny, d, x, y) => {
    const squashed = Math.hypot(nx, ny / 0.62);
    if (squashed > 1) return undefined;
    return squashed < 0.35 ? PALE : squashed < 0.6 ? LIGHT : squashed < 0.85 ? MID : (x + y) % 2 ? HOT : MID;
  });

  // The Sun's neighbourhood, marked: a small cross and a dithered ring.
  const here = arm(5.6, 0);
  for (let dx = -1; dx <= 1; dx += 1) {
    pixels.put(here.x + dx, here.y, PALE);
    pixels.put(here.x, here.y + dx, PALE);
  }
  for (let y = -5; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      const d = Math.hypot(x, y);
      if (d > 3.6 && d < 5 && (x + y) % 2 === 0) pixels.put(here.x + x, here.y + y, HOT);
    }
  }
  return { pixels: pixels.data, anchors: { core, here } };
}

/** The stars behind everything: fixed grid positions with their own twinkle. */
export function starField(count: number) {
  const random = seeded(99);
  return Array.from({ length: count }, () => ({
    x: random(),
    y: random(),
    speed: 0.6 + random() * 2.2,
    phase: random() * TAU,
    color: random() < 0.18 ? "#c9b8ff" : random() < 0.4 ? "#ffd9c2" : "#f8fafb",
  }));
}
