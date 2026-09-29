"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { WorldMapCapCityLayer, type CapTrip } from "@/components/world-map-cap-city-layer";
import { CAP_DOTS_DESKTOP, CAP_DOTS_MOBILE, createCapDots, type CapLandData } from "@/lib/demo/cap-dots";
import { CAP_SEAM_LONGITUDE, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capFacing, capSilhouette, getCapCurl, setCapCurl, sphereAngles, toView } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap.module.css";

// One full turn every 60 seconds, eastward.
const DEGREES_PER_SECOND = 360 / 60;
// When steered (`steerRef`), the globe turns toward its target with an
// exponential ease of this time constant (seconds), at most this fast.
const STEER_SECONDS = 0.6;
const STEER_MAX_DEGREES_PER_SECOND = 45;
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

// Graticule: a line every 30° of latitude and longitude, sampled every 3°.
const GRATICULE_STEP = 30;
const GRATICULE_SAMPLE = 3;

function drawGraticule(context: CanvasRenderingContext2D, seam: number) {
  context.beginPath();
  const line = (points: [number, number][]) => {
    let open = false;
    for (const [longitude, latitude] of points) {
      const angles = sphereAngles(longitude, latitude, seam);
      // Only the side facing the viewer.
      if (capFacing(angles) <= 0) {
        open = false;
        continue;
      }
      const { x, y } = toView(angles);
      if (open) context.lineTo(x, y);
      else context.moveTo(x, y);
      open = true;
    }
  };
  for (let latitude = -60; latitude <= 60; latitude += GRATICULE_STEP) {
    const points: [number, number][] = [];
    for (let longitude = -180; longitude <= 180; longitude += GRATICULE_SAMPLE) points.push([longitude, latitude]);
    line(points);
  }
  for (let longitude = -180; longitude < 180; longitude += GRATICULE_STEP) {
    const points: [number, number][] = [];
    for (let latitude = -90; latitude <= 90; latitude += GRATICULE_SAMPLE) points.push([longitude, latitude]);
    line(points);
  }
  context.globalAlpha = 1;
  context.strokeStyle = "rgba(38, 38, 38, 0.09)";
  context.lineWidth = 1;
  context.stroke();
}

// `curlRef` (optional, the /demo/world-map/cap scroll effect) holds how far
// the cap has curled into a globe, 0–1; it is read every frame, so scrolling
// never re-renders React. Without it the map stays a cap. `globe` shows the
// map fully curled from the first frame (the cap's static SVG is skipped),
// `graticule` adds latitude/longitude lines, and `routes={false}` drops the
// hub's comets. `steerRef` holds the longitude to keep at the middle of a
// curled globe (null: turn steadily as usual), and `tripRef` receives a
// function that plays one round trip (request in, comet out, green pulse
// back; see CapTrip). The curl lives in cap-projection.ts's module state;
// each map sets its own before drawing, so several maps can share a page.
export function WorldMapCap({
  className = "",
  label = DEFAULT_LABEL,
  curlRef,
  globe = false,
  graticule = false,
  routes = true,
  steerRef,
  tripRef,
}: {
  className?: string;
  label?: string;
  curlRef?: RefObject<number>;
  globe?: boolean;
  graticule?: boolean;
  routes?: boolean;
  steerRef?: RefObject<number | null>;
  tripRef?: RefObject<((trip: CapTrip) => boolean) | null>;
}) {
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
          if (graticule && curl > 0) drawGraticule(context, seam);
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
        // The curl lives in cap-projection.ts's module state, shared by every
        // map on the page, so each map sets its own right before it projects
        // anything (markers, then dots, all in the same synchronous pass).
        const render = () => {
          setCapCurl(globe ? 1 : curlRef?.current ?? 0);
          updateCitiesRef.current?.(seam, width, height);
          draw(seam);
        };
        const tick = (now: number) => {
          frameId = requestAnimationFrame(tick);
          if (!running || document.hidden) {
            last = 0;
            return;
          }
          if (last) {
            const dt = (now - last) / 1000;
            const target = steerRef?.current;
            let step = dt * DEGREES_PER_SECOND;
            if (target != null) {
              // Shortest way round to the seam that puts `target` in the middle.
              const difference = ((((target - 180 - seam) % 360) + 540) % 360) - 180;
              const limit = STEER_MAX_DEGREES_PER_SECOND * dt;
              step = Math.max(-limit, Math.min(limit, difference * (1 - Math.exp(-dt / STEER_SECONDS))));
            }
            seam = ((seam + step + 540) % 360) - 180;
          }
          last = now;
          // The dots are fixed to the globe and move with it, so the map is
          // redrawn every frame, in step with the markers and routes.
          render();
        };

        render();
        setLive(true);
        frameId = requestAnimationFrame(tick);

        const resizeObserver = new ResizeObserver(() => {
          resize();
          render();
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
  }, [curlRef, globe, graticule, steerRef]);

  return (
    <div ref={frameRef} className={`${styles.frame} ${className}`}>
      <svg
        className={`${styles.map} ${live || globe ? styles.hidden : ""}`}
        viewBox={`0 0 ${CAP_VIEW_WIDTH} ${CAP_VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
      >
        <image className={styles.desktopDots} href="/demo/world-map-cap-desktop.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
        <image className={styles.mobileDots} href="/demo/world-map-cap-mobile.svg" width={CAP_VIEW_WIDTH} height={CAP_VIEW_HEIGHT} />
      </svg>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <WorldMapCapCityLayer updateRef={updateCitiesRef} routes={routes} tripRef={tripRef} />
    </div>
  );
}
