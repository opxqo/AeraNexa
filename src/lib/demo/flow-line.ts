// Connection lines for the home page's "unlock" block: curved links between
// nodes with a bright pulse running along them, after the node graph on
// flora.ai. Read from that page: its links are the open-source LeaderLine
// library (v1.0.8, MIT), each drawn twice over the same path —
//   • a faint 2px line, and
//   • a 2px pulse line, stroke-dasharray "48, 640" (one 48px dash, a gap
//     longer than the path), its stroke-dashoffset looping linearly at
//     ≈ .54px/ms, lit by a big drop-shadow glow.
// The curve is LeaderLine's "fluid" path between a right socket and a left
// socket: a cubic Bézier whose two control points reach straight out of the
// sockets by max(distance / 2, 80). This file keeps just that: the path, and
// a pulse that runs along it once, forwards or back (the block's pulses ride
// on a request, orange going out and green coming home, instead of looping).

export type Point = { x: number; y: number };

// LeaderLine's minimum socket gravity (`z = 80` in its source).
const MIN_GRAVITY = 80;

/** A cubic Bézier from `from`'s right side to `to`'s left side, both ends
 *  leaving horizontally (LeaderLine's "fluid" path). */
export function fluidPath(from: Point, to: Point) {
  const gravity = Math.max((to.x - from.x) / 2, MIN_GRAVITY);
  const at = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M ${at(from.x, from.y)} C ${at(from.x + gravity, from.y)}, ${at(to.x - gravity, to.y)}, ${at(to.x, to.y)}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Pulse speed in px per ms (flora.ai's runs at ≈ .54), its dash length, and
// how far past each end of the path the dash starts and stops, so it slides
// in and out instead of popping (round caps included).
const PULSE_SPEED = 0.5;
const DASH = 48;
const MARGIN = 8;
// The glow is three strokes over one path, wide and faint to narrow and
// solid: no CSS filter, which SVG children don't all support.
const LAYERS = [
  { width: 10, opacity: 0.14 },
  { width: 5, opacity: 0.22 },
  { width: 2, opacity: 1 },
];

/** How long a pulse takes to run a path of this length (ms). */
export const pulseDuration = (length: number) => Math.max(300, length / PULSE_SPEED);

/** Run one pulse along `d` (a path `length` px long) inside `layer`, from its
 *  start to its end, or back from the end when `reverse`. The pulse removes
 *  itself when it is done, then calls `onFinish`. */
export function playPulse(layer: SVGElement, { d, length, color, reverse = false, onFinish }: { d: string; length: number; color: string; reverse?: boolean; onFinish?: () => void }) {
  const group = document.createElementNS(SVG_NS, "g");
  const gap = length + 2 * (DASH + MARGIN);
  // With dashoffset o the dash covers [−o, −o + DASH] along the path.
  const before = DASH + MARGIN;
  const after = -(length + MARGIN);
  const [from, to] = reverse ? [after, before] : [before, after];
  let last: Animation | null = null;
  LAYERS.forEach(({ width, opacity }) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(width));
    path.setAttribute("stroke-opacity", String(opacity));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", `${DASH} ${gap}`);
    // Off the path already, for the frame before the animation takes over.
    path.style.strokeDashoffset = `${from}px`;
    group.append(path);
    last = path.animate([{ strokeDashoffset: `${from}px` }, { strokeDashoffset: `${to}px` }], { duration: pulseDuration(length), easing: "linear", fill: "forwards" });
  });
  layer.append(group);
  (last as Animation | null)!.onfinish = () => {
    group.remove();
    onFinish?.();
  };
}
