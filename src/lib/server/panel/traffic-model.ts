/**
 * 流量采集的纯函数部分（docs/node-domain-design.md §4.4）。零依赖，可被测试直接 import。
 *
 * 3x-ui 给的是**累计**计数器：客户端 up/down 在 `clientStats`，入站 up/down 在入站本身。
 * 计费按「本次读数 − 上次读数」求增量；计数器变小说明被重置过（手动重置、客户端删掉重建），
 * 此时本次读数本身就是重置后的新增量。
 */

import { MANAGED_EMAIL } from "./sync-model";

export type Counter = { up: number; down: number };

export type PanelCounters = {
  /** key: 受管客户端 email（u{userId}）。 */
  clients: Map<string, Counter>;
  /** key: 3x-ui 入站 ID。 */
  inbounds: Map<number, Counter>;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function collectCounters(rawInbounds: unknown[]): PanelCounters {
  const clients = new Map<string, Counter>();
  const inbounds = new Map<number, Counter>();
  for (const raw of rawInbounds) {
    if (!isObject(raw)) continue;
    const inboundId = Number(raw.id);
    if (!Number.isInteger(inboundId) || inboundId <= 0) continue;
    inbounds.set(inboundId, { up: bytes(raw.up), down: bytes(raw.down) });

    const stats = raw.clientStats;
    if (!Array.isArray(stats)) continue;
    for (const stat of stats) {
      if (!isObject(stat)) continue;
      const email = String(stat.email ?? "");
      if (!MANAGED_EMAIL.test(email)) continue;
      // client_traffics.email 在 3x-ui 全局唯一：同一客户端挂多个入站时每个入站看到的是同一行，只取一次。
      if (!clients.has(email)) clients.set(email, { up: bytes(stat.up), down: bytes(stat.down) });
    }
  }
  return { clients, inbounds };
}

/**
 * 增量。prev 为 null（第一次见到）时从 0 起算：受管客户端都由 AeraNexa 新建，初始计数为 0，
 * 从 0 起算不会漏掉建号后第一个采集周期内的流量。
 */
export function counterDelta(prev: Counter | null, cur: Counter): Counter {
  const part = (before: number, now: number) => (now >= before ? now - before : now);
  return {
    up: part(prev?.up ?? 0, cur.up),
    down: part(prev?.down ?? 0, cur.down),
  };
}

/** 东八区自然日的起点，以 UTC 挂钟的 MySQL DATETIME 字面量返回（与 traffic.ts 的归档口径一致）。 */
export function dayBucketUtc(nowMs: number): string {
  const shifted = new Date(nowMs + 8 * 3600 * 1000);
  const instant = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600 * 1000;
  return new Date(instant).toISOString().slice(0, 19).replace("T", " ");
}

export function userIdFromEmail(email: string): number | null {
  const match = MANAGED_EMAIL.exec(email);
  return match ? Number(match[1]) : null;
}
