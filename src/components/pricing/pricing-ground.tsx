import type { SceneName } from "@/lib/pricing-copy";
import styles from "./pricing-page.module.css";

// The strip of pixel art along the bottom of each plan card, under its list:
// the green of the Earth (forest and a field of flowers), a satellite, a ship
// and a station over the dark of the Solar System, and a UFO among the stars
// of the Galaxy. 90 × 27 cells of 4px, drawn from a few shapes and a fixed
// seed, so it is the same on every render and ships as plain SVG paths. The
// stars twinkle, the UFO bobs and the ship's flame flickers, all in CSS.
const W = 90;
const H = 27;
const CELL = 4;

type Cells = Map<string, [number, number][]>;
type Layer = { cells: Cells; className?: string; opacity?: number };

const layer = (className?: string, opacity?: number): Layer => ({ cells: new Map(), className, opacity });
function put(target: Layer, x: number, y: number, color: string) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return;
  for (const list of target.cells.values()) {
    const at = list.findIndex(([px, py]) => px === cx && py === cy);
    if (at >= 0) list.splice(at, 1);
  }
  const list = target.cells.get(color) ?? [];
  list.push([cx, cy]);
  target.cells.set(color, list);
}
const rect = (target: Layer, x: number, y: number, width: number, height: number, color: string) => {
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) put(target, x + column, y + row, color);
};
function disc(target: Layer, cx: number, cy: number, radius: number, paint: (nx: number, ny: number) => string | undefined) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.hypot(dx, dy) > radius) continue;
      const color = paint(dx / radius, dy / radius);
      if (color) put(target, x, y, color);
    }
  }
}
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A sphere lit from the upper left, from a dark → light ramp.
const shade = (ramp: string[], nx: number, ny: number) => ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(((-(nx * 0.6 + ny * 0.6) + 0.85) / 1.7) * (ramp.length - 1))))];

// ---- The Earth: hills, a forest, a field of flowers, a lake ----
function earth(): Layer[] {
  const base = layer();
  const random = seeded(31);
  const far = (x: number) => 15.5 + 2.6 * Math.sin(x * 0.085 + 1);
  const near = (x: number) => 19 + 2.2 * Math.sin(x * 0.07 + 3.2);
  for (let x = 0; x < W; x += 1) {
    for (let y = Math.floor(far(x)); y < H; y += 1) put(base, x, y, "#9be08a");
    for (let y = Math.floor(near(x)); y < H; y += 1) put(base, x, y, "#5fbf6a");
    for (let y = 24; y < H; y += 1) put(base, x, y, "#2f8f4e");
  }
  // A lake between the hills.
  for (let x = 60; x < 80; x += 1) {
    const depth = Math.round(1.4 * Math.sqrt(Math.max(0, 1 - ((x - 70) / 10) ** 2)));
    for (let y = 21; y < 21 + depth; y += 1) put(base, x, y, y === 21 ? "#cdeafc" : "#8ccbf0");
  }
  // Clouds.
  [[12, 4, 4], [40, 6, 3], [74, 3, 4]].forEach(([cx, cy, size]) => {
    rect(base, cx - size, cy, size * 2, 1, "#eef3f8");
    rect(base, cx - size + 1, cy - 1, size, 1, "#eef3f8");
    rect(base, cx - 1, cy - 2, 3, 1, "#eef3f8");
  });
  // Pines (trunk, three tiers) and round trees.
  const pine = (x: number, ground: number, tall: number) => {
    rect(base, x, ground - 1, 1, 2, "#6b4423");
    for (let tier = 0; tier < tall; tier += 1) {
      const width = 1 + tier * 2;
      rect(base, x - tier, ground - 2 - tier * 2 - 1, width, 2, tier % 2 ? "#2f8f4e" : "#1f6f3a");
    }
    put(base, x, ground - 2 - tall * 2 - 1, "#1f6f3a");
  };
  [4, 8, 12, 17, 21, 26, 6, 15, 24].forEach((x, index) => pine(x, Math.round(near(x)) + 4 + (index % 3), 2 + (index % 2)));
  [66, 71, 76, 81, 86, 69, 79].forEach((x, index) => pine(x, Math.round(near(x)) + 5 + (index % 2), 2 + (index % 2)));
  [36, 58].forEach((x) => {
    rect(base, x, Math.round(near(x)) + 2, 1, 3, "#6b4423");
    disc(base, x + 0.5, Math.round(near(x)) + 1, 2.6, (nx, ny) => shade(["#1f6f3a", "#2f8f4e", "#5fbf6a"], nx, ny));
  });
  // Flowers across the meadow.
  const colors = ["#f45300", "#ff8fb1", "#ffd23f", "#ffffff", "#ff7a2f"];
  for (let x = 30; x < 62; x += 1) {
    for (let y = Math.round(near(x)) + 1; y < 24; y += 1) {
      if (random() < 0.36) put(base, x, y, colors[Math.floor(random() * colors.length)]);
    }
  }
  return [base];
}

