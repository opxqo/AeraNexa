import type { SceneName } from "@/lib/pricing-copy";

// The plan cards' pictures: pixel art of the Earth and Moon, the Solar System
// and a spiral galaxy, painted on a 48 × 27 grid of 4px cells in the page's
// orange ramp. They are generated from a few shapes and a fixed seed, so the
// output is the same on every render and ships as plain SVG paths.
const W = 48;
const H = 27;
const CELL = 4;

const PALE = "#ffe6d4";
const LIGHT = "#ffc9a3";
const MID = "#ffa066";
const HOT = "#f45300";
const DEEP = "#c43c00";
const DARK = "#8a2c00";
const NIGHT = "#5c1a00";

type Grid = (string | undefined)[][];
const blank = (): Grid => Array.from({ length: H }, () => Array<string | undefined>(W).fill(undefined));

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inside = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
function put(grid: Grid, x: number, y: number, color: string, keep = false) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (inside(cx, cy) && !(keep && grid[cy][cx])) grid[cy][cx] = color;
}

/** Fill the cells whose centres lie inside a circle; `paint` gets the position
 *  in the circle (nx, ny in −1…1, d = distance / radius) and returns a colour. */
function disc(grid: Grid, cx: number, cy: number, r: number, paint: (nx: number, ny: number, d: number) => string | undefined) {
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      const color = paint(dx / r, dy / r, d);
      if (color) grid[y][x] = color;
    }
  }
}

// A sphere lit from the upper left: pick from a dark → light ramp.
const shade = (ramp: string[], nx: number, ny: number) => {
  const light = -(nx * 0.6 + ny * 0.6); // −0.85 … 0.85
  const at = Math.round(((light + 0.85) / 1.7) * (ramp.length - 1));
  return ramp[Math.min(ramp.length - 1, Math.max(0, at))];
};

// One cell in every three along the arc, so an orbit reads as a dotted line
// however steep it runs.
function dottedArc(grid: Grid, cx: number, cy: number, rx: number, ry: number, from: number, to: number, color: string) {
  const step = 0.8 / Math.max(rx, ry);
  for (let a = from, i = 0; a < to; a += step, i += 1) {
    if (i % 3 === 0) put(grid, cx + rx * Math.cos(a), cy + ry * Math.sin(a), color, true);
  }
}

function specks(grid: Grid, seed: number, count: number, colors: string[]) {
  const random = seeded(seed);
  for (let i = 0; i < count; i += 1) put(grid, random() * W, random() * H, colors[i % colors.length], true);
}

function earthMoon(dark: boolean) {
  const grid = blank();
  const [ex, ey] = [35, 14];
  dottedArc(grid, ex, ey, 22, 8, 0, Math.PI * 2, dark ? DARK : LIGHT);
  // Earth: a dark sea, pale land in big blobs, a thin dithered rim of air.
  disc(grid, ex, ey, 11.5, (nx, ny) => {
    const x = nx * 11.5;
    const y = ny * 11.5;
    const land = Math.sin(x * 0.42 + 1.3) * Math.cos(y * 0.5 - 0.4) + Math.sin(x * 0.2 + y * 0.31) * 0.6 > 0.42;
    return land ? shade([MID, LIGHT, PALE], nx, ny) : shade([NIGHT, DARK, DEEP, HOT], nx, ny);
  });
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = Math.hypot(x + 0.5 - ex, y + 0.5 - ey);
      if (d > 11.5 && d <= 12.9 && (x + y) % 2 === 0) grid[y][x] = dark ? MID : LIGHT;
    }
  }
  // The Moon, on its orbit on the far side, with a few craters.
  const [mx, my] = [ex - 20.7, ey - 2.7];
  disc(grid, mx, my, 4, (nx, ny) => shade([MID, LIGHT, PALE, PALE], nx, ny));
  [[-1.2, -1.4], [1.3, 0.4], [-0.6, 1.8]].forEach(([dx, dy]) => put(grid, mx + dx, my + dy, MID));
  specks(grid, 11, 12, dark ? ["#f8fafb", MID] : [MID, LIGHT]);
  return grid;
}

