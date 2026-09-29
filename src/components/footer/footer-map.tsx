"use client";

import { useEffect, useRef } from "react";
import { capCities } from "@/lib/demo/cap-cities";
import styles from "./site-footer.module.css";

// A small dot map of the world for the footer: grey dots from the flat map
// demo's data (Asia-centred equirectangular, 1600 × 800), a few accent dots
// where we have nodes, and a few grey ones that grow and fade in turn. The
// box is 662 : 340, so the 800-tall map sits in 822 units (11 above, 11 below).
const WIDTH = 1600;
const HEIGHT = 822;
const SEAM = -30;
const STEP = 1600 / 240; // the data's grid: 1.5°
const THIN = 2; // keep every second column and row: 3°

const project = (longitude: number, latitude: number) => ({
  x: ((((longitude - SEAM) % 360) + 360) % 360) / 360 * WIDTH,
  y: ((90 - latitude) / 180) * 800 + 11,
});

const city = (name: string) => capCities.find((item) => item.name === name)!;
const NODES = ["Tokyo", "Singapore", "Sydney", "London"].map((name) => project(city(name).longitude, city(name).latitude));
const PULSES = ["Mumbai", "Frankfurt", "Johannesburg", "Los Angeles", "New York", "São Paulo"].map((name, index) => ({
  ...project(city(name).longitude, city(name).latitude),
  delay: [-0.3, -2.1, -4.7, -1.2, -3.4, -5.6][index],
}));

export function FooterMap({ label }: { label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const controller = new AbortController();
    let points: [number, number][] = [];

    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform((width * ratio) / WIDTH, 0, 0, (height * ratio) / HEIGHT, 0, 0);
      context.fillStyle = "rgba(17, 17, 17, .22)";
      context.beginPath();
      for (const [x, y] of points) {
        context.moveTo(x + 4, y + 11);
        context.arc(x, y + 11, 4, 0, Math.PI * 2);
      }
      context.fill();
    };

    fetch("/demo/world-map-points.json", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ mobile: { points: [number, number][] } }>)
      .then((data) => {
        points = data.mobile.points.filter(([x, y]) => Math.round((x - STEP / 2) / STEP) % THIN === 0 && Math.round((y - 30) / STEP) % THIN === 0);
        draw();
      })
      .catch(() => {});
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, []);

  return (
    <div className={`${styles.map} ${styles.rv}`} style={{ "--d": ".15s" } as React.CSSProperties} role="img" aria-label={label}>
      <canvas ref={canvasRef} className={styles.mapCanvas} aria-hidden="true" />
      <svg className={styles.mapDots} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        {NODES.map((node) => <circle key={`${node.x}-${node.y}`} cx={node.x} cy={node.y} r={12} fill="#f45300" />)}
        <g className={styles.mapPulse}>
          {PULSES.map((pulse) => <circle key={`${pulse.x}-${pulse.y}`} cx={pulse.x} cy={pulse.y} r={12} style={{ "--delay": `${pulse.delay}s` } as React.CSSProperties} />)}
        </g>
      </svg>
    </div>
  );
}
