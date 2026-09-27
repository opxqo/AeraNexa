// Shared demo cities and routes for the world-map study pages: the flat
// arch maps (world-map-city-layer.tsx, used by both /arch and /arch-3d)
// and the 3D globe (world-globe-demo.tsx). Keep one copy so the views
// can't drift apart.

export const cities = [
  { name: "北京", detail: "位置示例", longitude: 116.4074, latitude: 39.9042, color: "blue", placement: "above", mobile: true },
  { name: "广州", detail: "位置示例", longitude: 113.2644, latitude: 23.1291, color: "blue", placement: "below", mobile: true },
  { name: "London", detail: "68ms", longitude: -0.1276, latitude: 51.5072, color: "gold", placement: "above", mobile: true },
  { name: "Tokyo", detail: "32ms", longitude: 139.6917, latitude: 35.6895, color: "gold", placement: "above", mobile: false },
  { name: "Los Angeles", detail: "128ms", longitude: -118.2437, latitude: 34.0522, color: "blue", placement: "above", mobile: true },
  { name: "Singapore", detail: "28ms", longitude: 103.8198, latitude: 1.3521, color: "gold", placement: "below", mobile: false },
  { name: "Sydney", detail: "56ms", longitude: 151.2093, latitude: -33.8688, color: "blue", placement: "below", mobile: false },
] as const;

export type CityName = (typeof cities)[number]["name"];

export const routes: ReadonlyArray<{ from: CityName; to: CityName }> = [
  { from: "广州", to: "London" },
  { from: "北京", to: "Tokyo" },
  { from: "北京", to: "Los Angeles" },
  { from: "广州", to: "Singapore" },
  { from: "广州", to: "Sydney" },
];

export const routeColorBlue = 0x2662ff;
export const routeColorGold = 0xe9ad0e;
