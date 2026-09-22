/**
 * 服务器状态区块使用的 Tabler 图标（MIT），路径取自 https://i.allsvgicons.com/tabler/{name}.svg。
 * 全部为 24×24 描边图标，统一由 currentColor 着色以适配明暗主题。
 */

import type { CSSProperties } from "react";

const PATHS = {
  cpu: [
    "M5 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z",
    "M9 9h6v6H9zm-6 1h2m-2 4h2m5-11v2m4-2v2m7 5h-2m2 4h-2m-5 7v-2m-4 2v-2",
  ],
  memory: ["M12 4L4 8l8 4l8-4zm-8 8l8 4l8-4M4 16l8 4l8-4"],
  disk: [
    "M4 6a8 3 0 1 0 16 0A8 3 0 1 0 4 6",
    "M4 6v6a8 3 0 0 0 16 0V6",
    "M4 12v6a8 3 0 0 0 16 0v-6",
  ],
  traffic: ["M7 3v18m3-15L7 3L4 6m16 12l-3 3l-3-3m3 3V3"],
  up: ["m6 15l6-6l6 6"],
  down: ["m6 9l6 6l6-6"],
  clock: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 0l3 2m-3-7v5"],
  signal: ["M6 18v-3m4 3v-6m4 6V9m4 9V6"],
  gauge: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0m2.41-1.41L16 8m-9 4a5 5 0 0 1 5-5",
  ],
  plug: [
    "m7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1-5-5zm10 0l-5-5l1.5-1.5a3.536 3.536 0 1 1 5 5zM3 21l2.5-2.5m13-13L21 3m-11 8l-2 2m5 1l-2 2",
  ],
  server: [
    "M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm0 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm4-7v.01M7 16v.01",
  ],
  activity: ["M3 12h4l3 8l4-16l3 8h4"],
  worldDown: [
    "M21 12a9 9 0 1 0-9 9M3.6 9h16.8M3.6 15H12",
    "M11.578 3a17 17 0 0 0 0 18M12.5 3c1.719 2.755 2.5 5.876 2.5 9m3 2v7m-3-3l3 3l3-3",
  ],
  worldUp: [
    "M21 12a9 9 0 1 0-9 9M3.6 9h16.8M3.6 15H12",
    "M11.578 3a17 17 0 0 0 0 18M12.5 3c1.719 2.755 2.5 5.876 2.5 9m3 9v-7m3 3l-3-3l-3 3",
  ],
  history: ["M12 8v4l2 2", "M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"],
} as const;

export type MonitorIconName = keyof typeof PATHS;

export function MonitorIcon({
  name,
  size = 14,
  className,
  style,
}: {
  name: MonitorIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        {PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
