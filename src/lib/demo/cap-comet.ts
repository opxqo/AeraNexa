// A comet flying along a route, drawn on a canvas in view-box units.
//
// It is one continuous streak, not a ball with a ribbon: a tapered body that
// narrows to a point at the tail and to a sharp nose in front, a soft glow
// around it (canvas shadow), and a thin white-hot core along its front part.
// Brightest at the head, fading out behind. Sizes are in CSS pixels and
// converted with `unitsPerPixel` (view units per CSS pixel).

export type CometStyle = {
  accent: string;       // body colour, "r, g, b"
  hot: string;          // core colour near the head, "r, g, b"
  width: number;        // body width at the head, px
  nose: number;         // how far the pointed nose reaches ahead of the head, px
  tailLength: number;   // longest tail, px (reached at top speed)
  tailFraction: number; // tail never longer than this fraction of the route
  coreFraction: number; // share of the tail the hot core runs along
  coreWidth: number;    // core width at the head, px
  glow: number;         // glow blur radius, px
};

export const COMET: CometStyle = {
  accent: "244, 83, 0",
  hot: "255, 214, 180",
  width: 5,
  nose: 9,
  tailLength: 960,
  tailFraction: 1,
  coreFraction: 0.3,
  coreWidth: 1.5,
  glow: 9,
};

// The "request succeeded" pulse that flies back from a destination: same
// streak, green, a shorter and lighter tail.
export const GREEN: CometStyle = { ...COMET, accent: "34, 197, 94", hot: "220, 255, 232", tailLength: 420, glow: 8 };

// A small packet (a request on its way in): slimmer and shorter than a comet.
export const PACKET: CometStyle = { ...COMET, width: 3, nose: 5, tailLength: 140, glow: 6 };

// The same packet in green: the answer on its way back.
export const GREEN_PACKET: CometStyle = { ...GREEN, width: 3, nose: 5, tailLength: 140, glow: 6 };

// Phase within one route cycle (0–1). The comet flies over TRAVEL, speeding
// up as it falls in, hits the destination at TRAVEL (where drawShockwave takes
// over), then its tail runs into the impact point over IMPACT.
export const TRAVEL = 0.4;
export const IMPACT = 0.07;
const EASE = 1.6;

type Sample = { x: number; y: number; dx: number; dy: number };

function lengths(points: number[]) {
  const cumulative = [0];
  for (let index = 2; index < points.length; index += 2) {
    cumulative.push(cumulative[cumulative.length - 1] + Math.hypot(points[index] - points[index - 2], points[index + 1] - points[index - 1]));
  }
  return cumulative;
}

// Point and unit tangent at arc length `s` along the polyline.
function sampleAt(points: number[], cumulative: number[], s: number): Sample {
  let segment = 1;
  while (segment < cumulative.length - 1 && cumulative[segment] < s) segment += 1;
  const start = cumulative[segment - 1];
  const length = cumulative[segment] - start || 1;
  const t = Math.min(1, Math.max(0, (s - start) / length));
  const ax = points[segment * 2 - 2], ay = points[segment * 2 - 1];
  const bx = points[segment * 2], by = points[segment * 2 + 1];
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / length, dy: (by - ay) / length };
}

// Closed outline of a streak from the nose tip, back along the route to the
// tail tip. `halfWidth(u)` gives the half-width at u (0 head → 1 tail).
function streak(
  context: CanvasRenderingContext2D,
  head: Sample,
  body: Sample[],
  nose: number,
  halfWidth: (u: number) => number,
) {
  const left: number[] = [];
  const right: number[] = [];
  // Nose: a short point ahead of the head, sharpening toward its tip.
  const noseSteps = 6;
  for (let step = noseSteps; step > 0; step -= 1) {
    const v = step / noseSteps;
    const w = halfWidth(0) * Math.pow(1 - v, 0.55);
    const x = head.x + head.dx * nose * v;
    const y = head.y + head.dy * nose * v;
    left.push(x - head.dy * w, y + head.dx * w);
    right.push(x + head.dy * w, y - head.dx * w);
  }
  body.forEach((point, index) => {
    const w = halfWidth(index / (body.length - 1));
    left.push(point.x - point.dy * w, point.y + point.dx * w);
    right.push(point.x + point.dy * w, point.y - point.dx * w);
  });
  context.beginPath();
  context.moveTo(left[0], left[1]);
  for (let index = 2; index < left.length; index += 2) context.lineTo(left[index], left[index + 1]);
  for (let index = right.length - 2; index >= 0; index -= 2) context.lineTo(right[index], right[index + 1]);
  context.closePath();
}

