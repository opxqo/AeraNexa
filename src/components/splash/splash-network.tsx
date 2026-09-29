"use client";

import { useEffect, useRef } from "react";
import { COMET, GREEN_PACKET, PACKET, SHOCKWAVE, TRAVEL, drawComet, drawShockwave, type CometStyle } from "@/lib/demo/cap-comet";
import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seeded, smoothstep } from "@/lib/ease";
import { runCanvas } from "./canvas-loop";
import styles from "./splash-stage.module.css";
import type { StageProps } from "./stage-types";

// A relay network wakes up: nodes light, links draw between them, requests (orange) and
// answers (green) run back and forth, then the mesh pulls in on three nodes and traces the
// AeraNexa mark. The mark's geometry is brand-mark.tsx's (viewBox 64).

const INK = "38, 38, 38";
const ORANGE = "#f45300";
const PAPER = "#fcfcfd";
const CODES = ["HKG", "TYO", "SIN", "SFO", "LAX", "FRA", "AMS", "LON", "SEL", "SYD", "BOM", "DXB", "GRU", "JNB"];
const TAU = Math.PI * 2;

const LOGO_NODES = [
  { x: 32, y: 11 },
  { x: 8.5, y: 53.5 },
  { x: 55.5, y: 53.5 },
];
const LEGS = [8.5, 53.5, 32, 11, 55.5, 53.5];
const ARC: number[][] = [
  [8.5, 53.5, 18, 40, 25, 38.3, 32, 38.3],
  [32, 38.3, 39, 38.3, 46, 40, 55.5, 53.5],
];

type Point = { x: number; y: number };
type Sat = { home: Point; appear: number; radius: number; hub: number; code: string; order: number };
type Edge = { a: number; b: number; kind: "hub" | "mesh"; start: number; period: number; offset: number };
type Model = { key: string; L: number; u: number; cx: number; cy: number; logo: Point[]; sats: Sat[]; edges: Edge[] };

function cubic(a: number[], t: number): Point {
  const s = 1 - t;
  return {
    x: s * s * s * a[0] + 3 * s * s * t * a[2] + 3 * s * t * t * a[4] + t * t * t * a[6],
    y: s * s * s * a[1] + 3 * s * s * t * a[3] + 3 * s * t * t * a[5] + t * t * t * a[7],
  };
}

/** A link in the site's "fluid" style (flow-line.ts): both ends leave horizontally. Flat [x, y, …] from a to b. */
function curve(a: Point, b: Point, steps = 36) {
  const dir = b.x >= a.x ? 1 : -1;
  const gravity = Math.max(Math.abs(b.x - a.x) / 2, Math.hypot(b.x - a.x, b.y - a.y) * 0.32);
  const c = [a.x, a.y, a.x + dir * gravity, a.y, b.x - dir * gravity, b.y, b.x, b.y];
  const points: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const point = cubic(c, index / steps);
    points.push(point.x, point.y);
  }
  return points;
}

/** Stroke the first `fraction` of a polyline (by point index). */
function strokePartial(context: CanvasRenderingContext2D, points: number[], fraction: number) {
  const segments = points.length / 2 - 1;
  const reach = clamp01(fraction) * segments;
  if (reach <= 0) return;
  const whole = Math.floor(reach);
  context.beginPath();
  context.moveTo(points[0], points[1]);
  for (let index = 1; index <= Math.min(whole, segments); index += 1) context.lineTo(points[index * 2], points[index * 2 + 1]);
  if (whole < segments) {
    const rest = reach - whole;
    const from = whole * 2;
    context.lineTo(lerp(points[from], points[from + 2], rest), lerp(points[from + 1], points[from + 3], rest));
  }
  context.stroke();
}