// ---- The Solar System: a satellite, a ship, a station, a planet's limb ----
function solar(): Layer[] {
  const base = layer();
  const flame = layer("flicker");
  const twinkle = layer("twinkleA");
  const random = seeded(17);
  // The limb of a planet along the bottom, lit from the top.
  disc(base, 45, 62, 39.5, (_nx, ny) => (ny < -0.94 ? "#f45300" : ny < -0.9 ? "#c43c00" : ny < -0.82 ? "#8a2c00" : "#3a1a0c"));
  // A dotted orbit.
  for (let a = 3.5; a < 6; a += 0.045) put(base, 45 + 42 * Math.cos(a), 30 + 17 * Math.sin(a), "#8a2c00");
  for (let i = 0; i < 30; i += 1) {
    const x = Math.floor(random() * W);
    const y = Math.floor(random() * 22);
    put(i % 4 === 0 ? twinkle : base, x, y, i % 3 === 0 ? "#ffa066" : "#f8fafb");
  }
  // Satellite: a body, two panels with grid lines, a dish.
  rect(base, 19, 8, 4, 4, "#d5d9e0");
  rect(base, 19, 8, 4, 1, "#f8fafb");
  rect(base, 20, 9, 2, 2, "#5b6272");
  rect(base, 11, 9, 7, 2, "#2f6fe0");
  rect(base, 24, 9, 7, 2, "#2f6fe0");
  [12, 14, 16, 25, 27, 29].forEach((x) => rect(base, x, 9, 1, 2, "#ffd23f"));
  rect(base, 18, 10, 1, 1, "#8a93a4");
  rect(base, 23, 10, 1, 1, "#8a93a4");
  rect(base, 20, 5, 1, 3, "#8a93a4");
  put(base, 19, 4, "#f45300");
  put(base, 20, 4, "#f45300");
  put(base, 21, 4, "#f45300");
  // Ship, nose to the right, with a flame behind.
  rect(base, 50, 13, 12, 5, "#e5e7eb");
  rect(base, 62, 14, 2, 3, "#e5e7eb");
  put(base, 64, 15, "#e5e7eb");
  rect(base, 50, 13, 12, 1, "#f8fafb");
  rect(base, 52, 15, 8, 1, "#f45300");
  rect(base, 57, 14, 2, 1, "#7dd3fc");
  rect(base, 54, 10, 4, 3, "#c43c00");
  rect(base, 54, 18, 4, 3, "#c43c00");
  rect(base, 50, 16, 12, 2, "#b6bcc8");
  rect(base, 46, 14, 4, 3, "#f45300");
  rect(base, 44, 15, 2, 1, "#ffd23f");
  rect(base, 48, 15, 2, 1, "#ffffff");
  rect(flame, 42, 15, 2, 1, "#ff8a3d");
  rect(flame, 46, 13, 2, 1, "#ff8a3d");
  rect(flame, 46, 17, 2, 1, "#ff8a3d");
  // Station: a module, a truss and two panels.
  rect(base, 76, 6, 4, 4, "#d5d9e0");
  rect(base, 77, 7, 2, 2, "#5b6272");
  rect(base, 68, 7, 20, 1, "#8a93a4");
  rect(base, 69, 5, 4, 5, "#2f6fe0");
  rect(base, 83, 5, 4, 5, "#2f6fe0");
  rect(base, 70, 5, 1, 5, "#ffd23f");
  rect(base, 85, 5, 1, 5, "#ffd23f");
  put(base, 77, 4, "#f45300");
  return [base, twinkle, flame];
}