export function drawComet(
  context: CanvasRenderingContext2D,
  points: number[],
  phase: number,
  unitsPerPixel: number,
  alpha: number,
  style: CometStyle = COMET,
) {
  if (phase >= TRAVEL + IMPACT || alpha <= 0) return;
  const cumulative = lengths(points);
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return;
  const px = unitsPerPixel;
  const deviceScale = context.getTransform().a / px; // device pixels per CSS pixel

  const flying = phase < TRAVEL;
  const progress = Math.min(1, phase / TRAVEL);
  const headAt = Math.pow(progress, EASE) * total;
  // Tail stretches with speed (derivative of the ease), short when slow.
  const speed = Math.pow(progress, EASE - 1);
  let tail = Math.min(style.tailLength * px * (0.7 + 0.3 * speed), total * style.tailFraction, headAt);
  const impact = flying ? 0 : (phase - TRAVEL) / IMPACT;
  if (!flying) tail *= 1 - impact;
  const fade = alpha * (flying ? 1 : 1 - impact);

  if (tail > px) {
    const head = sampleAt(points, cumulative, headAt);
    const step = px; // ~1px sampling keeps the edges smooth
    const count = Math.max(8, Math.ceil(tail / step));
    const body: Sample[] = [];
    for (let index = 0; index <= count; index += 1) body.push(sampleAt(points, cumulative, headAt - (tail * index) / count));
    const tip = body[body.length - 1];
    const half = (style.width / 2) * px;
    const nose = (flying ? style.nose : style.nose * (1 - impact)) * px;
    const taper = (u: number) => half * Math.pow(1 - u, 1.6);

    // Brightness falls off roughly exponentially from head to tail.
    const bodyFill = context.createLinearGradient(head.x, head.y, tip.x, tip.y);
    bodyFill.addColorStop(0, `rgba(${style.accent}, 1)`);
    bodyFill.addColorStop(0.15, `rgba(${style.accent}, 0.85)`);
    bodyFill.addColorStop(0.4, `rgba(${style.accent}, 0.5)`);
    bodyFill.addColorStop(0.75, `rgba(${style.accent}, 0.22)`);
    bodyFill.addColorStop(1, `rgba(${style.accent}, 0)`);

    // 1–2. Body with a soft glow around it (shadow blur is in device pixels).
    context.save();
    context.globalAlpha = fade;
    context.shadowColor = `rgba(${style.accent}, 0.55)`;
    context.shadowBlur = style.glow * deviceScale;
    context.fillStyle = bodyFill;
    streak(context, head, body, nose, taper);
    context.fill();
    context.restore();

    // 3. Hot core along the front of the streak.
    const coreBody = body.slice(0, Math.max(3, Math.round(body.length * style.coreFraction)));
    const coreTip = coreBody[coreBody.length - 1];
    const coreHalf = (style.coreWidth / 2) * px;
    const coreFill = context.createLinearGradient(head.x, head.y, coreTip.x, coreTip.y);
    coreFill.addColorStop(0, "rgba(255, 252, 248, 1)");
    coreFill.addColorStop(0.35, `rgba(${style.hot}, 0.85)`);
    coreFill.addColorStop(1, `rgba(${style.hot}, 0)`);
    context.save();
    context.globalAlpha = fade;
    context.fillStyle = coreFill;
    streak(context, head, coreBody, nose * 0.7, (u) => coreHalf * Math.pow(1 - u, 1.5));
    context.fill();
    context.restore();
  }
}

// The shockwave where a comet lands, drawn flat on the sphere's surface so it
// reads as a wave spreading over the ground, not a ring stuck to the screen.
// Layers, all fading out together:
//   flash  – a white-hot point that swells and dies in the first instant
//   wave   – a sharp bright front racing out (ease-out-expo), dragging a soft
//            band of energy behind it, thinning as it spreads
//   echo   – a second, fainter front a beat later, at 60% of the size
//   sparks – short streaks thrown just ahead of the front, gone early
// Sizes are CSS pixels (converted with `unitsPerPixel`); `radius` is the
// wave's final size.
export const SHOCKWAVE = {
  duration: 0.13,    // share of the route cycle (0.13 × 14s ≈ 1.8s)
  flash: 0.08,       // flash lifetime, share of the shockwave
  echoDelay: 0.07,   // echo start, share of the shockwave
  echoScale: 0.6,
  band: 0.45,        // energy band depth behind the front, share of its radius
  frontWidth: [2.4, 0.6], // front line width at start / end, px
  sparks: 7,
  sparkReach: 1.3,   // how far sparks fly, share of the radius
  sparkLife: 0.3,    // share of the shockwave
  sparkLength: 10,   // px
};

