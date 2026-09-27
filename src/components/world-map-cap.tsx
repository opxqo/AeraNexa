"use client";

import { useEffect, useRef, useState } from "react";
import { WorldMapCapCityLayer } from "@/components/world-map-cap-city-layer";
import { CAP_DOTS_DESKTOP, CAP_DOTS_MOBILE, createCapDots, type CapLandData } from "@/lib/demo/cap-dots";
import { CAP_SEAM_LONGITUDE, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap.module.css";

// One full turn every 60 seconds, eastward.
const DEGREES_PER_SECOND = 360 / 60;
// Dot sampling is expensive; give the markers a light animation frame between
// canvas redraws so their movement stays smooth while the map rotates.
const MAP_REDRAW_INTERVAL = 1000 / 24;
// Matches the @container cap (max-width: 600px) switch in the CSS.
const MOBILE_WIDTH = 600;
const COLOR = "#2662FF";

// The spherical-cap dot map with its city tags and routes, shared by the home
// hero and /demo/world-map/cap. It turns slowly like a globe: a canvas redraws
// the dots every frame as the seam longitude moves, and the city layer follows.
// The pre-rendered SVG (seam −95°, the canvas's first frame) shows until the
// canvas takes over, and stays put when reduced motion is requested.
export function WorldMapCap({ className = "" }: { className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const updateCitiesRef = useRef<((seam: number, width: number, height: number) => void) | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const frameElement = frameRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!frameElement || !canvas || !context) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const controller = new AbortController();
    let disposed = false;
    let cleanup = () => {};

    fetch("/demo/world-cap-land.json", { signal: controller.signal })
      .then((response) => response.json() as Promise<CapLandData>)
      .then((data) => {
        if (disposed) return;
        const renderers = new Map<boolean, ReturnType<typeof createCapDots>>();
        const renderer = (mobile: boolean) => {
          let existing = renderers.get(mobile);
          if (!existing) {
            existing = createCapDots(data, mobile ? CAP_DOTS_MOBILE : CAP_DOTS_DESKTOP);
            renderers.set(mobile, existing);
          }
          return existing;
        };

        let width = 0;
        let height = 0;
        let mobile = false;
        const resize = () => {
          width = frameElement.clientWidth;
          height = frameElement.clientHeight;
          mobile = width <= MOBILE_WIDTH;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
        };
        resize();

        const draw = (seam: number) => {
          const params = mobile ? CAP_DOTS_MOBILE : CAP_DOTS_DESKTOP;
          const { land, coast } = renderer(mobile).frame(seam);
          const scale = canvas.width / CAP_VIEW_WIDTH;
          context.setTransform(scale, 0, 0, scale, 0, 0);
          context.clearRect(0, 0, CAP_VIEW_WIDTH, CAP_VIEW_HEIGHT);
          context.fillStyle = COLOR;
          for (const [points, radius, alpha] of [[land, params.landRadius, 0.72], [coast, params.coastRadius, 0.95]] as const) {
            context.globalAlpha = alpha;
            context.beginPath();
            for (let index = 0; index < points.length; index += 2) {
              context.moveTo(points[index] + radius, points[index + 1]);
              context.arc(points[index], points[index + 1], radius, 0, Math.PI * 2);
            }
            context.fill();
          }
        };

        let running = true;
        let frameId = 0;
        let last = 0;
        let lastMapDraw = 0;
        let seam = CAP_SEAM_LONGITUDE;
        const tick = (now: number) => {
          frameId = requestAnimationFrame(tick);
          if (!running || document.hidden) {
            last = 0;
            return;
          }
          if (last) seam = ((seam + ((now - last) / 1000) * DEGREES_PER_SECOND + 180) % 360) - 180;
          last = now;
          updateCitiesRef.current?.(seam, width, height);
          if (now - lastMapDraw >= MAP_REDRAW_INTERVAL) {
            draw(seam);
            lastMapDraw = performance.now();
          }
        };

        draw(seam);
        updateCitiesRef.current?.(seam, width, height);
        lastMapDraw = performance.now();
        setLive(true);
        frameId = requestAnimationFrame(tick);

        const resizeObserver = new ResizeObserver(() => {
          resize();
          draw(seam);
          updateCitiesRef.current?.(seam, width, height);
          lastMapDraw = performance.now();
        });
        resizeObserver.observe(frameElement);
        // Pause while the map is scrolled out of view.
        const intersectionObserver = new IntersectionObserver(([entry]) => {
          running = entry.isIntersecting;
        });
        intersectionObserver.observe(frameElement);

        cleanup = () => {
          cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          intersectionObserver.disconnect();
        };
      })
      .catch(() => {
        // Keep the static SVG if the data can't load.
      });

    return () => {
      disposed = true;
      controller.abort();
      cleanup();
    };
  }, []);

  return (
    <div ref={frameRef} className={`${styles.frame} ${className}`}>
      <svg
        className={`${styles.map} ${live ? styles.hidden : ""}`}
        viewBox={`0 0 ${CAP_VIEW_WIDTH} ${CAP_VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="球冠式半球世界陆地点阵，地图贴合倾斜球面，边缘向后弯曲"
      >
        <image className={styles.desktopDots} href="/demo/world-map-cap-desktop.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
        <image className={styles.mobileDots} href="/demo/world-map-cap-mobile.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
      </svg>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <WorldMapCapCityLayer updateRef={updateCitiesRef} />
    </div>
  );
}
