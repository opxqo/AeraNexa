"use client";

import { useEffect, useRef, type RefObject } from "react";
import { COMET, SHOCKWAVE, TRAVEL, drawShockwave } from "@/lib/demo/cap-comet";
import { CAP_DOTS_DESKTOP, CAP_DOTS_MOBILE, createCapDots, type CapLandData } from "@/lib/demo/cap-dots";
import { CAP_SEAM_LONGITUDE, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capSurfaceFrame, projectCapCity, setCapCurl } from "@/lib/demo/cap-projection";
import { clamp01, seeded, smoothstep } from "@/lib/ease";
import { getCapLand } from "@/lib/splash-data";
import { runCanvas } from "./canvas-loop";
import styles from "./splash-stage.module.css";
import type { StageProps } from "./stage-types";

// Black dots drift in from all over the screen and settle into the hero's world map; the
// far side of the world lands first, China last, and then lights up orange from its centre.
// At progress 1 every dot sits exactly where the hero's first frame has it (same projection,
// radii, alphas and edge fade), so the hand-off to the real map is a plain cross-fade.

// From world-map-cap.tsx (COLOR / CHINA_COLOR and the layer alphas in draw()); kept in step by hand.
const INK: [number, number, number] = [38, 38, 38];
const ORANGE: [number, number, number] = [244, 83, 0];
const LAND_ALPHA = 0.72;
const COAST_ALPHA = 0.95;
const MOBILE_WIDTH = 600;
const HUB = { longitude: 106, latitude: 33.5 }; // the China hub, as in cap-cities.ts

const SPAN = 0.34; // share of the progress one dot takes to land
const LATEST_START = 0.4; // the last dot (China) starts here
const BOW = 0.22; // how far a dot's path curves sideways
const DRIFT = 7; // view units of idle wobble for dots still in flight
const ORANGE_FROM = 0.74; // China starts turning orange
const ORANGE_SPREAD = 0.12; // ...and the change spreads outward over this much
const ORANGE_TIME = 0.1; // each dot's own fade
const SHOCK_FROM = 0.77;
const SHOCK_MS = 1200;

const MASK_BUCKETS = 10;
const COLOR_STEPS = 8;
const TAU = Math.PI * 2;

const rgb = (color: readonly number[]) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
const STEP_COLORS = Array.from({ length: COLOR_STEPS }, (_, step) => {
  const t = step / (COLOR_STEPS - 1);
  return rgb(INK.map((value, index) => Math.round(value + (ORANGE[index] - value) * t)));
});

/** The hero's soft edges (home-relay.module.css .mapLayer at rest): 16% at the sides, 20% top, 22% bottom. */
function heroMask(x: number, y: number) {
  const side = Math.min(x / (0.16 * CAP_VIEW_WIDTH), (CAP_VIEW_WIDTH - x) / (0.16 * CAP_VIEW_WIDTH));
  const top = y / (0.2 * CAP_VIEW_HEIGHT);
  const bottom = (CAP_VIEW_HEIGHT - y) / (0.22 * CAP_VIEW_HEIGHT);
  return clamp01(side) * clamp01(Math.min(top, bottom));
}

type Layer = {
  count: number;
  china: boolean;
  radius: number;
  alpha: number;
  hx: Float32Array;
  hy: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  delay: Float32Array;
  bow: Float32Array;
  phase: Float32Array;
  ripple: Float32Array;
  x: Float32Array; // this frame's position and radius
  y: Float32Array;
  r: Float32Array;
  buckets: Uint32Array[]; // plain layers: dots grouped by how much of the edge fade they sit in
  step: Uint8Array; // China: this frame's colour step per dot
};

type Model = { key: string; layers: Layer[]; scale: number; left: number; top: number; hub: ReturnType<typeof capSurfaceFrame>; shockRadius: number };

type Box = { left: number; top: number; width: number };