// ---- The Galaxy: stars, a UFO with its beam, a ringed rock, a comet ----
function galaxy(): Layer[] {
  const base = layer();
  const a = layer("twinkleA");
  const b = layer("twinkleB");
  const c = layer("twinkleC");
  const ufo = layer("bob");
  const beam = layer("bob", 0.2);
  const random = seeded(9);
  const stars = ["#f8fafb", "#ffd9c2", "#c9b8ff", "#ffffff"];
  for (let i = 0; i < 80; i += 1) {
    const target = [base, a, b, c][i % 4];
    put(target, random() * W, random() * 21, stars[Math.floor(random() * stars.length)]);
  }
  // Bigger stars, as small crosses.
  [[8, 5], [30, 3], [61, 6], [84, 12], [72, 2], [20, 14]].forEach(([x, y], index) => {
    const target = [a, b, c][index % 3];
    [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => put(target, x + dx, y + dy, dx || dy ? "#c9b8ff" : "#ffffff"));
  });
  // The ground the beam lands on: a dim, cratered surface.
  for (let x = 0; x < W; x += 1) {
    const top = 24 + Math.round(1.2 * Math.sin(x * 0.2 + 1));
    for (let y = top; y < H; y += 1) put(base, x, y, y === top ? "#4a4396" : "#2a2560");
  }
  [[12, 25], [33, 26], [64, 25], [80, 26]].forEach(([x, y]) => put(base, x, y, "#1b1836"));
  // A ringed rock on the left.
  for (let angle = 0; angle < Math.PI * 2; angle += 0.09) put(base, 15 + 6 * Math.cos(angle), 16 + 1.5 * Math.sin(angle), "#ffc9a3");
  disc(base, 15, 16, 3.4, (nx, ny) => shade(["#5c1a00", "#8a2c00", "#c43c00", "#f45300", "#ffa066"], nx, ny));
  for (let angle = 0; angle < Math.PI; angle += 0.09) put(base, 15 + 6 * Math.cos(angle), 16 + 1.5 * Math.sin(angle), "#ffc9a3");
  // A comet, its tail trailing up and to the right.
  for (let i = 0; i < 14; i += 1) put(base, 78 - i * 1.4, 7 + i * 0.55, i < 2 ? "#ffffff" : i < 6 ? "#ffd9c2" : i < 10 ? "#ffa066" : "#8a2c00");
  rect(base, 78, 6, 2, 2, "#ffffff");
  // The UFO: dome, saucer, a ring of lights, and the beam under it.
  disc(ufo, 45, 10.6, 3.4, (nx, ny) => (ny > 0.2 ? undefined : nx < -0.2 && ny < -0.3 ? "#ecfeff" : "#8ee7f5"));
  rect(ufo, 37, 12, 16, 1, "#e2e8f0");
  rect(ufo, 35, 13, 20, 2, "#cbd5e1");
  rect(ufo, 39, 15, 12, 1, "#64748b");
  rect(ufo, 42, 16, 6, 1, "#475569");
  [36, 40, 44, 48, 52].forEach((x, index) => rect(ufo, x, 13, 1, 1, index % 2 ? "#f45300" : "#ffd23f"));
  for (let y = 17; y < 25; y += 1) {
    const spread = Math.round((y - 16) * 0.9);
    rect(beam, 45 - 3 - spread, y, 6 + spread * 2, 1, "#c9b8ff");
  }
  return [base, a, b, c, beam, ufo];
}

const BUILD: Record<SceneName, () => Layer[]> = { earthMoon: earth, solar, galaxy };
const CLASS: Record<string, string | undefined> = { twinkleA: styles.twinkleA, twinkleB: styles.twinkleB, twinkleC: styles.twinkleC, flicker: styles.flicker, bob: styles.bob };

export function PlanGround({ scene, className }: { scene: SceneName; className: string }) {
  const layers = BUILD[scene]();
  const hatch = `ground-hatch-${scene}`;
  return (
    <svg className={className} width={W * CELL} height={H * CELL} viewBox={`0 0 ${W * CELL} ${H * CELL}`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <pattern id={hatch} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="#fff" strokeOpacity=".12" strokeWidth="1" />
        </pattern>
      </defs>
      {layers.map((item, index) => {
        let all = "";
        const paths = [...item.cells].map(([color, list]) => {
          const d = list.map(([x, y]) => `M${x * CELL} ${y * CELL}h${CELL}v${CELL}h${-CELL}z`).join("");
          all += d;
          return <path key={color} d={d} fill={color} />;
        });
        return (
          <g key={index} className={item.className ? CLASS[item.className] : undefined} opacity={item.opacity}>
            {paths}
            {index === 0 && <path d={all} fill={`url(#${hatch})`} />}
          </g>
        );
      })}
    </svg>
  );
}