function buildModel(width: number, height: number): Model {
  const L = Math.max(150, Math.min(320, Math.min(width, height) * 0.3));
  const u = L / 64;
  const cx = width / 2;
  const cy = height / 2 - height * 0.02;
  const logo = LOGO_NODES.map(({ x, y }) => ({ x: cx + (x - 32) * u, y: cy + (y - 32.3) * u }));

  const random = seeded(2024);
  const rings = [
    { count: 6, rx: L * 0.78 * 1.45, ry: L * 0.78, offset: 0.3 },
    { count: 8, rx: L * 2.08, ry: L * 1.25, offset: 0 },
  ];
  const homes: Point[] = [];
  for (const { count, rx, ry, offset } of rings) {
    for (let index = 0; index < count; index += 1) {
      const angle = offset + (index / count) * TAU + (random() - 0.5) * 0.35;
      const jitter = 1 + (random() - 0.5) * 0.14;
      const x = cx + Math.cos(angle) * Math.min(rx, width / 2 - 56) * jitter;
      const y = cy + Math.sin(angle) * ry * jitter;
      homes.push({ x: Math.max(48, Math.min(width - 48, x)), y: Math.max(64, Math.min(height - 120, y)) });
    }
  }

  const sats: Sat[] = homes.map((home, index) => {
    const order = (index * 5) % homes.length; // spread the wake-up order around the rings
    let hub = 0;
    logo.forEach((node, nodeIndex) => {
      if (Math.hypot(node.x - home.x, node.y - home.y) < Math.hypot(logo[hub].x - home.x, logo[hub].y - home.y)) hub = nodeIndex;
    });
    return { home, appear: 0.08 + 0.12 * (order / (homes.length - 1)), radius: 5 + random() * 3, hub, code: CODES[index % CODES.length], order };
  });

  const edges: Edge[] = [];
  sats.forEach((sat, index) => {
    edges.push({
      a: index,
      b: sat.hub,
      kind: "hub",
      start: Math.max(0.1 + 0.28 * (sat.order / (sats.length - 1)), sat.appear + 0.02),
      period: 2.4 + (index % 5) * 0.35,
      offset: index * 0.37,
    });
    // A faint mesh link to the nearest node that woke earlier.
    let nearest = -1;
    let best = L * 2.2;
    sats.forEach((other, otherIndex) => {
      if (otherIndex === index || other.order >= sat.order) return;
      const distance = Math.hypot(other.home.x - sat.home.x, other.home.y - sat.home.y);
      if (distance < best) {
        best = distance;
        nearest = otherIndex;
      }
    });
    if (nearest >= 0) {
      edges.push({ a: index, b: nearest, kind: "mesh", start: Math.max(sat.appear, sats[nearest].appear) + 0.03 + 0.16 * (sat.order / (sats.length - 1)), period: 1, offset: 0 });
    }
  });

  return { key: `${Math.round(width)}|${Math.round(height)}`, L, u, cx, cy, logo, sats, edges };
}

