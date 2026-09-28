// Cities and launch rules for the spherical-cap map (home hero and
// /demo/world-map/cap). The other map demos keep using world-map-cities.ts.
//
// `mobile: false` cities drop out when the map is 600px wide or less.
// China is a single hub (a large dot, no tag) in the middle of the country
// that every comet leaves from.

export const CAP_HUB = "China";

export const capCities = [
  { name: CAP_HUB, longitude: 106, latitude: 33.5, mobile: true },
  { name: "Tokyo", longitude: 139.6917, latitude: 35.6895, mobile: false },
  { name: "Singapore", longitude: 103.8198, latitude: 1.3521, mobile: true },
  { name: "Sydney", longitude: 151.2093, latitude: -33.8688, mobile: true },
  { name: "Mumbai", longitude: 72.8777, latitude: 19.076, mobile: false },
  { name: "Johannesburg", longitude: 28.0473, latitude: -26.2041, mobile: false },
  { name: "London", longitude: -0.1276, latitude: 51.5072, mobile: true },
  { name: "Frankfurt", longitude: 8.6821, latitude: 50.1109, mobile: false },
  { name: "Los Angeles", longitude: -118.2437, latitude: 34.0522, mobile: true },
  { name: "New York", longitude: -74.006, latitude: 40.7128, mobile: true },
  { name: "São Paulo", longitude: -46.6333, latitude: -23.5505, mobile: false },
] as const;

export type CapCity = (typeof capCities)[number];
export type CapCityName = CapCity["name"];

// The hub works through its destinations in this order, which jumps
// around the globe so consecutive comets head in different directions.
export const capLaunchers: ReadonlyArray<{ from: CapCityName; to: readonly CapCityName[] }> = [
  {
    from: CAP_HUB,
    to: ["Tokyo", "London", "Sydney", "New York", "Singapore", "Frankfurt", "Los Angeles", "Mumbai", "São Paulo", "Johannesburg"],
  },
];
