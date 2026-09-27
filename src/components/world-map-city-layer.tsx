"use client";

import { useState } from "react";
import styles from "@/app/demo/world-map/world-map-demo.module.css";

const beijing = { name: "北京", detail: "位置示例", longitude: 116.4074, latitude: 39.9042, color: "blue", placement: "above", mobile: true, mobileClass: styles.cityBeijing } as const;
const guangzhou = { name: "广州", detail: "位置示例", longitude: 113.2644, latitude: 23.1291, color: "blue", placement: "below", mobile: true, mobileClass: styles.cityGuangzhou } as const;
const london = { name: "London", detail: "68ms", longitude: -0.1276, latitude: 51.5072, color: "gold", placement: "above", mobile: true, mobileClass: "" } as const;
const tokyo = { name: "Tokyo", detail: "32ms", longitude: 139.6917, latitude: 35.6895, color: "gold", placement: "above", mobile: false, mobileClass: "" } as const;
const losAngeles = { name: "Los Angeles", detail: "128ms", longitude: -118.2437, latitude: 34.0522, color: "blue", placement: "above", mobile: true, mobileClass: "" } as const;
const singapore = { name: "Singapore", detail: "28ms", longitude: 103.8198, latitude: 1.3521, color: "gold", placement: "below", mobile: false, mobileClass: "" } as const;
const sydney = { name: "Sydney", detail: "56ms", longitude: 151.2093, latitude: -33.8688, color: "blue", placement: "below", mobile: false, mobileClass: "" } as const;

const archCities = [
  london,
  tokyo,
  losAngeles,
  beijing,
  guangzhou,
  singapore,
  sydney,
] as const;

const overseasRoutes = [
  { from: guangzhou, to: london },
  { from: beijing, to: tokyo },
  { from: beijing, to: losAngeles },
  { from: guangzhou, to: singapore },
  { from: guangzhou, to: sydney },
] as const;

function projectArchCity(longitude: number, latitude: number) {
  // Keep this projection aligned with scripts/generate-demo-arch-map.py.
  const x = (((longitude + 30) % 360 + 360) % 360) / 360 * 1600;
  const y = 26 + (84 - latitude) * 3 + 100 * ((x - 800) / 800) ** 2;
  return { x, y };
}

function routePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let controlX: number;
  let controlY: number;

  if (Math.abs(dx) < 75) {
    controlX = (from.x + to.x) / 2 - 48;
    controlY = (from.y + to.y) / 2;
  } else if (Math.abs(dy) > 80) {
    controlX = (from.x + to.x) / 2 + (dx < 0 ? -28 : 28);
    controlY = (from.y + to.y) / 2 - 20;
  } else {
    controlX = (from.x + to.x) / 2;
    controlY = Math.min(from.y, to.y) - Math.min(115, Math.max(28, Math.abs(dx) * .18));
  }

  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function WorldMapCityLayer() {
  const [activeCity, setActiveCity] = useState<string | null>(null);

  return (
    <>
      <svg className={styles.routeLayer} viewBox="0 0 1600 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {overseasRoutes.map(({ from, to }, index) => {
          const path = routePath(
            projectArchCity(from.longitude, from.latitude),
            projectArchCity(to.longitude, to.latitude),
          );
          const animationDelay = `${index * 0.55}s`;
          return (
            <g key={to.name} className={to.mobile ? "" : styles.routeMobileHidden} data-origin={from.name} data-target={to.name}>
              <path
                d={path}
                pathLength={100}
                className={`${styles.route} ${to.color === "gold" ? styles.routeGold : ""}`}
                style={{ animationDelay }}
              />
              <path
                d={path}
                pathLength={100}
                className={`${styles.routePulse} ${to.color === "gold" ? styles.routePulseGold : ""}`}
                style={{ animationDelay }}
              />
            </g>
          );
        })}
      </svg>
      <ul className={styles.cityLayer} aria-label="示例城市标签">
        {archCities.map((city) => {
          const point = projectArchCity(city.longitude, city.latitude);
          return (
            <li
              key={city.name}
              className={`${styles.city} ${city.mobile ? "" : styles.cityMobileHidden} ${city.placement === "below" ? styles.cityBelow : ""} ${city.mobileClass}`}
              data-open={activeCity === city.name ? "true" : undefined}
              style={{ left: `${point.x / 1600 * 100}%`, top: `${point.y / 560 * 100}%` }}
            >
              <button
                type="button"
                className={`${styles.cityPin} ${city.color === "gold" ? styles.cityPinGold : ""}`}
                aria-label={`${city.name}，${city.detail}`}
                onClick={() => {
                  if (window.matchMedia("(hover: none)").matches) {
                    setActiveCity((current) => current === city.name ? null : city.name);
                  }
                }}
              />
              <span className={styles.cityCard} aria-hidden="true">
                <span className={`${styles.cityCardDot} ${city.color === "gold" ? styles.cityCardDotGold : ""}`} aria-hidden="true" />
                <span className={styles.cityCopy}><strong>{city.name}</strong><small>{city.detail}</small></span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
