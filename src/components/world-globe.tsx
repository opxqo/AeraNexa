"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { CAP_HUB, capCities as cities, type CapCity } from "@/lib/demo/cap-cities";
import { GREEN, drawComet, drawShockwave } from "@/lib/demo/cap-comet";
import { CAP_GLOBE_FILL } from "@/lib/demo/cap-projection";
import { GLOBE_FOV, GLOBE_PITCH, createGlobeView } from "@/lib/demo/globe-projection";
import {
  LAUNCH_FADE,
  SMALL_MAP_WIDTH,
  TRIP,
  TRIP_ARRIVE,
  TRIP_BACK,
  TRIP_END,
  TRIP_HOME,
  below,
  shockwaveRadius,
  tripPhase,
  wavePhase,
  type CapTrip,
} from "@/components/world-map-cap-city-layer";
import cityStyles from "./world-map-cap-city-layer.module.css";
import styles from "./world-globe.module.css";

// The globe of /demo/world-map/globe on the home page, in the page's colours:
// a pale ocean ball, an orange atmosphere, black land dots on a sphere a
// little above it, China in the accent orange. It is a stand-in for the flat
// map once that has curled into a globe (see WorldMapCap): it takes its
// facing from `seamRef` (the map's seam longitude), so the two show the same
// side while one fades into the other, and it plays the requests of the
// "unlock" block (`tripRef`, see CapTrip) with the same comets and shockwaves.

type GlobeData = {
  pointCount: number;
  points: number[];
  edgePointCount: number;
  edgePoints: number[];
  chinaPoints?: number[];
  chinaEdgePoints?: number[];
  borderPoints?: number[];
};

const ACCENT = 0xf45300;
const INK = 0x262626;
const OCEAN = 0xf3f5fa;
const RIM = 0.32;
// Cities fade out over this much of `facing` toward the globe's outline.
const LIMB_FADE = 0.1;
// Tags keep at least this share of east when laid flat, as on the flat map.
const MIN_FLATTEN = 0.3;

function globePosition(longitude: number, latitude: number, radius: number) {
  const lon = THREE.MathUtils.degToRad(longitude);
  const lat = THREE.MathUtils.degToRad(latitude);
  return [radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.cos(lon)];
}

const atmosphereVertex = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const atmosphereFragment = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    float facing = max(dot(normalize(vNormal), normalize(-vViewPosition)), 0.0);
    float rim = pow(1.0 - facing, 2.4);
    gl_FragColor = vec4(${((ACCENT >> 16) / 255).toFixed(3)}, ${(((ACCENT >> 8) & 255) / 255).toFixed(3)}, ${((ACCENT & 255) / 255).toFixed(3)}, rim * ${RIM});
  }
