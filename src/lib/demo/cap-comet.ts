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
  tailLength: 240,
  tailFraction: 0.45,
  coreFraction: 0.3,
  coreWidth: 1.5,
  glow: 9,
};

// Phase within one route cycle (0–1). The comet flies over TRAVEL, speeding
// up as it falls in, hits the destination at TRAVEL (when its ripple fires),
// then its tail runs into the impact point over IMPACT while a flash fades.
const TRAVEL = 0.4;
const IMPACT = 0.07;
const FLASH = 0.02;
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
  let tail = Math.min(style.tailLength * px * (0.3 + 0.7 * speed), total * style.tailFraction, headAt);
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
    const taper = (u: number) => half * Math.pow(1 - u, 2);

    // Brightness falls off roughly exponentially from head to tail.
    const bodyFill = context.createLinearGradient(head.x, head.y, tip.x, tip.y);
    bodyFill.addColorStop(0, `rgba(${style.accent}, 1)`);
    bodyFill.addColorStop(0.12, `rgba(${style.accent}, 0.82)`);
    bodyFill.addColorStop(0.3, `rgba(${style.accent}, 0.45)`);
    bodyFill.addColorStop(0.6, `rgba(${style.accent}, 0.14)`);
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

  // Impact flash at the destination, just as the ripple starts.
  if (!flying && phase < TRAVEL + FLASH) {
    const t = (phase - TRAVEL) / FLASH;
    const end = sampleAt(points, cumulative, total);
    const radius = (4 + 12 * t) * px;
    const flash = context.createRadialGradient(end.x, end.y, 0, end.x, end.y, radius);
    flash.addColorStop(0, `rgba(255, 252, 248, ${0.95 * (1 - t)})`);
    flash.addColorStop(0.35, `rgba(${style.hot}, ${0.6 * (1 - t)})`);
    flash.addColorStop(1, `rgba(${style.accent}, 0)`);
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = flash;
    context.beginPath();
    context.arc(end.x, end.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}
