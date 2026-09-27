"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cities, routes, routeColorBlue as blue, routeColorGold as gold } from "@/lib/demo/world-map-cities";
import styles from "@/app/demo/world-map/globe/world-globe-demo.module.css";

type GlobePoints = {
  pointCount: number;
  points: number[];
  edgePointCount: number;
  edgePoints: number[];
};

function globePosition(longitude: number, latitude: number, radius = 1) {
  const lon = THREE.MathUtils.degToRad(longitude);
  const lat = THREE.MathUtils.degToRad(latitude);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon),
  );
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
    gl_FragColor = vec4(0.149, 0.384, 1.0, rim * 0.32);
  }
`;

function makeRoute(from: THREE.Vector3, to: THREE.Vector3, color: number) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 70; index += 1) {
    const t = index / 70;
    points.push(
      from.clone().lerp(to, t).normalize().multiplyScalar(1.08 + Math.sin(Math.PI * t) * 0.12),
    );
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
  return new THREE.Line(geometry, material);
}

export function WorldGlobeDemo() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const viewport = viewportRef.current;
    const sceneElement = sceneRef.current;
    if (!viewport || !sceneElement) return;

    const controller = new AbortController();
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function start() {
      try {
        const response = await fetch("/demo/world-globe-points.json", { signal: controller.signal });
        if (!response.ok) throw new Error("Map points failed to load");
        const data = await response.json() as GlobePoints;
        if (disposed || !viewport || !sceneElement) return;
        if (data.points.length !== data.pointCount * 2 || data.edgePoints.length !== data.edgePointCount * 2) {
          throw new Error("Invalid globe point data");
        }

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.setAttribute("aria-hidden", "true");
        viewport.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20);
        camera.position.z = 3.7;
        const globe = new THREE.Group();
        globe.rotation.x = THREE.MathUtils.degToRad(18);
        globe.rotation.y = THREE.MathUtils.degToRad(-110);
        scene.add(globe);
        // sqrt keeps retina dots crisp without merging into solid land.
        const dotScale = Math.sqrt(renderer.getPixelRatio());

        const oceanGeometry = new THREE.SphereGeometry(1, 80, 56);
        const oceanMaterial = new THREE.MeshBasicMaterial({ color: 0xf3f6fd });
        globe.add(new THREE.Mesh(oceanGeometry, oceanMaterial));

        const atmosphereGeometry = new THREE.SphereGeometry(1.065, 80, 56);
        const atmosphereMaterial = new THREE.ShaderMaterial({
          vertexShader: atmosphereVertex,
          fragmentShader: atmosphereFragment,
          transparent: true,
          depthWrite: false,
          side: THREE.FrontSide,
        });
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        atmosphere.renderOrder = 1;
        globe.add(atmosphere);

        // Land and coastline use the flat maps' #2662FF dots.
        const positions = new Float32Array(data.pointCount * 3);
        for (let index = 0; index < data.pointCount; index += 1) {
          positions.set(globePosition(data.points[index * 2], data.points[index * 2 + 1], 1.074).toArray(), index * 3);
        }
        const landGeometry = new THREE.BufferGeometry();
        landGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const landMaterial = new THREE.PointsMaterial({
          color: blue,
          size: 1.25 * dotScale,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        });
        const land = new THREE.Points(landGeometry, landMaterial);
        land.renderOrder = 2;
        globe.add(land);

        const edgePositions = new Float32Array(data.edgePointCount * 3);
        for (let index = 0; index < data.edgePointCount; index += 1) {
          edgePositions.set(globePosition(data.edgePoints[index * 2], data.edgePoints[index * 2 + 1], 1.078).toArray(), index * 3);
        }
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
        const edgeMaterial = new THREE.PointsMaterial({
          color: blue,
          size: 1.45 * dotScale,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const coast = new THREE.Points(edgeGeometry, edgeMaterial);
        coast.renderOrder = 3;
        globe.add(coast);

        const cityByName = new Map(cities.map((city) => [city.name, city]));
        const routeLines = routes.map(({ from, to }) => {
          const start = cityByName.get(from)!;
          const end = cityByName.get(to)!;
          return makeRoute(
            globePosition(start.longitude, start.latitude),
            globePosition(end.longitude, end.latitude),
            end.color === "gold" ? gold : blue,
          );
        });
        routeLines.forEach((route) => {
          route.renderOrder = 4;
          globe.add(route);
        });

        const cityElements = Array.from(sceneElement.querySelectorAll<HTMLElement>("[data-globe-city]"));
        const cityPositions = cities.map((city) => globePosition(city.longitude, city.latitude, 1.09));
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let visible = true;
        let dragging = false;
        let lastPointerX = 0;
        let lastInteraction = performance.now();
        let frameId = 0;
        let viewportLeft = 0;
        let viewportTop = 0;

        function resize() {
          if (!viewport || !sceneElement) return;
          const width = viewport.clientWidth;
          const height = viewport.clientHeight;
          if (!width || !height) return;
          const viewportBounds = viewport.getBoundingClientRect();
          const sceneBounds = sceneElement.getBoundingClientRect();
          viewportLeft = viewportBounds.left - sceneBounds.left;
          viewportTop = viewportBounds.top - sceneBounds.top;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          draw();
        }

        function draw() {
          if (!viewport) return;
          globe.updateMatrixWorld();
          for (let index = 0; index < cityElements.length; index += 1) {
            const element = cityElements[index];
            const world = cityPositions[index].clone().applyMatrix4(globe.matrixWorld);
            const inFront = world.z > 0.16;
            const screen = world.project(camera);
            element.style.opacity = inFront ? "1" : "0";
            element.style.left = `${viewportLeft + (screen.x * 0.5 + 0.5) * viewport.clientWidth}px`;
            element.style.top = `${viewportTop + (-screen.y * 0.5 + 0.5) * viewport.clientHeight}px`;
          }
          renderer.render(scene, camera);
        }

        function animate() {
          frameId = requestAnimationFrame(animate);
          if (!visible || document.hidden || reducedMotion.matches) return;
          if (!dragging && performance.now() - lastInteraction > 3000) {
            globe.rotation.y += 0.00045;
          }
          draw();
        }

        function keyDown(event: KeyboardEvent) {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          globe.rotation.y += event.key === "ArrowLeft" ? -0.18 : 0.18;
          lastInteraction = performance.now();
          draw();
        }

        function pointerDown(event: PointerEvent) {
          dragging = true;
          lastPointerX = event.clientX;
          viewport?.setPointerCapture(event.pointerId);
          viewport?.classList.add(styles.dragging);
        }

        function pointerMove(event: PointerEvent) {
          if (!dragging) return;
          globe.rotation.y += (event.clientX - lastPointerX) * 0.0045;
          lastPointerX = event.clientX;
          lastInteraction = performance.now();
          if (reducedMotion.matches) draw();
        }

        function pointerUp(event: PointerEvent) {
          dragging = false;
          lastInteraction = performance.now();
          if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
          viewport?.classList.remove(styles.dragging);
        }

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(viewport);
        const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
        intersectionObserver.observe(viewport);
        viewport.addEventListener("pointerdown", pointerDown);
        viewport.addEventListener("pointermove", pointerMove);
        viewport.addEventListener("pointerup", pointerUp);
        viewport.addEventListener("pointercancel", pointerUp);
        viewport.addEventListener("keydown", keyDown);
        resize();
        animate();
        setStatus("ready");

        cleanup = () => {
          cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          intersectionObserver.disconnect();
          viewport.removeEventListener("pointerdown", pointerDown);
          viewport.removeEventListener("pointermove", pointerMove);
          viewport.removeEventListener("pointerup", pointerUp);
          viewport.removeEventListener("pointercancel", pointerUp);
          viewport.removeEventListener("keydown", keyDown);
          land.geometry.dispose();
          (land.material as THREE.Material).dispose();
          coast.geometry.dispose();
          (coast.material as THREE.Material).dispose();
          atmosphereGeometry.dispose();
          atmosphereMaterial.dispose();
          oceanGeometry.dispose();
          oceanMaterial.dispose();
          routeLines.forEach((route) => {
            route.geometry.dispose();
            (route.material as THREE.Material).dispose();
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) setStatus("error");
      }
    }

    void start();
    return () => {
      disposed = true;
      controller.abort();
      cleanup?.();
    };
  }, []);

  return (
    <div ref={sceneRef} className={styles.scene}>
      <div ref={viewportRef} className={styles.viewport} aria-label="三维世界陆地点阵地球，可拖动或使用左右方向键旋转" role="region" tabIndex={0} />
      <ul className={styles.cityLayer} aria-hidden="true">
        {cities.map((city) => (
          <li
            key={city.name}
            className={[styles.city, city.color === "gold" ? styles.cityGold : "", city.placement === "below" ? styles.cityBelow : "", city.mobile ? "" : styles.cityMobileHidden].filter(Boolean).join(" ")}
            data-globe-city
          >
            <span className={styles.cityDot} />
            <span className={styles.cityCard}><strong>{city.name}</strong><small>{city.detail}</small></span>
          </li>
        ))}
      </ul>
      {status === "loading" && <p className={styles.message}>正在绘制地球点阵…</p>}
      {status === "error" && <p className={styles.message}>无法启动三维地图，请检查浏览器是否支持 WebGL。</p>}
    </div>
  );
}