export function NetworkStage({ progressRef, reduced }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let model: Model | null = null;
    let finaleAt = 0;

    return runCanvas(
      canvas,
      (context, { width, height, now }) => {
        const p = reduced ? 1 : clamp01(progressRef.current);
        if (!model || model.key !== `${Math.round(width)}|${Math.round(height)}`) model = buildModel(width, height);
        const { u, cx, cy, logo, sats, edges } = model;

        if (p >= 0.88) {
          if (!finaleAt) finaleAt = now;
        } else if (p < 0.84) finaleAt = 0;

        const collapse = easeInOutCubic(clamp01((p - 0.64) / 0.22));
        const fade = 1 - smoothstep(0.74, 0.88, p);
        const packets = smoothstep(0.22, 0.3, p) * (1 - smoothstep(0.58, 0.66, p));
        const node = (index: number): Point => {
          const { home, hub } = sats[index];
          return { x: lerp(home.x, logo[hub].x, collapse), y: lerp(home.y, logo[hub].y, collapse) };
        };
        const shown = (a: number) => easeOutBack(clamp01((p - sats[a].appear) / 0.06));

        context.lineCap = "round";
        context.lineJoin = "round";

        // Links, faint mesh first.
        if (fade > 0.002) {
          for (const kind of ["mesh", "hub"] as const) {
            context.lineWidth = 1.5;
            context.strokeStyle = `rgba(${INK}, ${(kind === "hub" ? 0.22 : 0.12) * fade})`;
            for (const edge of edges) {
              if (edge.kind !== kind) continue;
              const drawn = easeOutCubic(clamp01((p - edge.start) / 0.1));
              if (drawn <= 0) continue;
              const to = kind === "hub" ? logo[edge.b] : node(edge.b);
              strokePartial(context, curve(node(edge.a), to), drawn);
            }
          }
        }

        // Requests out (orange), answers home (green), each link on its own beat.
        if (packets > 0.002 && !reduced) {
          for (const edge of edges) {
            if (edge.kind !== "hub" || p < edge.start + 0.1) continue;
            const cycle = (now / 1000 + edge.offset) / edge.period;
            const index = Math.floor(cycle);
            const phase = cycle - index;
            const outbound = index % 2 === 0;
            const forward = curve(node(edge.a), logo[edge.b]);
            let route = forward;
            if (!outbound) {
              route = [];
              for (let k = forward.length - 2; k >= 0; k -= 2) route.push(forward[k], forward[k + 1]);
            }
            const style: CometStyle = outbound ? PACKET : GREEN_PACKET;
            drawComet(context, route, phase, 1, packets, style);
            const target = outbound ? logo[edge.b] : node(edge.a);
            drawShockwave(context, { x: target.x, y: target.y, east: [1, 0], north: [0, 1] }, phase, edge.a + (outbound ? 0 : 31), 26, 1, packets, style);
          }
        }

        // Satellite nodes, hollow rings with a code.
        if (fade > 0.002) {
          context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
          context.textBaseline = "middle";
          sats.forEach((sat, index) => {
            const scale = shown(index);
            if (scale <= 0) return;
            const at = node(index);
            const r = sat.radius * scale;
            // A ring of light where it wakes.
            const wake = clamp01((p - sat.appear) / 0.09);
            if (wake < 1) {
              context.beginPath();
              context.arc(at.x, at.y, sat.radius * (1 + 2.6 * easeOutCubic(wake)), 0, TAU);
              context.strokeStyle = `rgba(244, 83, 0, ${0.35 * (1 - wake) * fade})`;
              context.lineWidth = 1.2;
              context.stroke();
            }
            context.beginPath();
            context.arc(at.x, at.y, Math.max(0, r), 0, TAU);
            context.fillStyle = PAPER;
            context.globalAlpha = fade;
            context.fill();
            context.strokeStyle = `rgba(${INK}, 0.85)`;
            context.lineWidth = 1.5;
            context.stroke();
            context.globalAlpha = 1;
            context.fillStyle = `rgba(${INK}, ${0.5 * fade * clamp01(scale)})`;
            const left = sat.home.x < cx;
            context.textAlign = left ? "right" : "left";
            context.fillText(sat.code, at.x + (left ? -1 : 1) * (sat.radius + 9), at.y + 0.5);
          });
        }

        // The mark: legs, then the signal arc, then the three nodes fill in orange.
        const legs = easeInOutCubic(clamp01((p - 0.7) / 0.16));
        const arc = easeInOutCubic(clamp01((p - 0.78) / 0.12));
        context.strokeStyle = `rgb(${INK})`;
        context.lineWidth = 5 * u;
        const at = (x: number, y: number): [number, number] => [cx + (x - 32) * u, cy + (y - 32.3) * u];
        const legPoints: number[] = [];
        for (let index = 0; index < LEGS.length; index += 2) legPoints.push(...at(LEGS[index], LEGS[index + 1]));
        strokePartial(context, legPoints, legs);
        const arcPoints: number[] = [];
        ARC.forEach((c, part) => {
          for (let step = part ? 1 : 0; step <= 30; step += 1) {
            const point = cubic(c, step / 30);
            const [x, y] = at(point.x, point.y);
            arcPoints.push(x, y);
          }
        });
        strokePartial(context, arcPoints, arc);

        const grow = easeInOutCubic(clamp01((p - 0.66) / 0.2));
        const fill = smoothstep(0.88, 0.94, p);
        logo.forEach((point, index) => {
          const appear = easeOutBack(clamp01((p - (0.02 + index * 0.03)) / 0.06));
          const r = Math.max(0, lerp(9, 6 * u, grow) * appear);
          context.beginPath();
          context.arc(point.x, point.y, r, 0, TAU);
          context.fillStyle = PAPER;
          context.fill();
          context.globalAlpha = fill;
          context.fillStyle = ORANGE;
          context.fill();
          context.globalAlpha = 1 - fill;
          context.strokeStyle = `rgba(${INK}, 0.9)`;
          context.lineWidth = 1.5;
          context.stroke();
          context.globalAlpha = 1;
        });

        // A last ring of light out of the mark.
        const finale = finaleAt ? (now - finaleAt) / 1100 : -1;
        if (!reduced && finale > 0 && finale < 1) {
          drawShockwave(context, { x: cx, y: cy, east: [1, 0], north: [0, 1] }, TRAVEL + finale * SHOCKWAVE.duration, 5, model.L * 1.2, 1, 1, COMET);
        }
      },
      { animate: !reduced },
    );
  }, [progressRef, reduced]);

  return <canvas ref={canvasRef} className={styles.canvas} data-stage="network" aria-hidden="true" />;
}
