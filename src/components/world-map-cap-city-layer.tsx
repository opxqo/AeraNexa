"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { cities, routes } from "@/lib/demo/world-map-cities";
import { drawComet } from "@/lib/demo/cap-comet";
import { CAP_HALF_THETA, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capRoutePoints, projectCapCity, sphereAngles, toView } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap-city-layer.module.css";

type City = (typeof cities)[number];

const cityByName = new Map(cities.map((city) => [city.name, city]));
// Matches the @container cap (max-width: 600px) rule that hides secondary cities.
const SMALL_MAP_WIDTH = 600;

// One cycle per route: a comet flies origin → destination and hits it at 40%,
// when the destination ripples. Routes start at golden-ratio offsets through
// the cycle so they never move in step.
const CYCLE_SECONDS = 14;
const routeDelay = (index: number) => `${-(((index * 0.6180339887) % 1) * CYCLE_SECONDS).toFixed(2)}s`;
const delayByDestination = new Map(routes.map((route, index) => [route.to, routeDelay(index)]));

// Tags are centred above their marker. Where two markers are close enough for
// tags to collide, one tag drops below instead.
const below = new Set<string>(["广州", "Singapore"]);
const englishNames: Partial<Record<City["name"], string>> = {
  北京: "Beijing",
  广州: "Guangzhou",
};
// Shift tags gradually toward the inside of the map near either edge.
const EDGE_ZONE = CAP_VIEW_WIDTH * 0.12;
function tagAnchor(x: number) {
  if (x < EDGE_ZONE) return `${-50 * Math.max(0, x / EDGE_ZONE)}%`;
  if (x > CAP_VIEW_WIDTH - EDGE_ZONE) {
    return `${-50 - 50 * Math.min(1, (x - CAP_VIEW_WIDTH + EDGE_ZONE) / EDGE_ZONE)}%`;
  }
  return "-50%";
}
// As the map turns, cities fade out between these fractions of the visible
// half-sweep, so nothing pops at the seam where the map wraps around.
const FADE_START = 0.8 * CAP_HALF_THETA;
const FADE_END = 0.95 * CAP_HALF_THETA;

function fade(theta: number) {
  const distance = Math.abs(theta);
  if (distance <= FADE_START) return 1;
  return Math.max(0, 1 - (distance - FADE_START) / (FADE_END - FADE_START));
}

// Rounded so the server-rendered style matches the browser's normalised
// value on hydration.
const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

function position(city: City): CSSProperties {
  const point = projectCapCity(city.longitude, city.latitude);
  const delay = delayByDestination.get(city.name);
  return {
    left: percent(point.x, CAP_VIEW_WIDTH),
    top: percent(point.y, CAP_VIEW_HEIGHT),
    "--tag-anchor": tagAnchor(point.x),
    ...(delay ? { "--cycle-delay": delay } : {}),
  } as CSSProperties;
}

// City tags and routes. Rendered at the resting seam on the server; when the
// map turns, WorldMapCap calls the function registered in `updateRef` every
// frame, which moves them straight in the DOM (no React re-render).
export function WorldMapCapCityLayer({ updateRef }: { updateRef?: RefObject<((seam: number, width: number, height: number) => void) | null> }) {
  const cityRefs = useRef<(HTMLLIElement | null)[]>([]);
  const cometRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!updateRef) return;
    const canvas = cometRef.current;
    const context = canvas?.getContext("2d");
    // Each comet's phase comes from its destination's ripple animation, so the
    // head always lands exactly as the ripple starts.
    const ripplePhase = (index: number) => {
      const destination = cities.findIndex((city) => city.name === routes[index].to);
      const ripple = cityRefs.current[destination]?.querySelector<HTMLElement>(`.${styles.ripple}`);
      const progress = ripple?.getAnimations()[0]?.effect?.getComputedTiming().progress;
      return typeof progress === "number" ? progress : null;
    };

    updateRef.current = (seam: number, width: number, height: number) => {
      if (canvas && context) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        const scale = pixelWidth / CAP_VIEW_WIDTH;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        context.setTransform(scale, 0, 0, scale, 0, 0);
      }
      cities.forEach((city, index) => {
        const element = cityRefs.current[index];
        if (!element) return;
        const angles = sphereAngles(city.longitude, city.latitude, seam);
        const point = toView(angles);
        element.style.left = "0";
        element.style.top = "0";
        element.style.transform = `translate3d(${(point.x * width / CAP_VIEW_WIDTH).toFixed(3)}px, ${(point.y * height / CAP_VIEW_HEIGHT).toFixed(3)}px, 0)`;
        element.style.opacity = String(fade(angles.theta));
        element.style.setProperty("--tag-anchor", tagAnchor(point.x));
      });
      if (!context) return;
      // Routes are only visible as comets; there is no drawn track.
      routes.forEach(({ from, to }, index) => {
        const start = cityByName.get(from)!;
        const end = cityByName.get(to)!;
        // Same rule as the city tags: secondary destinations drop out on small maps.
        if (!end.mobile && width <= SMALL_MAP_WIDTH) return;
        const a = sphereAngles(start.longitude, start.latitude, seam).theta;
        const b = sphereAngles(end.longitude, end.latitude, seam).theta;
        // Endpoints on opposite sides of the seam: the route would cut across
        // the whole map, so skip it until both ends are back on one side.
        if (Math.abs(a - b) > CAP_HALF_THETA) return;
        const alpha = Math.min(fade(a), fade(b));
        const phase = ripplePhase(index);
        if (phase === null || alpha <= 0) return;
        drawComet(context, capRoutePoints(start, end, seam), phase, CAP_VIEW_WIDTH / width, alpha);
      });
    };
    return () => {
      updateRef.current = null;
    };
  }, [updateRef]);

  return (
    <>
      <canvas ref={cometRef} className={styles.cometLayer} aria-hidden="true" />

      <ul className={styles.cityLayer} aria-label="Cities">
        {cities.map((city, index) => (
          <li
            key={city.name}
            ref={(element) => { cityRefs.current[index] = element; }}
            className={[
              styles.city,
              delayByDestination.has(city.name) ? styles.destination : "",
              below.has(city.name) ? styles.below : "",
              city.mobile ? "" : styles.mobileHidden,
            ].filter(Boolean).join(" ")}
            style={position(city)}
          >
            <span className={styles.halo} aria-hidden="true" />
            <span className={styles.ripple} aria-hidden="true" />
            <span className={styles.pin} aria-hidden="true" />
            <span className={styles.tag}>{englishNames[city.name] ?? city.name}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
