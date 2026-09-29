// Small easing helpers shared by the splash animations (each file used to keep its own copy).

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 below `from`, 1 above `to`, smooth in between. */
export function smoothstep(from: number, to: number, x: number) {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Overshoots, then settles: nodes popping into place. */
export function easeOutBack(t: number, overshoot = 1.70158) {
  const c = overshoot + 1;
  return 1 + c * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

/** Deterministic PRNG (mulberry32), so every scatter is the same on every load. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
