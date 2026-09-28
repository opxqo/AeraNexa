"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { WorldMapCapCityLayer } from "@/components/world-map-cap-city-layer";
import { CAP_DOTS_DESKTOP, CAP_DOTS_MOBILE, createCapDots, type CapLandData } from "@/lib/demo/cap-dots";
import { CAP_SEAM_LONGITUDE, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capSilhouette, getCapCurl, setCapCurl } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap.module.css";

// One full turn every 60 seconds, eastward.
const DEGREES_PER_SECOND = 360 / 60;
// Matches the @container cap (max-width: 600px) switch in the CSS.
const MOBILE_WIDTH = 600;
const COLOR = "#2662FF";
// China in the accent orange (keep in step with --accent in the city layer CSS).
const CHINA_COLOR = "#f45300";

// The spherical-cap dot map with its city tags and routes, shared by the home
// hero and /demo/world-map/cap. It turns slowly like a globe: a canvas redraws
// the dots every frame as the seam longitude moves, and the city layer follows.
// The pre-rendered SVG (seam −95°, the canvas's first frame) shows until the
// canvas takes over, and stays put when reduced motion is requested.
const DEFAULT_LABEL = "球冠式半球世界陆地点阵，地图贴合倾斜球面，边缘向后弯曲";

// `curlRef` (optional, the /demo/world-map/cap scroll effect) holds how far
// the cap has curled into a globe, 0–1; it is read every frame, so scrolling
// never re-renders React. Without it the map stays a cap.
export function WorldMapCap({ className = "", label = DEFAULT_LABEL, curlRef }: { className?: string; label?: string; curlRef?: RefObject<number> }) {
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
            existing = createCapDots(mobile ? data.mobile : data.desktop);
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
          const { land, coast, chinaLand, chinaCoast, border } = renderer(mobile).frame(seam);
          const scale = canvas.width / CAP_VIEW_WIDTH;
          context.setTransform(scale, 0, 0, scale, 0, 0);
          context.clearRect(0, 0, CAP_VIEW_WIDTH, CAP_VIEW_HEIGHT);
          // Once the map curls, a faint disc and outline show the sphere's
          // shape, fading in with the curl.
          const curl = getCapCurl();
          if (curl > 0) {
            const { x, y, radius } = capSilhouette();
            context.globalAlpha = curl;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fillStyle = "rgba(38, 98, 255, 0.035)";
            context.fill();
            context.strokeStyle = "rgba(38, 98, 255, 0.28)";
            context.lineWidth = 1.2;
            context.stroke();
          }
          const layers = [
            [COLOR, land, params.landRadius, 0.72],
            [COLOR, coast, params.coastRadius, 0.95],
            [CHINA_COLOR, chinaLand, params.landRadius, 0.72],
            [CHINA_COLOR, chinaCoast.concat(border), params.coastRadius, 0.95],
          ] as const;
          for (const [color, points, radius, alpha] of layers) {
            context.fillStyle = color;
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
        let seam = CAP_SEAM_LONGITUDE;
        const tick = (now: number) => {
          frameId = requestAnimationFrame(tick);
          if (!running || document.hidden) {
            last = 0;
            return;
          }
          if (last) seam = ((seam + ((now - last) / 1000) * DEGREES_PER_SECOND + 180) % 360) - 180;
          last = now;
          const curl = curlRef?.current ?? 0;
          if (curl !== getCapCurl()) setCapCurl(curl);
          // The dots are fixed to the globe and move with it, so the map is
          // redrawn every frame, in step with the markers and routes.
          updateCitiesRef.current?.(seam, width, height);
          draw(seam);
        };

        draw(seam);
        updateCitiesRef.current?.(seam, width, height);
        setLive(true);
        frameId = requestAnimationFrame(tick);

        const resizeObserver = new ResizeObserver(() => {
          resize();
          draw(seam);
          updateCitiesRef.current?.(seam, width, height);
        });
        resizeObserver.observe(frameElement);
        // Pause while the map is scrolled out of view.
        const intersectionObserver = new IntersectionObserver(([entry]) => {
          running = entry.isIntersecting;
        });
        intersectionObserver.observe(frameElement);

        cleanup = () => {
          cancelAnimationFrame(frameId);
          setCapCurl(0);
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
  }, [curlRef]);

  return (
    <div ref={frameRef} className={`${styles.frame} ${className}`}>
      <svg
        className={`${styles.map} ${live ? styles.hidden : ""}`}
        viewBox={`0 0 ${CAP_VIEW_WIDTH} ${CAP_VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
      >
        <image className={styles.desktopDots} href="/demo/world-map-cap-desktop.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
        <image className={styles.mobileDots} href="/demo/world-map-cap-mobile.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
      </svg>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <WorldMapCapCityLayer updateRef={updateCitiesRef} />
    </div>
  );
}
