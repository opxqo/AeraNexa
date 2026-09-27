"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { cities, routes } from "@/lib/demo/world-map-cities";
import { CAP_HALF_THETA, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capRoutePath, projectCapCity, sphereAngles, toView } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap-city-layer.module.css";

type City = (typeof cities)[number];

const cityByName = new Map(cities.map((city) => [city.name, city]));

// One draw → erase → rest cycle per route. Routes start at golden-ratio
// offsets through the cycle so they never move in step.
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
  const routeRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    if (!updateRef) return;
    updateRef.current = (seam: number, width: number, height: number) => {
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
      routes.forEach(({ from, to }, index) => {
        const group = routeRefs.current[index];
        if (!group) return;
        const start = cityByName.get(from)!;
        const end = cityByName.get(to)!;
        const a = sphereAngles(start.longitude, start.latitude, seam).theta;
        const b = sphereAngles(end.longitude, end.latitude, seam).theta;
        // Endpoints on opposite sides of the seam: the route would cut across
        // the whole map, so hide it until both ends are back on one side.
        if (Math.abs(a - b) > CAP_HALF_THETA) {
          group.style.opacity = "0";
          return;
        }
        group.style.opacity = String(Math.min(fade(a), fade(b)));
        const d = capRoutePath(start, end, seam);
        for (const path of group.children) path.setAttribute("d", d);
      });
    };
    return () => {
      updateRef.current = null;
    };
  }, [updateRef]);

  return (
    <>
      <svg className={styles.routeLayer} viewBox={`0 0 ${CAP_VIEW_WIDTH} ${CAP_VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {routes.map(({ from, to }, index) => {
          const d = capRoutePath(cityByName.get(from)!, cityByName.get(to)!);
          const timing = { animationDelay: routeDelay(index) };
          return (
            // Three stacked copies, each covering the leading part of the drawn
            // segment, so the line brightens from its tail toward its head.
            <g
              key={`${from}-${to}`}
              ref={(element) => { routeRefs.current[index] = element; }}
              className={cityByName.get(to)!.mobile ? "" : styles.mobileHidden}
            >
              <path d={d} pathLength={100} className={`${styles.route} ${styles.full}`} style={timing} />
              <path d={d} pathLength={100} className={`${styles.route} ${styles.lead}`} style={timing} />
              <path d={d} pathLength={100} className={`${styles.route} ${styles.head}`} style={timing} />
            </g>
          );
        })}
      </svg>

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
