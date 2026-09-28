"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { CAP_HUB, capCities as cities, capLaunchers, type CapCity } from "@/lib/demo/cap-cities";
import { SHOCKWAVE, TRAVEL, drawComet, drawShockwave } from "@/lib/demo/cap-comet";
import { type Angles, CAP_VIEW_HEIGHT, CAP_VIEW_WIDTH, capFacing, capHalfTheta, capRoutePoints, capSurfaceFrame, getCapCurl, projectCapCity, sphereAngles, toView } from "@/lib/demo/cap-projection";
import styles from "./world-map-cap-city-layer.module.css";

type City = CapCity;

const cityByName = new Map(cities.map((city) => [city.name, city]));
// Matches the @container cap (max-width: 600px) rule that hides secondary cities.
const SMALL_MAP_WIDTH = 600;

// Launch rhythm: every BEAT seconds one comet leaves the China hub, which
// works through its destinations in order.
// The globe keeps launching while China is round the back: the comet then
// flies in from the edge of the map. A destination is passed over for the
// next one when neither end is in view, when it is hidden on a small map, or
// while it is still being hit. A comet's phase runs over a 14s cycle: it hits at TRAVEL (5.6s),
// then its shockwave plays out and it is dropped.
const BEAT = 1.6;
const CYCLE_SECONDS = 14;
const LIFE = TRAVEL + SHOCKWAVE.duration;
// At least one end must be this visible for a launch.
const LAUNCH_FADE = 0.6;
// Comets fade out over the outer edges of the map (shares of its width),
// about where the city tags fade.
const EDGE_CLEAR = 0.01;
const EDGE_SOLID = 0.07;
// Shockwave size: 38px on a full map, smaller on narrow ones.
const shockwaveRadius = (width: number) => Math.min(38, width * 0.03);

// Tags are centred above their marker. Where two markers are close enough for
// tags to collide, one tag drops below instead.
const below = new Set<string>(["Singapore", "Frankfurt"]);
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
// half-sweep, so nothing pops at the seam where the map wraps around. Once
// the map curls into a globe they also fade out toward its outline, and are
// hidden round the back.
const FADE_START = 0.8;
const FADE_END = 0.95;
const LIMB_FADE = 0.1;

function fade(angles: Angles) {
  const half = capHalfTheta();
  const distance = Math.abs(angles.theta);
  const seamFade = distance <= FADE_START * half ? 1 : Math.max(0, 1 - (distance - FADE_START * half) / ((FADE_END - FADE_START) * half));
  if (getCapCurl() === 0) return seamFade;
  return Math.min(seamFade, Math.max(0, Math.min(1, capFacing(angles) / LIMB_FADE)));
}

// Markers lie flat on the sphere: this maps a screen circle onto the ground
// under the city (see capSurfaceFrame), so pins and halos land as ellipses
// that flatten and shrink with perspective. North is flipped so the matrix
// doesn't mirror, and kept at least MIN_FLATTEN of east so markers near the
// rim don't collapse into lines. Tags are left upright.
const MIN_FLATTEN = 0.3;
function surfaceMatrix(city: City, seam?: number) {
  const { east, north } = capSurfaceFrame(city.longitude, city.latitude, seam);
  const eastLength = Math.hypot(east[0], east[1]);
  const northLength = Math.hypot(north[0], north[1]) || 1;
  const stretch = Math.max(1, (MIN_FLATTEN * eastLength) / northLength);
  const values = [east[0], east[1], -north[0] * stretch, -north[1] * stretch];
  return `matrix(${values.map((value) => value.toFixed(3)).join(", ")}, 0, 0)`;
}

// Rounded so the server-rendered style matches the browser's normalised
// value on hydration.
const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

function position(city: City): CSSProperties {
  const point = projectCapCity(city.longitude, city.latitude);
  return {
    left: percent(point.x, CAP_VIEW_WIDTH),
    top: percent(point.y, CAP_VIEW_HEIGHT),
    "--tag-anchor": tagAnchor(point.x),
    "--surface": surfaceMatrix(city),
  } as CSSProperties;
}