function buildModel(data: CapLandData, box: Box, viewport: { width: number; height: number }): Model {
  const mobile = box.width <= MOBILE_WIDTH;
  const params = mobile ? CAP_DOTS_MOBILE : CAP_DOTS_DESKTOP;
  const scale = box.width / CAP_VIEW_WIDTH;
  setCapCurl(0);
  const frame = createCapDots(mobile ? data.mobile : data.desktop).frame(CAP_SEAM_LONGITUDE);
  const hub = projectCapCity(HUB.longitude, HUB.latitude, CAP_SEAM_LONGITUDE);

  const specs = [
    { points: frame.land, china: false, radius: params.landRadius, alpha: LAND_ALPHA },
    { points: frame.coast, china: false, radius: params.coastRadius, alpha: COAST_ALPHA },
    { points: frame.chinaLand, china: true, radius: params.landRadius, alpha: LAND_ALPHA },
    { points: [...frame.chinaCoast, ...frame.border], china: true, radius: params.coastRadius, alpha: COAST_ALPHA },
  ];

  let farthest = 1;
  let farthestChina = 1;
  for (const { points, china } of specs) {
    for (let index = 0; index < points.length; index += 2) {
      const distance = Math.hypot(points[index] - hub.x, points[index + 1] - hub.y);
      farthest = Math.max(farthest, distance);
      if (china) farthestChina = Math.max(farthestChina, distance);
    }
  }

  // The scatter is a dust cloud over the whole screen, centred on the map.
  const centreX = box.left + box.width / 2;
  const centreY = box.top + (box.width * CAP_VIEW_HEIGHT) / CAP_VIEW_WIDTH / 2;
  const reach = 0.5 * Math.hypot(viewport.width, viewport.height) * 0.9;

  const layers = specs.map(({ points, china, radius, alpha }, layerIndex): Layer => {
    const count = points.length / 2;
    const random = seeded(1337 + layerIndex * 101);
    const layer: Layer = {
      count,
      china,
      radius,
      alpha,
      hx: new Float32Array(count),
      hy: new Float32Array(count),
      sx: new Float32Array(count),
      sy: new Float32Array(count),
      delay: new Float32Array(count),
      bow: new Float32Array(count),
      phase: new Float32Array(count),
      ripple: new Float32Array(count),
      x: new Float32Array(count),
      y: new Float32Array(count),
      r: new Float32Array(count),
      buckets: [],
      step: new Uint8Array(count),
    };
    const lists: number[][] = Array.from({ length: MASK_BUCKETS }, () => []);
    for (let index = 0; index < count; index += 1) {
      const x = points[index * 2];
      const y = points[index * 2 + 1];
      const distance = Math.hypot(x - hub.x, y - hub.y);
      const angle = random() * TAU;
      const spread = reach * Math.sqrt(random());
      layer.hx[index] = x;
      layer.hy[index] = y;
      layer.sx[index] = (centreX + Math.cos(angle) * spread - box.left) / scale;
      layer.sy[index] = (centreY + Math.sin(angle) * spread - box.top) / scale;
      // Far from China first, China last; a little jitter so it isn't a clean sweep.
      layer.delay[index] = LATEST_START * (1 - distance / farthest) + random() * 0.06;
      layer.bow[index] = random() < 0.5 ? -1 : 1;
      layer.phase[index] = random() * TAU;
      layer.ripple[index] = distance / farthestChina;
      if (!china) lists[Math.round(heroMask(x, y) * (MASK_BUCKETS - 1))].push(index);
    }
    layer.buckets = lists.map((list) => Uint32Array.from(list));
    return layer;
  });

  return {
    key: "",
    layers,
    scale,
    left: box.left,
    top: box.top,
    hub: capSurfaceFrame(HUB.longitude, HUB.latitude, CAP_SEAM_LONGITUDE),
    shockRadius: Math.min(360, box.width * 0.2),
  };
}