`;

const cityByName = new Map<string, CapCity>(cities.map((city) => [city.name, city]));

function surfaceMatrix(east: readonly [number, number], north: readonly [number, number]) {
  const eastLength = Math.hypot(east[0], east[1]);
  const northLength = Math.hypot(north[0], north[1]) || 1;
  const stretch = Math.max(1, (MIN_FLATTEN * eastLength) / northLength);
  const values = [east[0], east[1], -north[0] * stretch, -north[1] * stretch];
  return `matrix(${values.map((value) => value.toFixed(3)).join(", ")}, 0, 0)`;
}

export function WorldGlobe({
  seamRef,
  tripRef,
  activeRef,
  onReady,
  label,
}: {
  seamRef: RefObject<number>;
  tripRef?: RefObject<((trip: CapTrip) => boolean) | null>;
  /** While false the globe is not drawn (the flat map is still in charge). */
  activeRef?: RefObject<boolean>;
  onReady?: () => void;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLDivElement>(null);
  const cometRef = useRef<HTMLCanvasElement>(null);
  const cityRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    const glHost = glRef.current;
    const comets = cometRef.current;
    const context = comets?.getContext("2d");
    if (!host || !glHost || !comets || !context) return;

    const controller = new AbortController();
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function start() {
      try {
        const response = await fetch("/demo/world-globe-points.json", { signal: controller.signal });
        if (!response.ok) throw new Error("Map points failed to load");
        const data = (await response.json()) as GlobeData;
        if (disposed || !host || !glHost || !comets || !context) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.className = styles.gl;
        glHost.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(GLOBE_FOV, 1, 0.1, 20);
        const globe = new THREE.Group();
        globe.rotation.x = THREE.MathUtils.degToRad(GLOBE_PITCH);
        scene.add(globe);
        const dotScale = Math.sqrt(renderer.getPixelRatio());

        const oceanGeometry = new THREE.SphereGeometry(1, 80, 56);
        const oceanMaterial = new THREE.MeshBasicMaterial({ color: OCEAN });
        globe.add(new THREE.Mesh(oceanGeometry, oceanMaterial));

        const atmosphereGeometry = new THREE.SphereGeometry(1.065, 80, 56);
        const atmosphereMaterial = new THREE.ShaderMaterial({ vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment, transparent: true, depthWrite: false, side: THREE.FrontSide });
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        atmosphere.renderOrder = 1;
        globe.add(atmosphere);

        // Land, coast and China's own, as four sets of dots.
        const chinaLand = new Set(data.chinaPoints ?? []);
        const chinaCoast = new Set(data.chinaEdgePoints ?? []);
        const sets = { land: [] as number[], chinaLand: [] as number[], coast: [] as number[], chinaCoast: [] as number[] };
        for (let index = 0; index < data.pointCount; index += 1) {
          sets[chinaLand.has(index) ? "chinaLand" : "land"].push(...globePosition(data.points[index * 2], data.points[index * 2 + 1], 1.074));
        }
        for (let index = 0; index < data.edgePointCount; index += 1) {
          sets[chinaCoast.has(index) ? "chinaCoast" : "coast"].push(...globePosition(data.edgePoints[index * 2], data.edgePoints[index * 2 + 1], 1.078));
        }
        const border = data.borderPoints ?? [];
        for (let index = 0; index < border.length; index += 2) sets.chinaCoast.push(...globePosition(border[index], border[index + 1], 1.078));

        const disposables: { dispose: () => void }[] = [];
        const dots = (positions: number[], color: number, size: number, opacity: number, order: number) => {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
          const material = new THREE.PointsMaterial({ color, size: size * dotScale, sizeAttenuation: false, transparent: true, opacity, depthWrite: false });
          const points = new THREE.Points(geometry, material);
          points.renderOrder = order;
          globe.add(points);
          disposables.push(geometry, material);
        };
        dots(sets.land, INK, 1.25, 0.7, 2);
        dots(sets.chinaLand, ACCENT, 1.25, 0.72, 2);
        dots(sets.coast, INK, 1.45, 0.9, 3);
        dots(sets.chinaCoast, ACCENT, 1.45, 0.95, 3);

        const view = createGlobeView();
        const hub = cityByName.get(CAP_HUB)!;
        let width = 0;
        let height = 0;
        let visible = true;
        let frameId = 0;
        let lastFrame: number | null = null;
        let shown = false;

        type Trip = { end: CapCity; seed: number; born: number | null; trip: CapTrip; arrived: boolean; returned: boolean; hot: string };
        let trips: Trip[] = [];

        const fadeOf = (city: CapCity) => Math.max(0, Math.min(1, view.project(city.longitude, city.latitude).facing / LIMB_FADE));
        const setHot = (city: CapCity, value: string) => {
          const element = cityRefs.current[cities.indexOf(city)];
          if (!element) return;
          if (value) element.dataset.hot = value;
          else delete element.dataset.hot;
        };

        if (tripRef) {
          // False when the trip can't be shown right now.
          tripRef.current = (request) => {
            const end = cityByName.get(request.city);
            if (!end || end === hub || !shown || !(activeRef?.current ?? true) || fadeOf(hub) < LAUNCH_FADE || fadeOf(end) < LAUNCH_FADE) return false;
            if (!end.mobile && width <= SMALL_MAP_WIDTH) return false;
            trips.push({ end, seed: cities.indexOf(end) + 1, born: null, trip: request, arrived: false, returned: false, hot: "" });
            return true;
          };
        }

        function resize() {
          if (!host || !comets) return;
          width = host.clientWidth;
          height = host.clientHeight;
          if (!width || !height) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          view.resize(width, height, CAP_GLOBE_FILL);
          camera.position.z = view.distance;
          camera.updateProjectionMatrix();
          comets.width = Math.round(width * ratio);
          comets.height = Math.round(height * ratio);
        }

        function frame(now: number) {
          const context2d = context!;
          const ratio = comets!.width / (width || 1);
          const center = ((((seamRef.current ?? 0) + 180 + 540) % 360) - 180);
          view.orient(center);
          globe.rotation.y = THREE.MathUtils.degToRad(-center);

          // City tags and pins, laid flat on the globe.
          cities.forEach((city, index) => {
            const element = cityRefs.current[index];
            if (!element) return;
            const point = view.project(city.longitude, city.latitude);
            const surface = view.surfaceFrame(city.longitude, city.latitude);
            element.style.transform = `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0)`;
            element.style.opacity = String(Math.max(0, Math.min(1, point.facing / LIMB_FADE)));
            element.style.setProperty("--surface", surfaceMatrix(surface.east, surface.north));
          });

          // Round trips: request in, comet out, green pulse back.
          context2d.setTransform(1, 0, 0, 1, 0, 0);
          context2d.clearRect(0, 0, comets!.width, comets!.height);
          context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
          const seconds = now / 1000;
          if (lastFrame !== null && seconds - lastFrame > 0.25) {
            const gap = seconds - lastFrame;
            trips.forEach((entry) => {
              if (entry.born !== null) entry.born += gap;
            });
          }
          lastFrame = seconds;
          const radius = shockwaveRadius(width);
          trips = trips.filter((entry) => {
            if (entry.born === null) entry.born = seconds + (entry.trip.delay ?? 0);
            const time = seconds - entry.born;
            if (time < 0) return true;
            if (time >= TRIP_END) {
              if (!entry.arrived) entry.trip.onArrive?.();
              if (!entry.returned) entry.trip.onReturn?.();
              if (entry.hot) setHot(entry.end, "");
              return false;
            }
            const hubFrame = view.surfaceFrame(hub.longitude, hub.latitude);
            const hubFade = fadeOf(hub);
            const endFrame = view.surfaceFrame(entry.end.longitude, entry.end.latitude);
            const endFade = fadeOf(entry.end);
            if (time < TRIP.receive && hubFade > 0) drawShockwave(context2d, hubFrame, wavePhase(time, 0, TRIP.receive), entry.seed, radius * 0.55, 1, hubFade);
            const out = tripPhase(time, TRIP.launch, TRIP.out);
            if (out >= 0) drawComet(context2d, view.routePoints(hub, entry.end), out, 1, 1);
            if (time >= TRIP_ARRIVE && time < TRIP_ARRIVE + TRIP.land && endFade > 0) drawShockwave(context2d, endFrame, wavePhase(time, TRIP_ARRIVE, TRIP.land), entry.seed, radius, 1, endFade);
            if (!entry.arrived && time >= TRIP_ARRIVE) {
              entry.arrived = true;
              entry.hot = "out";
              setHot(entry.end, "out");
              entry.trip.onArrive?.();
            }
            const back = tripPhase(time, TRIP_BACK, TRIP.back);
            if (back >= 0) {
              if (entry.hot === "out") {
                entry.hot = "ok";
                setHot(entry.end, "ok");
              }
              drawComet(context2d, view.routePoints(entry.end, hub), back, 1, 1, GREEN);
            }
            if (time >= TRIP_HOME && hubFade > 0) drawShockwave(context2d, hubFrame, wavePhase(time, TRIP_HOME, TRIP.home), entry.seed, radius * 0.7, 1, hubFade, GREEN);
            if (!entry.returned && time >= TRIP_HOME) {
              entry.returned = true;
              entry.trip.onReturn?.();
            }
            return true;
          });

          if (activeRef?.current ?? true) renderer.render(scene, camera);
        }

        function tick(now: number) {
          frameId = requestAnimationFrame(tick);
          if (!visible || document.hidden || !width || !height) {
            lastFrame = null;
            return;
          }
          frame(now);
        }

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
        intersectionObserver.observe(host);
        resize();
        frame(performance.now());
        shown = true;
        host.dataset.ready = "";
        onReady?.();
        frameId = requestAnimationFrame(tick);

        cleanup = () => {
          cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          intersectionObserver.disconnect();
          if (tripRef) tripRef.current = null;
          trips.forEach((entry) => setHot(entry.end, ""));
          delete host.dataset.ready;
          disposables.forEach((item) => item.dispose());
          atmosphereGeometry.dispose();
          atmosphereMaterial.dispose();
          oceanGeometry.dispose();
          oceanMaterial.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) hostRef.current?.setAttribute("data-state", "error");
      }
    }

    void start();
    return () => {
      disposed = true;
      controller.abort();
      cleanup?.();
    };
  }, [activeRef, onReady, seamRef, tripRef]);

  return (
    <div ref={hostRef} className={styles.host} role="img" aria-label={label}>
      <div ref={glRef} className={styles.gl} />
      <canvas ref={cometRef} className={styles.comets} aria-hidden="true" />
      <ul className={cityStyles.cityLayer} aria-label="Cities">
        {cities.map((city, index) => (
          <li
            key={city.name}
            ref={(element) => { cityRefs.current[index] = element; }}
            className={[cityStyles.city, city.name === CAP_HUB ? cityStyles.hub : "", below.has(city.name) ? cityStyles.below : "", city.mobile ? "" : cityStyles.mobileHidden].filter(Boolean).join(" ")}
            style={{ left: 0, top: 0, opacity: 0 }}
          >
            <span className={cityStyles.halo} aria-hidden="true" />
            <span className={cityStyles.pin} aria-hidden="true" />
            {city.name === CAP_HUB ? <span className={cityStyles.srOnly}>{city.name}</span> : <span className={cityStyles.tag}>{city.name}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
