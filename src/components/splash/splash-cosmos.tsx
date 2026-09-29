"use client";

import { useEffect, useRef } from "react";
import { clamp01, easeInOutCubic, lerp, smoothstep } from "@/lib/ease";
import { SCENE_H, SCENE_W, earthMoonScene, galaxyScene, solarSystemScene, starField, type Scene } from "@/lib/pixel-cosmos";
import { runCanvas } from "./canvas-loop";
import styles from "./splash-stage.module.css";
import type { StageProps } from "./stage-types";

// The camera pulls back from Earth and the Moon, through the Solar System, out to the Milky Way.
// Each scene is a small pixel bitmap; all three live in one world (units of the Solar System
// scene's pixels) and the camera has a focus and a zoom Z (screen cells per world unit).
// Neighbouring scenes are the same objects at different scales: Earth is 38 px across in its own
// scene and 3.8 in the Solar System's, so 10 world units of zoom later the two line up.

const EARTH_TO_SOLAR = 0.1; // world units per Earth-scene pixel
const GALAXY_TO_SOLAR = 14; // world units per Milky Way pixel
const Z_START = 1 / EARTH_TO_SOLAR; // Earth scene at native size
const Z_END = 1 / GALAXY_TO_SOLAR; // Milky Way at native size

const CAPTIONS = [
  { name: "Earth · Moon", scale: "384,400 km" },
  { name: "Solar System", scale: "1 AU" },
  { name: "Milky Way", scale: "100,000 ly" },
];

type Built = { canvases: HTMLCanvasElement[]; scenes: Scene[] };

function toCanvas(scene: Scene) {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const context = canvas.getContext("2d")!;
  context.putImageData(new ImageData(new Uint8ClampedArray(scene.pixels.buffer.slice(0) as ArrayBuffer), SCENE_W, SCENE_H), 0, 0);
  return canvas;
}

function build(): Built {
  const scenes = [earthMoonScene(), solarSystemScene(), galaxyScene()];
  return { scenes, canvases: scenes.map(toCanvas) };
}

/** Camera position for progress p: hold, zoom out to the Solar System, hold, zoom out to the galaxy. */
function cameraLeg(p: number) {
  const leg = (from: number, to: number) => easeInOutCubic(clamp01((p - from) / (to - from)));
  return leg(0.1, 0.46) + leg(0.54, 0.9); // 0 → 1 → 2
}

export function CosmosStage({ progressRef, reduced }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { scenes, canvases } = build();
    const stars = starField(150);
    const [earthScene, solarScene, galaxyScene] = scenes;
    const earth1 = earthScene.anchors.earth;
    const earth2 = solarScene.anchors.earth;
    const sun2 = solarScene.anchors.sun;
    const here3 = galaxyScene.anchors.here;
    const core3 = galaxyScene.anchors.core;
    // Where the camera looks at each stop, in world units.
    const focus0 = earth2;
    const focus1 = sun2;
    const focus2 = { x: sun2.x + (core3.x - here3.x) * GALAXY_TO_SOLAR, y: sun2.y + (core3.y - here3.y) * GALAXY_TO_SOLAR };
    let caption = -1;

    return runCanvas(
      canvas,
      (context, { width, height, now }) => {
        const p = reduced ? 1 : clamp01(progressRef.current);
        const leg = cameraLeg(p);

        // Zoom is exponential; the focus moves so the target keeps its place on screen (van Wijk).
        let zoom: number;
        let fx: number;
        let fy: number;
        if (leg <= 1) {
          zoom = Math.exp(lerp(Math.log(Z_START), 0, leg));
          const g = (1 / zoom - 1 / Z_START) / (1 - 1 / Z_START);
          fx = lerp(focus0.x, focus1.x, g);
          fy = lerp(focus0.y, focus1.y, g);
        } else {
          zoom = Math.exp(lerp(0, Math.log(Z_END), leg - 1));
          const g = (1 / zoom - 1) / (GALAXY_TO_SOLAR - 1);
          fx = lerp(focus1.x, focus2.x, g);
          fy = lerp(focus1.y, focus2.y, g);
        }
        const cx = width / 2;
        const cy = height / 2 - height * 0.03;
        const lz = Math.log(zoom);

        // Stars first, drifting in a little as the camera pulls back.
        const pull = 1 - 0.16 * (leg / 2);
        for (const star of stars) {
          const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.001 * star.speed + star.phase));
          context.globalAlpha = reduced ? 0.8 : twinkle;
          context.fillStyle = star.color;
          context.fillRect(Math.floor(cx + (star.x * width - cx) * pull), Math.floor(cy + (star.y * height - cy) * pull), 1, 1);
        }

        // Crossfades between neighbours sum to one, so the picture never dips dark.
        const a1 = smoothstep(Math.log(2.6), Math.log(6.5), lz);
        const b2 = smoothstep(Math.log(0.28), Math.log(0.62), lz);
        const layers = [
          { canvas: canvases[0], alpha: a1, scale: EARTH_TO_SOLAR * zoom, x: cx + (earth2.x - fx) * zoom - earth1.x * EARTH_TO_SOLAR * zoom, y: cy + (earth2.y - fy) * zoom - earth1.y * EARTH_TO_SOLAR * zoom },
          { canvas: canvases[1], alpha: (1 - a1) * b2, scale: zoom, x: cx - fx * zoom, y: cy - fy * zoom },
          { canvas: canvases[2], alpha: 1 - b2, scale: GALAXY_TO_SOLAR * zoom, x: cx + (sun2.x - fx) * zoom - here3.x * GALAXY_TO_SOLAR * zoom, y: cy + (sun2.y - fy) * zoom - here3.y * GALAXY_TO_SOLAR * zoom },
        ];
        context.imageSmoothingEnabled = false;
        for (const layer of layers) {
          if (layer.alpha < 0.01) continue;
          context.globalAlpha = layer.alpha;
          context.setTransform(layer.scale, 0, 0, layer.scale, Math.round(layer.x), Math.round(layer.y));
          context.drawImage(layer.canvas, 0, 0);
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;

        const now3 = zoom > 3.2 ? 0 : zoom > 0.5 ? 1 : 2;
        if (now3 !== caption) {
          caption = now3;
          if (nameRef.current) nameRef.current.textContent = CAPTIONS[now3].name;
          if (scaleRef.current) scaleRef.current.textContent = CAPTIONS[now3].scale;
        }
      },
      {
        animate: !reduced,
        grid: (cssWidth, cssHeight) => {
          const cell = Math.max(2, Math.min(8, Math.floor(cssWidth / 200)));
          return { cols: Math.ceil(cssWidth / cell), rows: Math.ceil(cssHeight / cell) };
        },
      },
    );
  }, [progressRef, reduced]);

  return (
    <>
      <canvas ref={canvasRef} className={`${styles.canvas} ${styles.pixelated}`} data-stage="cosmos" aria-hidden="true" />
      <div className={styles.ruler} aria-hidden="true">
        <span ref={nameRef} className={styles.rulerName}>Earth · Moon</span>
        <span className={styles.rulerBar} />
        <span ref={scaleRef} className={styles.rulerScale}>384,400 km</span>
      </div>
    </>
  );
}
