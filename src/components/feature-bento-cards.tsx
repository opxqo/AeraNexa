"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Link2, Smartphone } from "lucide-react";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-bento.module.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

/** Fades the grid's cards in, staggered, the first time it scrolls into view.
 *  The cards stay visible without JavaScript: hiding them (data-reveal="wait")
 *  only happens once the observer is in place. */
export function BentoReveal({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.dataset.reveal = "wait";
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      element.dataset.reveal = "in";
      observer.disconnect();
    }, { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

// ① Subscription pulls, after cloudflare.com's WorkflowCard: every 3s a new
// pull joins the top of the list (at most 5 kept); every 2s each pull moves
// one step on: 识别中 → 生成中 → 已下发. Clients and formats follow
// wantsClash() in src/lib/server/panel/clash.ts: Clash-family clients get
// YAML, everything else Base64.
type Status = "queued" | "busy" | "done";
type Pull = { id: number; client: string; format: string; status: Status };

const CLIENTS = [
  { client: "Clash Verge", format: "Clash YAML" },
  { client: "Shadowrocket", format: "Base64" },
  { client: "Mihomo", format: "Clash YAML" },
  { client: "v2rayN", format: "Base64" },
  { client: "Stash", format: "Clash YAML" },
];
const NEXT: Record<Status, Status> = { queued: "busy", busy: "done", done: "done" };
const INITIAL_PULLS: Pull[] = [
  { id: 3, ...CLIENTS[2], status: "done" },
  { id: 2, ...CLIENTS[1], status: "busy" },
  { id: 1, ...CLIENTS[0], status: "queued" },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") return <span className={styles.statusDone}><Check size={12} strokeWidth={3} /></span>;
  if (status === "busy") {
    return (
      <svg className={styles.statusBusy} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".2" />
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeDasharray="18.85" strokeDashoffset="14.14" transform="rotate(-90 8 8)" />
      </svg>
    );
  }
  return (
    <svg className={styles.statusQueued} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" fill="none" />
    </svg>
  );
}

export function SubscriptionFeed({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].bento;
  const reduced = useReducedMotion();
  const [pulls, setPulls] = useState(INITIAL_PULLS);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let next = INITIAL_PULLS[0].id + 1;
    const add = setInterval(() => {
      const id = next;
      next += 1;
      setPulls((current) => [{ id, ...CLIENTS[id % CLIENTS.length], status: "queued" as const }, ...current].slice(0, 5));
      setSlide(id);
    }, 3000);
    const advance = setInterval(() => {
      setPulls((current) => current.map((pull) => ({ ...pull, status: NEXT[pull.status] })));
    }, 2000);
    return () => {
      clearInterval(add);
      clearInterval(advance);
    };
  }, [reduced]);

  return (
    <div className={styles.feed} aria-hidden="true">
      <div className={styles.appTile}>
        <Link2 size={30} strokeWidth={1.8} />
        <span className={styles.appBadge}><Smartphone size={16} strokeWidth={1.8} /></span>
      </div>
      <div key={slide} className={`${styles.feedList} ${slide ? styles.slide : ""}`}>
        {pulls.map((pull) => (
          <div key={pull.id} className={styles.feedRow}>
            <svg className={styles.pointer} viewBox="0 0 15 20" aria-hidden="true">
              <path d="M1.1 10.8a1 1 0 0 1 0-1.6L12.7.8A1 1 0 0 1 14.3 1.6v16.8a1 1 0 0 1-1.6.8Z" fill="var(--accent)" opacity=".1" />
            </svg>
            <div className={styles.feedCells}>
              <span className={styles.feedClient}>{pull.client}</span>
              <span className={styles.feedFormat}>{copy.pulled(pull.format)}</span>
              <span className={styles.feedStatus}>{copy.pullStatus[pull.status]}<StatusIcon status={pull.status} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ④ Node status panel (illustrative numbers).
const NODES = [
  { name: "hk-01", load: 42, latency: 38 },
  { name: "jp-02", load: 57, latency: 52 },
  { name: "sg-01", load: 33, latency: 61 },
  { name: "us-03", load: 68, latency: 142 },
  { name: "de-01", load: 29, latency: 186 },
];

// Laid out after the agents panel on cloudflare.com's "Fast path to AI
// adoption" card: a line of context, a status line, three rows in view
// (↳ name → metrics), a "live" footer, and a prompt bar. Every 2.4s the list
// rises a row: the top node blurs out and the next blurs in at the bottom.
// Latency and load drift on a fixed sine (sample data, no random numbers).
const ROTATE_MS = 2400;
const RISE_MS = 400;

function CornerArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3v6a3 3 0 0 0 3 3h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10 9 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RightArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8h12m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NodeStatus({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].bento;
  const reduced = useReducedMotion();
  const [offset, setOffset] = useState(0);
  const [rising, setRising] = useState(false);

  useEffect(() => {
    if (reduced) return;
    let settle = 0;
    const timer = setInterval(() => {
      setRising(true);
      settle = window.setTimeout(() => {
        setOffset((value) => value + 1);
        setRising(false);
      }, RISE_MS);
    }, ROTATE_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
    };
  }, [reduced]);

  // Rows in view plus the one waiting below.
  const rows = [0, 1, 2, 3].map((slot) => {
    const index = (offset + slot) % NODES.length;
    const node = NODES[index];
    const wave = Math.sin((offset + slot) * 0.9 + index * 1.7);
    return { ...node, latency: Math.round(node.latency + 6 * wave), load: Math.round(node.load + 12 * wave) };
  });

  return (
    <div className={styles.console} aria-hidden="true">
      <div className={styles.panel}>
        <span className={styles.panelTitle}>{copy.checking}</span>
        <div className={styles.panelStatus}>
          <i />
          {copy.online(NODES.length)}
          <span className={styles.sample}>{copy.sample}</span>
        </div>
        <div className={styles.nodeList}>
          <div className={`${styles.nodeTrack} ${rising ? styles.rising : ""}`}>
            {rows.map((row) => (
              <div key={row.name} className={styles.nodeRow}>
                <span className={styles.nodeName}><CornerArrow /><b>{row.name}</b></span>
                <span className={styles.nodeMeta}><RightArrow />{copy.latency(row.latency)}<i />{copy.load(row.load)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.panelFoot}>
          <span className={styles.dotMark}>
            {[0.5, 0.25, 0.5, 0.25, 0, 0.25, 0.5, 0.25, 0.5].map((delay, index) => (
              <i key={index} style={{ animationDelay: `${delay}s` }} />
            ))}
          </span>
          <span className={styles.ellipsis}>{copy.live}<i>.</i><i>.</i><i>.</i></span>
        </div>
      </div>
      <div className={styles.prompt}>
        &gt; {copy.prompt}<span className={styles.caret} />
        <span className={styles.enter}>{copy.enter}</span>
      </div>
    </div>
  );
}

// ⑤ Device seats: remove a device and its seat frees up.
const DEVICES = [
  { id: "a", name: "iPhone 15", client: "Shadowrocket" },
  { id: "b", name: "MacBook Air", client: "Clash Verge" },
  { id: "c", name: "Windows PC", client: "v2rayN" },
];
const SEATS = 5;

export function DeviceSeats({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].bento;
  const [devices, setDevices] = useState(DEVICES);
  return (
    <div className={styles.devices}>
      <div className={styles.devicesHead}>
        <span>{copy.myDevices}</span>
        <span><strong>{devices.length}</strong>{copy.seats(SEATS)}</span>
      </div>
      {devices.map((device) => (
        <div key={device.id} className={styles.deviceRow}>
          <span>{device.name} <small>· {device.client}</small></span>
          <button type="button" className={styles.remove} onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))}>
            {copy.remove}
          </button>
        </div>
      ))}
      {devices.length < DEVICES.length && (
        <button type="button" className={styles.reset} onClick={() => setDevices(DEVICES)}>{copy.restore}</button>
      )}
    </div>
  );
}

// ⑥ Usage panel (all numbers are samples), laid out like a dashboard
// health card: title and subtitle with a segmented cycle meter and its
// reading on the right, a usage histogram, three stat tiles with change
// pills, and period tabs. Everything counts up once when the card is shown;
// the tabs swap the histogram and the "used" tile. The numbers are drawn
// afresh on every page load (after hydration, so the server render and the
// first client render match; the fixed set below is what they start from).
const SEGMENTS = 24;

type PeriodId = "24h" | "7d" | "30d";
type Period = { id: PeriodId; used: number; change: number; unit: "hourly" | "daily"; bars: number[] };
type Usage = { total: number; cycleUsed: number; daysLeft: number; periods: Period[] };

// Fixed bar heights (0–1): a daily rhythm plus drift.
const waveBars = (count: number, seed: number) =>
  Array.from({ length: count }, (_, index) => 0.35 + 0.3 * Math.sin(index * 0.8 + seed) + 0.125 * Math.sin(index * 2.3 + seed * 3) + (index === count - 1 ? 0.2 : 0));

const INITIAL_USAGE: Usage = {
  total: 300,
  cycleUsed: 126.4,
  daysLeft: 94,
  periods: [
    { id: "24h", used: 3.8, change: 12, unit: "hourly", bars: waveBars(24, 1) },
    { id: "7d", used: 29.6, change: -6, unit: "daily", bars: waveBars(7, 2) },
    { id: "30d", used: 126.4, change: 8, unit: "daily", bars: waveBars(30, 3) },
  ],
};

const between = (min: number, max: number) => min + Math.random() * (max - min);
const round1 = (value: number) => Math.round(value * 10) / 10;
// A non-zero whole-percent change between −25% and +25%.
const randomChange = () => (Math.random() < 0.5 ? -1 : 1) * Math.round(between(2, 25));
// Random bar heights that still look like usage: a smooth baseline with
// quiet stretches and the odd spike.
function randomBars(count: number) {
  let level = between(0.3, 0.7);
  return Array.from({ length: count }, () => {
    level = Math.min(1, Math.max(0.05, level + between(-0.25, 0.25)));
    return Math.random() < 0.12 ? between(0.02, 0.08) : Math.random() < 0.1 ? level + between(0.3, 0.6) : level;
  });
}

function randomUsage(): Usage {
  const total = [100, 200, 300, 500][Math.floor(Math.random() * 4)];
  const cycleUsed = round1(total * between(0.15, 0.85));
  const month = round1(cycleUsed * between(0.7, 1));
  const week = round1(month * between(0.18, 0.32));
  const day = round1(week * between(0.1, 0.22));
  return {
    total,
    cycleUsed,
    daysLeft: Math.round(between(5, 180)),
    periods: [
      { id: "24h", used: day, change: randomChange(), unit: "hourly", bars: randomBars(24) },
      { id: "7d", used: week, change: randomChange(), unit: "daily", bars: randomBars(7) },
      { id: "30d", used: month, change: randomChange(), unit: "daily", bars: randomBars(30) },
    ],
  };
}

function Change({ value }: { value: number }) {
  return <span className={`${styles.change} ${value > 0 ? styles.up : styles.down}`}>{value > 0 ? "+" : "−"}{Math.abs(value)}%</span>;
}

export function UsageMeter({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].bento;
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [counted, setProgress] = useState(0);
  const [usage, setUsage] = useState(INITIAL_USAGE);
  const [periodIndex, setPeriodIndex] = useState(2);
  // "Used" figure shown in the tile; it glides to the new period's value.
  const [usedShown, setUsedShown] = useState(INITIAL_USAGE.periods[2].used);
  const tweenRef = useRef(0);
  const progress = reduced ? 1 : counted;
  const { total, cycleUsed, daysLeft, periods } = usage;
  const period = periods[periodIndex];

  // New numbers on every load, drawn just after hydration.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = randomUsage();
      setUsage(next);
      setUsedShown(next.periods[2].used);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Switching periods: the bars regrow left to right (they remount, see the
  // CSS) and the used figure counts from its current value to the new one.
  const switchPeriod = (index: number) => {
    if (index === periodIndex) return;
    setPeriodIndex(index);
    const target = periods[index].used;
    cancelAnimationFrame(tweenRef.current);
    if (reduced) {
      setUsedShown(target);
      return;
    }
    const from = usedShown;
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const t = Math.min(1, (now - start) / 600);
      setUsedShown(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) tweenRef.current = requestAnimationFrame(tick);
    };
    tweenRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(tweenRef.current), []);

  useEffect(() => {
    const element = ref.current;
    if (!element || reduced) return;
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1400);
        setProgress(1 - Math.pow(1 - t, 3));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const share = (cycleUsed / total) * progress;
  const filled = Math.round(share * SEGMENTS);
  const peak = Math.max(...period.bars);
  const average = period.used / period.bars.length;

  return (
    <div ref={ref} className={styles.usage}>
      <div className={styles.usageHead}>
        <div>
          <h4>{copy.usageTitle}</h4>
          <p>{copy.usageLead(total)}</p>
        </div>
        <div className={styles.cycle} aria-label={copy.cycleUsed(Math.round(share * 100))}>
          <span className={styles.reading} style={{ left: `${(Math.max(filled, 1) / SEGMENTS) * 100}%` }}>{Math.round(share * 100)}%</span>
          <span className={styles.segments} aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <i key={index} data-on={index < filled ? "" : undefined} style={{ opacity: index < filled ? 0.35 + (0.65 * (index + 1)) / Math.max(filled, 1) : undefined }} />
            ))}
          </span>
        </div>
      </div>

      <div className={styles.histogram} aria-hidden="true">
        {period.bars.map((value, index) => (
          <i
            key={`${period.id}-${index}`}
            data-last={index === period.bars.length - 1 ? "" : undefined}
            style={{ height: `${(value / peak) * 100 * progress}%`, animationDelay: `${Math.round((index / period.bars.length) * 320)}ms` }}
          />
        ))}
        <span key={period.id} className={styles.average}>{copy.average(copy[period.unit], average.toFixed(1))}</span>
      </div>

      <dl className={styles.stats}>
        <div>
          <dt>{copy.used(copy.periods[period.id])}</dt>
          <dd><strong>{(usedShown * progress).toFixed(1)}</strong><small>GB</small><Change key={period.id} value={period.change} /></dd>
        </div>
        <div>
          <dt>{copy.remaining}</dt>
          <dd><strong>{(total - cycleUsed * progress).toFixed(1)}</strong><small>GB</small></dd>
        </div>
        <div>
          <dt>{copy.validity}</dt>
          <dd><strong>{Math.round(daysLeft * progress)}</strong><small>{copy.days}</small></dd>
        </div>
      </dl>

      <div className={styles.usageFoot}>
        <span className={styles.sampleNote}>{copy.sample}</span>
        <div className={styles.periods} role="tablist" aria-label={copy.periodsLabel}>
          {periods.map((item, index) => (
            <button key={item.id} type="button" role="tab" aria-selected={index === periodIndex} onClick={() => switchPeriod(index)}>
              {copy.periods[item.id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
