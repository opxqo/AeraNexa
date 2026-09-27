import styles from "@/app/home-hero.module.css";

const locations = [
  { name: "London", latency: "68ms", x: 426, y: 83, color: "gold", className: "" },
  { name: "Tokyo", latency: "32ms", x: 946, y: 91, color: "gold", className: "" },
  { name: "Los Angeles", latency: "128ms", x: 1310, y: 161, color: "blue", className: styles.mobileHidden },
  { name: "Singapore", latency: "28ms", x: 680, y: 330, color: "gold", className: "" },
  { name: "Sydney", latency: "56ms", x: 1058, y: 351, color: "blue", className: styles.mobileHidden },
] as const;

const routes = [
  { d: "M955 218 C839 93 612 43 445 106", color: "blue", major: true },
  { d: "M955 218 C815 51 585 72 445 106", color: "gold", major: false },
  { d: "M955 218 C948 169 965 128 978 111", color: "blue", major: true },
  { d: "M955 218 C1097 77 1265 93 1330 176", color: "blue", major: true },
  { d: "M955 218 C1080 118 1218 105 1330 176", color: "gold", major: false },
  { d: "M955 218 C895 270 796 310 735 351", color: "blue", major: true },
  { d: "M955 218 C960 280 1029 318 1074 367", color: "blue", major: true },
  { d: "M955 218 C977 281 1036 338 1074 367", color: "gold", major: false },
  { d: "M955 218 C735 58 370 58 114 281", color: "blue", major: false },
  { d: "M955 218 C701 99 426 145 220 303", color: "gold", major: false },
  { d: "M955 218 C1146 26 1441 77 1603 309", color: "blue", major: false },
  { d: "M955 218 C1190 145 1461 202 1637 328", color: "gold", major: false },
  { d: "M955 218 C769 181 560 244 345 381", color: "blue", major: false },
  { d: "M955 218 C1112 222 1295 299 1458 393", color: "blue", major: false },
  { d: "M955 218 C795 8 480 -3 84 285", color: "blue", major: false },
  { d: "M955 218 C820 3 502 13 42 323", color: "gold", major: false },
  { d: "M955 218 C776 92 510 102 215 287", color: "blue", major: true },
  { d: "M955 218 C744 143 500 183 113 388", color: "gold", major: false },
  { d: "M955 218 C1087 1 1440 24 1650 302", color: "blue", major: false },
  { d: "M955 218 C1124 63 1436 89 1630 266", color: "gold", major: false },
  { d: "M955 218 C1141 135 1382 171 1589 368", color: "blue", major: true },
  { d: "M955 218 C1119 209 1361 275 1537 432", color: "gold", major: false },
  { d: "M955 218 C786 215 600 285 492 429", color: "blue", major: false },
  { d: "M955 218 C1009 258 1184 359 1226 430", color: "blue", major: false },
] as const;

const particles = Array.from({ length: 280 }, (_, index) => {
  const x = 35 + ((index * 977 + 81) % 1605);
  const curve = 19 + 145 * Math.pow(Math.abs((x - 838) / 805), 1.65);
  const y = curve + ((index * 613) % 312);
  return {
    x,
    y,
    radius: index % 7 === 0 ? 2.7 : index % 3 === 0 ? 1.9 : 1.2,
    fill: index % 9 === 0 ? "#FFC21A" : index % 3 === 0 ? "#2662FF" : "#8EB1FF",
    opacity: index % 4 === 0 ? 0.97 : 0.76,
  };
}).filter((particle) => particle.y < 442);

export function HomeNetworkVisualization() {
  return (
    <div className={styles.mapViewport} aria-label="全球像素网络示意图，亚洲节点连接五座城市">
      <div className={styles.mapCanvas}>
        <svg className={styles.mapSvg} viewBox="0 0 1676 460" role="img" aria-label="全球大陆点阵与网络连接线路">
          <g fill="none" strokeLinecap="round">
            <path d="M22 318 C254 119 550 37 838 23 C1138 35 1452 124 1654 325" stroke="#9FC1FF" strokeWidth="1" strokeDasharray="2 5" opacity=".55" />
            <path d="M58 360 C290 171 557 84 838 65 C1125 78 1403 178 1617 363" stroke="#B9D0FF" strokeWidth="1" strokeDasharray="2 6" opacity=".52" />
            <path d="M118 398 C335 239 587 128 838 107 C1101 126 1361 248 1558 405" stroke="#FFC21A" strokeWidth="1" strokeDasharray="3 7" opacity=".59" />
          </g>

          <image href="/hero/pixel-world.svg" x="0" y="0" width="1676" height="460" />

          <g aria-hidden="true">
            {particles.map((particle, index) => (
              <circle key={index} cx={particle.x} cy={particle.y} r={particle.radius} fill={particle.fill} opacity={particle.opacity} />
            ))}
          </g>

          <g fill="none" strokeLinecap="round" aria-hidden="true">
            {routes.map((route, index) => (
              <path
                key={index}
                d={route.d}
                stroke={route.color === "gold" ? "#FFC21A" : "#2662FF"}
                strokeWidth={route.major ? 1.45 : 1.05}
                strokeDasharray={route.major ? undefined : "3 5"}
                opacity={route.major ? 0.9 : 0.62}
              />
            ))}
          </g>

          <g className={styles.hub} aria-hidden="true">
            <circle cx="955" cy="218" r="24" fill="#FFF6CE" opacity=".54" />
            <circle cx="955" cy="218" r="15" fill="#FFFFFF" stroke="#FFC21A" strokeWidth="2" />
            <circle cx="955" cy="218" r="8" fill="#2662FF" />
          </g>
        </svg>

        {locations.map((location) => (
          <div
            key={location.name}
            className={`${styles.location} ${location.className}`}
            style={{ left: `${location.x / 1676 * 100}%`, top: `${location.y / 460 * 100}%` }}
          >
            <span className={`${styles.locationDot} ${location.color === "gold" ? styles.locationDotGold : ""}`} aria-hidden="true" />
            <span className={styles.locationText}><strong>{location.name}</strong><small>{location.latency}</small></span>
          </div>
        ))}
      </div>
    </div>
  );
}
