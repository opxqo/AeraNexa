import { CYCLE_START, HOUR_WEIGHTS, PANEL_TODAY, SUBSCRIPTION, TRAFFIC_DAYS, TRAFFIC_NODES } from "./panel-mock";

// Everything the traffic page draws is derived here from the same daily totals, so the numbers on
// different charts agree with each other (and with the dashboard's "used" figure). Sizes are in MB.

export const MB_PER_GB = 1024;

/** 1234 MB -> "1.21 GB"; small amounts stay in MB. */
export function formatMb(mb: number) {
  if (mb >= MB_PER_GB ** 2) return `${(mb / MB_PER_GB ** 2).toFixed(2)} TB`;
  if (mb >= MB_PER_GB) return `${(mb / MB_PER_GB).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

const hash = (text: string) => {
  let h = 2166136261;
  for (let index = 0; index < text.length; index += 1) h = Math.imul(h ^ text.charCodeAt(index), 16777619);
  return (h >>> 0) / 4294967295;
};

export type Day = { date: string; label: string; weekday: number; up: number; down: number; total: number; avg7: number };

const labelOf = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** One upload/download pair per day (upload is 8% to 15% of the day), with a 7-day moving average. */
export const ALL_DAYS: Day[] = (() => {
  const base = TRAFFIC_DAYS.map((item) => {
    const up = Math.round(item.mb * (0.08 + hash(item.date) * 0.07));
    const [year, month, day] = item.date.split("-").map(Number);
    return { date: item.date, label: labelOf(item.date), weekday: new Date(year, month - 1, day).getDay(), up, down: item.mb - up, total: item.mb };
  });
  return base.map((item, index) => {
    const window = base.slice(Math.max(0, index - 6), index + 1);
    return { ...item, avg7: window.reduce((sum, entry) => sum + entry.total, 0) / window.length };
  });
})();

export const FIRST_DATE = ALL_DAYS[0].date;
export const LAST_DATE = ALL_DAYS[ALL_DAYS.length - 1].date;

export type Breakdown = {
  days: Day[];
  total: number;
  up: number;
  down: number;
  average: number;
  peak: Day | undefined;
  /** Average MB per day that falls in each hour. */
  hours: { hour: number; label: string; mb: number }[];
  nodes: { code: string; name: string; flag: string; mb: number }[];
  /** Average MB on each weekday, Sunday first. */
  weekdays: { weekday: number; label: string; mb: number }[];
  top: Day[];
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** Everything for the days between two ISO dates (inclusive). */
export function breakdown(from: string, to: string): Breakdown {
  const days = ALL_DAYS.filter((day) => day.date >= from && day.date <= to);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  const up = days.reduce((sum, day) => sum + day.up, 0);
  const count = days.length || 1;

  // Nodes: each day's total split by the node shares with a small per-day wobble; the last node takes the remainder.
  const nodeTotals = TRAFFIC_NODES.map(() => 0);
  for (const day of days) {
    const weights = TRAFFIC_NODES.map((node) => node.share * (0.85 + hash(`${day.date}:${node.code}`) * 0.3));
    const sum = weights.reduce((a, b) => a + b, 0);
    let given = 0;
    TRAFFIC_NODES.forEach((_, index) => {
      const part = index === TRAFFIC_NODES.length - 1 ? day.total - given : Math.round((day.total * weights[index]) / sum);
      nodeTotals[index] += part;
      given += part;
    });
  }

  const weekdayTotals = WEEKDAY_LABELS.map(() => ({ sum: 0, n: 0 }));
  for (const day of days) {
    weekdayTotals[day.weekday].sum += day.total;
    weekdayTotals[day.weekday].n += 1;
  }

  return {
    days,
    total,
    up,
    down: total - up,
    average: total / count,
    peak: days.reduce<Day | undefined>((best, day) => (!best || day.total > best.total ? day : best), undefined),
    hours: HOUR_WEIGHTS.map((weight, hour) => ({ hour, label: `${hour}`.padStart(2, "0"), mb: (total * weight) / count })),
    nodes: TRAFFIC_NODES.map((node, index) => ({ code: node.code, name: node.name, flag: node.flag, mb: nodeTotals[index] })).sort((a, b) => b.mb - a.mb),
    weekdays: weekdayTotals.map((entry, weekday) => ({ weekday, label: `周${WEEKDAY_LABELS[weekday]}`, mb: entry.n ? entry.sum / entry.n : 0 })),
    top: [...days].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

// ------------------------------------------------------------------ the billing cycle

export const QUOTA_MB = (SUBSCRIPTION.totalBytes / 1024 ** 2);
export const USED_MB = (SUBSCRIPTION.usedBytes / 1024 ** 2);

const addDays = (date: string, amount: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(year, month - 1, day + amount);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}-${String(moved.getDate()).padStart(2, "0")}`;
};

export type CyclePoint = { date: string; label: string; actual?: number; forecast?: number };

/** Cumulative use from the cycle's first day, and a dashed projection to the reset date at the last 14 days' pace. */
export function cycle() {
  const today = `${PANEL_TODAY.getFullYear()}-${String(PANEL_TODAY.getMonth() + 1).padStart(2, "0")}-${String(PANEL_TODAY.getDate()).padStart(2, "0")}`;
  const past = ALL_DAYS.filter((day) => day.date >= CYCLE_START && day.date <= today);
  const recent = past.slice(-14);
  const pace = recent.reduce((sum, day) => sum + day.total, 0) / (recent.length || 1);
  const points: CyclePoint[] = [];
  let running = 0;
  for (const day of past) {
    running += day.total;
    points.push({ date: day.date, label: day.label, actual: running });
  }
  const resetDays = SUBSCRIPTION.resetInDays;
  const last = points[points.length - 1];
  last.forecast = last.actual;
  let projected = running;
  for (let step = 1; step <= resetDays; step += 1) {
    projected += pace;
    const date = addDays(today, step);
    points.push({ date, label: labelOf(date), forecast: projected });
  }
  return { points, used: running, pace, projected, resetDays, over: projected > QUOTA_MB };
}
