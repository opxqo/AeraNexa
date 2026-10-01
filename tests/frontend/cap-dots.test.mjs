import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCapDots } from "../../src/lib/demo/cap-dots.ts";
import { capFacing, capLatRange, setCapCurl, sphereAngles, toView } from "../../src/lib/demo/cap-projection.ts";

const data = JSON.parse(readFileSync(new URL("../../public/demo/world-cap-land.json", import.meta.url), "utf8"));

// Independent reference: the original point selection and public projection
// functions. Optimization must retain every dot, its order, and its position.
function referenceFrame(set, seam, curl) {
  const groups = { land: [], chinaLand: [], coast: set.coast, chinaCoast: set.chinaCoast, border: set.border };
  const land = Buffer.from(set.land, "base64");
  const china = Buffer.from(set.china, "base64");
  for (let row = 0; row < set.rows; row++) {
    for (let col = 0; col < set.cols; col++) {
      const index = row * set.cols + col;
      const bit = 0x80 >> (index & 7);
      if (!(land[index >> 3] & bit)) continue;
      const latitude = 90 - ((row + 0.5) * 180) / set.rows;
      const longitude = -180 + ((col + 0.5 + (row % 2 ? 0.5 : 0)) * 360) / set.cols;
      groups[china[index >> 3] & bit ? "chinaLand" : "land"].push(longitude, latitude, col);
    }
  }
  const { north, south } = capLatRange();
  return Object.fromEntries(Object.entries(groups).map(([name, points]) => {
    const thin = name === "land" || name === "chinaLand";
    const stride = thin ? 3 : 2;
    const placed = [];
    for (let index = 0; index < points.length; index += stride) {
      const longitude = points[index] / (thin ? 1 : 100);
      const latitude = points[index + 1] / (thin ? 1 : 100);
      if (latitude < south || latitude > north) continue;
      if (thin && curl > 0) {
        const even = Math.min(1, ((360 / set.cols) * Math.cos((latitude * Math.PI) / 180)) / (180 / set.rows));
        const share = 1 + (even - 1) * curl;
        const col = points[index + 2];
        if (Math.floor((col + 1) * share) === Math.floor(col * share)) continue;
      }
      const angles = sphereAngles(longitude, latitude, seam);
      if (curl > 0 && capFacing(angles) <= 0) continue;
      const { x, y } = toView(angles);
      if (x >= -4 && x <= 1604 && y >= -4 && y <= 644) placed.push(x, y);
    }
    return [name, placed];
  }));
}

for (const variant of ["desktop", "mobile"]) {
  test(`${variant}: all dots match through rotation, wrapping and curl changes`, () => {
    const dots = createCapDots(data[variant]);
    try {
      // Revisit an earlier curl to check cache invalidation as scrolling reverses.
      for (const curl of [0, 0.25, 0.6, 1, 0.6, 0]) {
        setCapCurl(curl);
        for (const seam of [-455, -180, -95, 0, 179.999, 540]) {
          const expected = referenceFrame(data[variant], seam, curl);
          const actual = dots.frame(seam);
          for (const name of Object.keys(expected)) {
            assert.equal(actual[name].length, expected[name].length, `${name} dot count at ${seam}/${curl}`);
            for (let index = 0; index < expected[name].length; index++) {
              assert.ok(Math.abs(actual[name][index] - expected[name][index]) < 1e-9, `${name}[${index}] at ${seam}/${curl}`);
            }
          }
        }
      }
    } finally {
      setCapCurl(0);
    }
  });
}