// City tags and routes. Rendered at the resting seam on the server; when the
// map turns, WorldMapCap calls the function registered in `updateRef` every
// frame, which moves them straight in the DOM (no React re-render).
// `routes={false}` keeps the markers but launches no comets (for pages that
// draw their own connections over the map).
export function WorldMapCapCityLayer({ updateRef, routes = true }: { updateRef?: RefObject<((seam: number, width: number, height: number) => void) | null>; routes?: boolean }) {
  const cityRefs = useRef<(HTMLLIElement | null)[]>([]);
  const cometRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!updateRef) return;
    const canvas = cometRef.current;
    const context = canvas?.getContext("2d");
    type Flight = { start: City; end: City; launched: number; seed: number };
    let flights: Flight[] = [];
    const cursors = capLaunchers.map(() => 0);
    let turn = 0;
    let lastBeat: number | null = null;

    const launch = (seam: number, width: number, now: number) => {
      const which = turn;
      const launcher = capLaunchers[which];
      turn = (turn + 1) % capLaunchers.length;
      const start = cityByName.get(launcher.from)!;
      const startVisible = fade(sphereAngles(start.longitude, start.latitude, seam)) >= LAUNCH_FADE;
      for (let tries = 0; tries < launcher.to.length; tries += 1) {
        const index = cursors[which];
        cursors[which] = (index + 1) % launcher.to.length;
        const end = cityByName.get(launcher.to[index])!;
        if (!end.mobile && width <= SMALL_MAP_WIDTH) continue;
        if (flights.some((flight) => flight.end === end)) continue;
        const endVisible = fade(sphereAngles(end.longitude, end.latitude, seam)) >= LAUNCH_FADE;
        if (!startVisible && !endVisible) continue;
        flights.push({ start, end, launched: now, seed: cities.indexOf(end) + 1 });
        return;
      }
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
        element.style.opacity = String(fade(angles));
        element.style.setProperty("--tag-anchor", tagAnchor(point.x));
        element.style.setProperty("--surface", surfaceMatrix(city, seam));
      });
      if (!context || !routes) return;
      const now = performance.now() / 1000;
      flights = flights.filter((flight) => (now - flight.launched) / CYCLE_SECONDS < LIFE);
      // After a pause (tab hidden, map off screen) start the rhythm afresh
      // instead of firing every missed beat at once.
      if (lastBeat === null || now - lastBeat > BEAT * 2) lastBeat = now - BEAT;
      while (now - lastBeat >= BEAT) {
        lastBeat += BEAT;
        launch(seam, width, now);
      }
      const unitsPerPixel = CAP_VIEW_WIDTH / width;
      // Routes are only visible as comets; there is no drawn track.
      flights.forEach(({ start, end, launched, seed }) => {
        // Same rule as the city tags: secondary destinations drop out on small maps.
        if (!end.mobile && width <= SMALL_MAP_WIDTH) return;
        const phase = (now - launched) / CYCLE_SECONDS;
        // Near the edges the comet is faded by the edge mask below.
        drawComet(context, capRoutePoints(start, end, seam), phase, unitsPerPixel, 1);
        const arrival = fade(sphereAngles(end.longitude, end.latitude, seam));
        if (arrival > 0) {
          drawShockwave(context, capSurfaceFrame(end.longitude, end.latitude, seam), phase, seed, shockwaveRadius(width), unitsPerPixel, arrival);
        }
      });
      // Fade everything out toward the left and right edges, so comets
      // crossing the seam slip in and out instead of being cut off.
      if (flights.length) {
        const edge = context.createLinearGradient(0, 0, CAP_VIEW_WIDTH, 0);
        edge.addColorStop(0, "rgba(0, 0, 0, 0)");
        edge.addColorStop(EDGE_CLEAR, "rgba(0, 0, 0, 0)");
        edge.addColorStop(EDGE_SOLID, "rgba(0, 0, 0, 1)");
        edge.addColorStop(1 - EDGE_SOLID, "rgba(0, 0, 0, 1)");
        edge.addColorStop(1 - EDGE_CLEAR, "rgba(0, 0, 0, 0)");
        edge.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.save();
        context.globalCompositeOperation = "destination-in";
        context.fillStyle = edge;
        context.fillRect(0, 0, CAP_VIEW_WIDTH, CAP_VIEW_HEIGHT);
        context.restore();
      }
    };
    return () => {
      updateRef.current = null;
    };
  }, [updateRef, routes]);

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
              city.name === CAP_HUB ? styles.hub : "",
              below.has(city.name) ? styles.below : "",
              city.mobile ? "" : styles.mobileHidden,
            ].filter(Boolean).join(" ")}
            style={position(city)}
          >
            <span className={styles.halo} aria-hidden="true" />
            <span className={styles.pin} aria-hidden="true" />
            {city.name === CAP_HUB
              ? <span className={styles.srOnly}>{city.name}</span>
              : <span className={styles.tag}>{city.name}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
