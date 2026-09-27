import { cities, routes } from "@/lib/demo/world-map-cities";
import styles from "./world-map-arch-city-layer.module.css";

// Same seam longitude and vertical-bulge formula as the flat arch pages.
// Keep aligned with scripts/generate-demo-arch-map.py and
// scripts/generate-demo-arch-map-globe.py.
function projectArchCity(longitude: number, latitude: number) {
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

const cityByName = new Map(cities.map((city) => [city.name, city]));

// 北京 and Tokyo sit close together on the static maps; put 北京's card to
// its left so the two labels don't collide.
const cardLeft = new Set<string>(["北京"]);

type Place = { longitude: number; latitude: number };

// City cards and routes styled like the 3D globe demo (always-visible
// labels, static lines) instead of the flat arch page's hover pins and
// animated pulses. The projection is passed in, so any static map study
// (the flat arch, the spherical cap) can share this layer.
export function WorldMapStaticCityLayer({ viewWidth, viewHeight, project, route }: {
  viewWidth: number;
  viewHeight: number;
  project: (longitude: number, latitude: number) => { x: number; y: number };
  route: (from: Place, to: Place) => string;
}) {
  return (
    <>
      <svg className={styles.routeLayer} viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {routes.map(({ from, to }) => {
          const start = cityByName.get(from)!;
          const end = cityByName.get(to)!;
          return (
            <path
              key={`${from}-${to}`}
              d={route(start, end)}
              className={`${styles.route} ${end.color === "gold" ? styles.routeGold : ""} ${end.mobile ? "" : styles.routeMobileHidden}`}
            />
          );
        })}
      </svg>
      <ul className={styles.cityLayer} aria-label="示例城市标签">
        {cities.map((city) => {
          const point = project(city.longitude, city.latitude);
          return (
            <li
              key={city.name}
              className={[styles.city, city.color === "gold" ? styles.cityGold : "", cardLeft.has(city.name) ? styles.cityLeft : city.placement === "below" ? styles.cityBelow : "", point.x > viewWidth * 0.9 ? styles.cityEdgeRight : "", city.mobile ? "" : styles.cityMobileHidden].filter(Boolean).join(" ")}
              style={{ left: `${point.x / viewWidth * 100}%`, top: `${point.y / viewHeight * 100}%` }}
            >
              <span className={styles.cityDot} />
              <span className={styles.cityCard}><strong>{city.name}</strong><small>{city.detail}</small></span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function archRoute(from: Place, to: Place) {
  return routePath(projectArchCity(from.longitude, from.latitude), projectArchCity(to.longitude, to.latitude));
}

export function WorldMapArchCityLayer() {
  return <WorldMapStaticCityLayer viewWidth={1600} viewHeight={560} project={projectArchCity} route={archRoute} />;
}
