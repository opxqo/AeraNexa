// Data the splash animations need before they can draw, loaded once and shared with the
// splash's own progress tasks (so the bar tracks the real download).

import type { CapLandData } from "@/lib/demo/cap-dots";

const CAP_LAND_URL = "/demo/world-cap-land.json";

/** Fetch `url`, reporting bytes read over Content-Length (clamped: compression makes them disagree). */
export async function fetchBytesTracked(url: string, report: (fraction: number) => void, fresh: boolean) {
  const res = await fetch(url, { cache: fresh ? "no-store" : "default" });
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    report(1);
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    report(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  report(1);
  return bytes;
}

let capLand: Promise<CapLandData> | null = null;

/** The hero map's dot data. Reuses a load in flight unless `fresh` asks for a new one. */
export function loadCapLand({ report, fresh = false }: { report?: (fraction: number) => void; fresh?: boolean } = {}) {
  if (capLand && !fresh) {
    return capLand.then((data) => {
      report?.(1);
      return data;
    });
  }
  const pending = fetchBytesTracked(CAP_LAND_URL, report ?? (() => {}), fresh).then(
    (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as CapLandData,
  );
  capLand = pending;
  pending.catch(() => {
    if (capLand === pending) capLand = null; // let the next caller try again
  });
  return pending;
}

/** Whatever the splash's tasks loaded, or a plain fetch if it hasn't started yet. */
export function getCapLand() {
  return capLand ?? loadCapLand();
}