type SurfaceFrame = { x: number; y: number; east: readonly [number, number]; north: readonly [number, number] };

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// Deterministic 0–1 noise, so each route's sparks land the same way every time.
const noise = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

function ring(
  context: CanvasRenderingContext2D,
  radius: number,
  lineWidth: number,
  alpha: number,
  style: CometStyle,
) {
  if (alpha <= 0.002 || radius <= 0) return;
  // Soft band trailing inside the front.
  const inner = radius * (1 - SHOCKWAVE.band);
  const band = context.createRadialGradient(0, 0, inner, 0, 0, radius);
  band.addColorStop(0, `rgba(${style.accent}, 0)`);
  band.addColorStop(0.7, `rgba(${style.accent}, ${0.1 * alpha})`);
  band.addColorStop(1, `rgba(${style.accent}, ${0.3 * alpha})`);
  context.fillStyle = band;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.arc(0, 0, inner, 0, Math.PI * 2, true);
  context.fill();
  // Halo around the front, then the front itself.
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.strokeStyle = `rgba(${style.accent}, ${0.18 * alpha})`;
  context.lineWidth = lineWidth * 3.2;
  context.stroke();
  context.strokeStyle = `rgba(${style.accent}, ${alpha})`;
  context.lineWidth = lineWidth;
  context.stroke();
  // Hot inner edge on the front while it is still fresh.
  context.strokeStyle = `rgba(255, 244, 232, ${0.7 * alpha * alpha})`;
  context.lineWidth = lineWidth * 0.4;
  context.stroke();
}

export function drawShockwave(
  context: CanvasRenderingContext2D,
  frame: SurfaceFrame,
  phase: number,
  seed: number,
  radius: number,
  unitsPerPixel: number,
  alpha: number,
  style: CometStyle = COMET,
) {
  const s = (phase - TRAVEL) / SHOCKWAVE.duration;
  if (s < 0 || s >= 1 || alpha <= 0) return;
  const px = unitsPerPixel;
  const size = radius * px;

  context.save();
  context.transform(frame.east[0], frame.east[1], frame.north[0], frame.north[1], frame.x, frame.y);
  context.globalAlpha = alpha;

  // Wave front.
  const [startWidth, endWidth] = SHOCKWAVE.frontWidth;
  const fall = Math.pow(1 - s, 2);
  ring(context, size * easeOutExpo(s), (startWidth + (endWidth - startWidth) * s) * px, fall, style);

  // Echo.
  const e = (s - SHOCKWAVE.echoDelay) / (1 - SHOCKWAVE.echoDelay);
  if (e > 0) {
    ring(context, size * SHOCKWAVE.echoScale * easeOutExpo(e), (1.1 - 0.6 * e) * px, 0.55 * Math.pow(1 - e, 2), style);
  }

  // Sparks.
  const k = s / SHOCKWAVE.sparkLife;
  if (k < 1) {
    context.lineCap = "round";
    for (let index = 0; index < SHOCKWAVE.sparks; index += 1) {
      const angle = ((index + noise(seed + index) * 0.6) / SHOCKWAVE.sparks) * Math.PI * 2;
      const reach = size * SHOCKWAVE.sparkReach * (0.85 + 0.15 * noise(seed * 7 + index)) * easeOutExpo(s);
      const length = SHOCKWAVE.sparkLength * px * (1 - k) * (0.6 + 0.4 * noise(seed * 3 + index));
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const from = Math.max(0, reach - length);
      const gradient = context.createLinearGradient(dx * from, dy * from, dx * reach, dy * reach);
      gradient.addColorStop(0, `rgba(${style.accent}, 0)`);
      gradient.addColorStop(1, `rgba(${style.accent}, ${Math.pow(1 - k, 1.5)})`);
      context.strokeStyle = gradient;
      context.lineWidth = 1.4 * px;
      context.beginPath();
      context.moveTo(dx * from, dy * from);
      context.lineTo(dx * reach, dy * reach);
      context.stroke();
    }
  }

  // Flash.
  const f = s / SHOCKWAVE.flash;
  if (f < 1) {
    const flashRadius = (3 + 10 * easeOutCubic(f)) * px;
    const flash = context.createRadialGradient(0, 0, 0, 0, 0, flashRadius);
    flash.addColorStop(0, `rgba(255, 252, 248, ${1 - f})`);
    flash.addColorStop(0.3, `rgba(${style.accent}, ${0.85 * (1 - f)})`);
    flash.addColorStop(1, `rgba(${style.accent}, 0)`);
    context.fillStyle = flash;
    context.beginPath();
    context.arc(0, 0, flashRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