export function MapStage({ progressRef, reduced, targetRef }: StageProps & { targetRef?: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let stop = () => {};

    getCapLand()
      .then((data) => {
        if (disposed) return;
        let model: Model | null = null;
        let shockAt = 0;

        stop = runCanvas(
          canvas,
          (context, { width, height, now }) => {
            const p = reduced ? 1 : clamp01(progressRef.current);
            setCapCurl(0);

            // Where the hero's map sits: the target element, or centred at the hero's width.
            const target = targetRef?.current?.getBoundingClientRect();
            const boxWidth = target?.width ?? Math.min(width, 1600);
            const box: Box = {
              left: target?.left ?? (width - boxWidth) / 2,
              top: target?.top ?? (height - (boxWidth * CAP_VIEW_HEIGHT) / CAP_VIEW_WIDTH) / 2,
              width: boxWidth,
            };
            const key = `${Math.round(box.left)}|${Math.round(box.top)}|${Math.round(box.width)}|${Math.round(width)}|${Math.round(height)}`;
            if (!model || model.key !== key) {
              model = buildModel(data, box, { width, height });
              model.key = key;
            }
            const { layers, scale } = model;

            context.save();
            context.translate(model.left, model.top);
            context.scale(scale, scale);

            const q = smoothstep(0.55, 1, p); // the edge fade closes in as the map completes
            const arrival = 0.35 + 0.65 * smoothstep(0, 0.25, p);
            const wobble = now * 0.0007;
            const cullX0 = -model.left / scale - 20;
            const cullX1 = (width - model.left) / scale + 20;
            const cullY0 = -model.top / scale - 20;
            const cullY1 = (height - model.top) / scale + 20;

            for (const layer of layers) {
              const { count, hx, hy, sx, sy, delay, bow, phase, x, y, r, radius } = layer;
              for (let i = 0; i < count; i += 1) {
                const u = 1 - clamp01((p - delay[i]) / SPAN);
                const e = 1 - u * u * u * u;
                const dx = hx[i] - sx[i];
                const dy = hy[i] - sy[i];
                const swing = bow[i] * BOW * Math.sin(Math.PI * e);
                const drift = (1 - e) * DRIFT;
                const w = wobble + phase[i];
                x[i] = sx[i] + dx * e - dy * swing + Math.sin(w * 1.3) * drift;
                y[i] = sy[i] + dy * e + dx * swing + Math.cos(w) * drift;
                r[i] = radius * (0.4 + 0.6 * e);
              }

              if (!layer.china) {
                context.fillStyle = STEP_COLORS[0];
                layer.buckets.forEach((list, bucket) => {
                  const alpha = layer.alpha * arrival * (1 - q + (q * bucket) / (MASK_BUCKETS - 1));
                  if (list.length === 0 || alpha < 0.004) return;
                  context.globalAlpha = alpha;
                  context.beginPath();
                  for (let k = 0; k < list.length; k += 1) {
                    const i = list[k];
                    if (x[i] < cullX0 || x[i] > cullX1 || y[i] < cullY0 || y[i] > cullY1) continue;
                    context.moveTo(x[i] + r[i], y[i]);
                    context.arc(x[i], y[i], r[i], 0, TAU);
                  }
                  context.fill();
                });
                continue;
              }

              // China: the orange spreads outward from the hub, each dot fading over ORANGE_TIME.
              const { ripple, step } = layer;
              for (let i = 0; i < count; i += 1) {
                const from = ORANGE_FROM + ripple[i] * ORANGE_SPREAD;
                step[i] = Math.round(smoothstep(from, from + ORANGE_TIME, p) * (COLOR_STEPS - 1));
              }
              context.globalAlpha = layer.alpha * arrival;
              for (let s = 0; s < COLOR_STEPS; s += 1) {
                context.fillStyle = STEP_COLORS[s];
                context.beginPath();
                let any = false;
                for (let i = 0; i < count; i += 1) {
                  if (step[i] !== s) continue;
                  any = true;
                  context.moveTo(x[i] + r[i], y[i]);
                  context.arc(x[i], y[i], r[i], 0, TAU);
                }
                if (any) context.fill();
              }
            }

            // One ring of light out of the hub as the orange takes.
            // (Timed from the moment the orange starts, not from the progress, so it plays out in full.)
            if (p >= SHOCK_FROM) {
              if (!shockAt) shockAt = now;
            } else if (p < SHOCK_FROM - 0.04) shockAt = 0;
            const shock = shockAt ? (now - shockAt) / SHOCK_MS : -1;
            if (!reduced && shock > 0 && shock < 1) {
              drawShockwave(context, model.hub, TRAVEL + shock * SHOCKWAVE.duration, 7, model.shockRadius, 1 / scale, 1, COMET);
            }
            context.restore();
            context.globalAlpha = 1;
          },
          { animate: !reduced },
        );
      })
      .catch(() => {});

    return () => {
      disposed = true;
      stop();
    };
  }, [progressRef, reduced, targetRef]);

  return <canvas ref={canvasRef} className={styles.canvas} data-stage="map" aria-hidden="true" />;
}