function solarSystem(dark: boolean) {
  const grid = blank();
  const [sx, sy] = [50, 13.5];
  // Eight orbits left of the Sun, the asteroid belt between Mars and Jupiter,
  // a planet on each orbit, then the Sun with its corona.
  const orbits = [15.5, 19, 22.5, 26, 31, 36.5, 41.5, 46];
  orbits.forEach((r, i) => dottedArc(grid, sx, sy, r, r, Math.PI - 0.5 + i * 0.02, Math.PI + 0.5 - i * 0.02, dark ? NIGHT : LIGHT));
  const random = seeded(7);
  for (let i = 0; i < 10; i += 1) {
    const a = Math.PI - 0.42 + random() * 0.84;
    const r = 28.5 + (random() - 0.5) * 1.6;
    put(grid, sx + r * Math.cos(a), sy + r * Math.sin(a), i % 3 ? MID : LIGHT);
  }
  const at = (r: number, phi: number) => [sx - r * Math.cos(phi), sy + r * Math.sin(phi)] as const;
  const planet = (r: number, phi: number, size: number, ramp: string[]) => {
    const [x, y] = at(r, phi);
    disc(grid, x, y, size, (nx, ny) => shade(ramp, nx, ny));
    return [x, y] as const;
  };
  planet(orbits[0], 0.45, 1.1, [DEEP, MID]); // Mercury
  planet(orbits[1], -0.4, 1.8, [MID, LIGHT, PALE]); // Venus
  const [ex, ey] = planet(orbits[2], 0.35, 2, [DARK, HOT, MID, LIGHT]); // Earth, with its Moon
  put(grid, ex + 2.4, ey - 1.6, PALE);
  planet(orbits[3], -0.3, 1.5, [NIGHT, DEEP, HOT]); // Mars
  const [jx, jy] = at(orbits[4], 0.15); // Jupiter, in bands
  disc(grid, jx, jy, 3.8, (nx, ny) => (Math.round(ny * 3) % 2 === 0 ? shade([DEEP, MID, LIGHT], nx, ny) : shade([DARK, HOT, MID], nx, ny)));
  const [tx, ty] = at(orbits[5], -0.1); // Saturn: the ring's far half, the globe, then its near half
  for (let a = 0; a < Math.PI * 2; a += 0.05) put(grid, tx + 4.8 * Math.cos(a), ty + 1.3 * Math.sin(a), LIGHT);
  disc(grid, tx, ty, 2.5, (nx, ny) => shade([DEEP, MID, PALE], nx, ny));
  for (let a = 0; a < Math.PI; a += 0.05) put(grid, tx + 4.8 * Math.cos(a), ty + 1.3 * Math.sin(a), LIGHT);
  planet(orbits[6], 0.12, 2.2, [MID, LIGHT, PALE]); // Uranus
  planet(orbits[7], -0.2, 2.1, [NIGHT, DEEP, HOT, MID]); // Neptune
  disc(grid, sx, sy, 12, (_nx, _ny, d) => (d < 0.5 ? PALE : d < 0.72 ? LIGHT : d < 0.88 ? MID : HOT));
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      if (d > 12 && d <= 13.7 && (x + y) % 2 === 0) grid[y][x] = DEEP;
    }
  }
  specks(grid, 5, 10, dark ? ["#f8fafb", MID] : [MID, LIGHT]);
  return grid;
}

function galaxy(dark: boolean) {
  const grid = blank();
  const [cx, cy] = [24, 13.5];
  const tilt = -0.32;
  const random = seeded(23);
  const at = (ex: number, ey: number) => [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)] as const;
  // Star dust between the arms, a faint halo round the disc.
  for (let i = 0; i < 220; i += 1) {
    const r = 3 + Math.sqrt(random()) * 21;
    const a = random() * Math.PI * 2;
    const [x, y] = at(r * Math.cos(a), r * Math.sin(a) * 0.46);
    put(grid, x, y, r < 12 ? MID : r < 18 ? LIGHT : PALE, true);
  }
  // Two thick spiral arms, bright near the middle, fading out.
  for (let arm = 0; arm < 2; arm += 1) {
    for (let theta = 0.2; theta < 6.4; theta += 0.008) {
      const r = 2 + 3.3 * theta;
      const spread = 0.5 + r * 0.07;
      for (let k = 0; k < 7; k += 1) {
        const a = theta + Math.PI * arm;
        const [x, y] = at(r * Math.cos(a) + (random() - 0.5) * 2 * spread, (r * Math.sin(a) + (random() - 0.5) * 2 * spread) * 0.44);
        put(grid, x, y, r < 8 ? HOT : r < 13 ? MID : r < 18 ? LIGHT : PALE, true);
      }
    }
  }
  // The bulge.
  disc(grid, cx, cy, 7.4, (nx, ny) => {
    const e = Math.hypot(nx, ny * 1.6);
    return e < 0.42 ? PALE : e < 0.66 ? LIGHT : e < 0.88 ? MID : e < 1 ? HOT : undefined;
  });
  specks(grid, 3, 14, dark ? ["#f8fafb", MID] : [MID, LIGHT]);
  return grid;
}

const BUILD: Record<SceneName, (dark: boolean) => Grid> = { earthMoon, solar: solarSystem, galaxy };

/** One scene as SVG: a path per colour (horizontal runs of cells), with the
 *  same fine diagonal hatch as the hero's picture over the top. */
export function PlanScene({ scene, dark = false, className }: { scene: SceneName; dark?: boolean; className: string }) {
  const grid = BUILD[scene](dark);
  const byColor = new Map<string, string>();
  let all = "";
  grid.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const color = row[x];
      if (!color) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < W && row[end] === color) end += 1;
      const run = `M${x * CELL} ${y * CELL}h${(end - x) * CELL}v${CELL}h${-(end - x) * CELL}z`;
      byColor.set(color, (byColor.get(color) ?? "") + run);
      all += run;
      x = end;
    }
  });
  const hatch = `hatch-${scene}`;
  return (
    <svg className={className} width={W * CELL} height={H * CELL} viewBox={`0 0 ${W * CELL} ${H * CELL}`} shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <pattern id={hatch} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="#fff" strokeOpacity=".2" strokeWidth="1" />
        </pattern>
      </defs>
      {[...byColor].map(([color, d]) => <path key={color} d={d} fill={color} />)}
      <path d={all} fill={`url(#${hatch})`} />
    </svg>
  );
}
