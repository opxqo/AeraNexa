"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, Clapperboard, Gauge, Sparkles } from "lucide-react";
import { siClaude, siGithub, siGithubcopilot, siGoogle, siGooglegemini, siHbomax, siNetflix, siPerplexity, siSpotify, siTiktok, siX, siYoutube } from "simple-icons";
import { WorldMapCap } from "@/components/world-map-cap";
import { drawComet } from "@/lib/demo/cap-comet";
import { chatgpt, disneyPlus, grok, midjourney, primeVideo, type BrandIcon } from "@/lib/brand-icons";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-unlock.module.css";

// First block of /demo/features, laid out after cloudflare.com's "Fighting
// infra with 'cloud' / Shipping with Cloudflare" block (#home-waveform) and
// read left to right: requests from AI and streaming services → the node
// group that serves each kind → a node on the globe.
//
// - Requests fly (Web Animations API) from the left into their group's
//   input port, where they are absorbed: the port rings, the group's count
//   goes up.
// - Each absorbed request sends a comet (the home page's, drawComet) from
//   the group's output port to a city on the globe that is in view; it lands
//   with a ring, and the status chip names the service and the city.
//
// The site owner confirmed every service listed is tested on the nodes; the
// request lines, node counts and latencies are illustrations. The Clash
// subscription today only has the "节点选择" and "自动选择" groups; the AI and
// streaming groups are on the backlog (docs/backlog.md).
//
// On its own (FeatureUnlock, /demo/features and narrow screens) the stage
// sticks while its track scrolls past, a flat cap curls into a globe that
// settles on the right, and the left two columns fade in near the end (--p
// drives the map, --q the rest; no re-renders). On the home page
// (HomeRelay) the hero's own map makes that trip instead: UnlockContent is
// rendered without a map, around an empty slot the hero map lands in.

type GroupId = "ai" | "media" | "auto";
type Copy = (typeof featureCopy)[HomeLocale]["unlock"];

type Request = { name: string; brand: string; icon: BrandIcon; host: string; call: string; group: GroupId };

const si = (icon: { path: string }): BrandIcon => ({ path: icon.path });

const REQUESTS: Request[] = [
  { name: "ChatGPT", brand: "#10A37F", icon: chatgpt, host: "chatgpt.com", call: "POST /backend-api/conversation", group: "ai" },
  { name: "Netflix", brand: `#${siNetflix.hex}`, icon: si(siNetflix), host: "www.netflix.com", call: "GET /watch · 4K HDR", group: "media" },
  { name: "Claude", brand: `#${siClaude.hex}`, icon: si(siClaude), host: "claude.ai", call: "POST /api/append_message", group: "ai" },
  { name: "YouTube", brand: `#${siYoutube.hex}`, icon: si(siYoutube), host: "www.youtube.com", call: "GET /watch · Premium", group: "media" },
  { name: "Google", brand: "#4285F4", icon: si(siGoogle), host: "www.google.com", call: "GET /search", group: "auto" },
  { name: "Gemini", brand: `#${siGooglegemini.hex}`, icon: si(siGooglegemini), host: "gemini.google.com", call: "POST /app", group: "ai" },
  { name: "Disney+", brand: "#113CCF", icon: disneyPlus, host: "www.disneyplus.com", call: "GET /play · 1080p", group: "media" },
  { name: "Perplexity", brand: `#${siPerplexity.hex}`, icon: si(siPerplexity), host: "www.perplexity.ai", call: "POST /rest/sse/perplexity_ask", group: "ai" },
  { name: "Spotify", brand: `#${siSpotify.hex}`, icon: si(siSpotify), host: "open.spotify.com", call: "GET /track", group: "media" },
  { name: "GitHub", brand: "#262626", icon: si(siGithub), host: "github.com", call: "GET /explore", group: "auto" },
  { name: "GitHub Copilot", brand: "#262626", icon: si(siGithubcopilot), host: "api.githubcopilot.com", call: "POST /chat/completions", group: "ai" },
  { name: "Prime Video", brand: "#00A8E1", icon: primeVideo, host: "www.primevideo.com", call: "GET /detail · 4K", group: "media" },
  { name: "Grok", brand: "#262626", icon: grok, host: "grok.com", call: "POST /rest/app-chat", group: "ai" },
  { name: "HBO Max", brand: "#5822B4", icon: si(siHbomax), host: "play.hbomax.com", call: "GET /video · 4K", group: "media" },
  { name: "X", brand: "#262626", icon: si(siX), host: "x.com", call: "GET /home", group: "auto" },
  { name: "Midjourney", brand: "#262626", icon: midjourney, host: "www.midjourney.com", call: "POST /api/submit-jobs", group: "ai" },
  { name: "TikTok", brand: "#262626", icon: si(siTiktok), host: "www.tiktok.com", call: "GET /foryou", group: "media" },
];

// The services named in the strip and the chip: the AI and streaming ones.
const SERVICES = REQUESTS.filter((request) => request.group !== "auto");

type Group = { id: GroupId; icon: ReactNode; strategy: string; latency: number; cities: string[] };

const GROUPS: Group[] = [
  { id: "ai", icon: <Sparkles strokeWidth={1.7} />, strategy: "url-test", latency: 42, cities: ["Los Angeles", "New York", "Tokyo", "Singapore"] },
  { id: "media", icon: <Clapperboard strokeWidth={1.7} />, strategy: "select", latency: 58, cities: ["Los Angeles", "London", "Tokyo", "Singapore"] },
  { id: "auto", icon: <Gauge strokeWidth={1.7} />, strategy: "url-test", latency: 36, cities: [] },
];

// Flight timing (ms).
// Cards fly in horizontal lanes, one card per lane, so they never stack.
const LANES = 4;
const IN_FLIGHT = LANES;     // cards in the air at once
const FLY_MIN = 3000;
const FLY_SPREAD = 2000;
const REST_MIN = 500;
const REST_SPREAD = 1500;
// Comet: flies for BEAM_TRAVEL ms; drawComet's phase puts the hit at 0.4 of
// its cycle, so the cycle is BEAM_TRAVEL / 0.4.
const BEAM_TRAVEL = 1200;
const BEAM_CYCLE = BEAM_TRAVEL / 0.4;
const RING = 700;
// Cloudflare's ease (its design spec): quick start, long soft settle.
const EASE = "cubic-bezier(.19, 1, .22, 1)";

function RequestCard({ request, index, copy }: { request: Request; index: number; copy: Copy }) {
  return (
    <div className={styles.card} data-index={index} data-group={request.group}>
      <div className={styles.bob} style={{ "--bob-time": `${3 + (request.host.length % 4) * 0.7}s` } as CSSProperties}>
        <span className={styles.cardHead}>
          <svg viewBox="0 0 24 24" style={{ color: request.brand }} aria-hidden="true">
            <path d={request.icon.path} fillRule={request.icon.fillRule} />
          </svg>
          <b>{request.group === "auto" ? copy.accelerated : copy.unlocked}</b>
        </span>
        <small className={styles.host}>{request.host}</small>
        <small className={styles.call}>{copy.calls[request.name] ?? request.call}</small>
      </div>
    </div>
  );
}

function NodeGroup({ group, copy }: { group: Group; copy: Copy }) {
  return (
    <div className={styles.group} data-group={group.id}>
      <span className={styles.portIn} aria-hidden="true"><i /></span>
      <div className={styles.groupHead}>
        <span className={styles.groupIcon} aria-hidden="true">{group.icon}</span>
        <b>{copy.groups[group.id].name}</b>
        <code>{group.strategy}</code>
      </div>
      <div className={styles.groupMeta}>
        {copy.groups[group.id].nodes} · {copy.latency} <span data-latency={group.latency}>{group.latency}</span>ms
      </div>
      <div className={styles.groupCount}>{copy.received} <span data-count>0</span></div>
      <span className={styles.portOut} aria-hidden="true" />
    </div>
  );
}

// Dotted bars (a traffic waveform), drawn once; two copies scroll by.
const noise = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
const WAVE_COLUMNS = 80;
const WAVE_STEP = 6;
const WAVE_HEIGHT = 200;
const WAVE_PATH = Array.from({ length: WAVE_COLUMNS }, (_, column) => {
  const level = 0.25 + 0.35 * Math.abs(Math.sin(column * 0.23)) + 0.4 * noise(column + 7) * noise(column + 13);
  const half = Math.max(1, Math.round((level * WAVE_HEIGHT) / WAVE_STEP / 2));
  let d = "";
  for (let row = -half; row <= half; row += 1) d += `M${column * WAVE_STEP} ${WAVE_HEIGHT / 2 + row * WAVE_STEP}h1.5v1.5h-1.5z`;
  return d;
}).join("");
const WAVE_WIDTH = WAVE_COLUMNS * WAVE_STEP;

function Wave() {
  return (
    <svg className={styles.waveCopy} viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`} width={WAVE_WIDTH} height={WAVE_HEIGHT} aria-hidden="true">
      <path d={WAVE_PATH} />
    </svg>
  );
}

// Logo strip along the bottom of the box, after Cloudflare's "And thousands
// more…" wall: every tested service, in its brand colour, scrolling past
// (two copies of the row slide left by half their width, so the loop is
// seamless).
function BrandMarquee({ label }: { label: string }) {
  const row = (copy: number) => (
    <ul className={styles.marqueeRow} aria-hidden={copy > 0 ? true : undefined}>
      {SERVICES.map((service) => (
        <li key={service.name}>
          <svg viewBox="0 0 24 24" style={{ color: service.brand }} aria-hidden="true">
            <path d={service.icon.path} fillRule={service.icon.fillRule} />
          </svg>
          {service.name}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={styles.marquee} aria-label={label}>
      <div className={styles.marqueeView}>
        <div className={styles.marqueeTrack}>{row(0)}{row(1)}</div>
      </div>
    </div>
  );
}

type Beam = { from: HTMLElement; to: HTMLElement; start: number; service: string; city: string; landed: boolean };

// Below this share of the reveal (--q) the block is still hidden behind the
// hero, so arrivals are neither counted nor sent on to the globe.
const SHOWN = 0.5;

/** The header, the box (requests, node groups, comets, status chip, brand
 *  strip) and the fine print. `map` goes at the bottom of the box: the map
 *  itself, or an empty slot the home hero's map lands in. `mapHostRef`
 *  points at whatever holds the map, where the city tags are looked up
 *  (defaults to the box). */
export function UnlockContent({ locale, map, mapHostRef, boxClassName = "" }: { locale: HomeLocale; map: ReactNode; mapHostRef?: RefObject<HTMLElement | null>; boxClassName?: string }) {
  const copy = featureCopy[locale].unlock;
  const boxRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const chip = copy.chip;

  // Requests → groups → globe.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = beamRef.current;
    const context = canvas?.getContext("2d");
    if (!box || !canvas || !context) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 768px)").matches) return;

    const cards = [...box.querySelectorAll<HTMLElement>(`.${styles.card}`)];
    const groupOf = (id: string) => box.querySelector<HTMLElement>(`.${styles.group}[data-group="${id}"]`)!;
    const idle = new Set(cards.keys());
    const freeLanes = new Set(Array.from({ length: LANES }, (_, lane) => lane));
    const timers = new Set<number>();
    const animations = new Set<Animation>();
    const beams: Beam[] = [];
    const counts: Record<string, number> = { ai: 0, media: 0, auto: 0 };
    let order = 0;
    let disposed = false;

    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!disposed) fn();
      }, ms);
      timers.add(id);
    };
    const local = (element: Element) => {
      const r = element.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
    };

    // Cities on the globe that are in view (city layer <li>s, by tag text).
    const visibleCity = (names: string[]) => {
      const host = mapHostRef?.current ?? box;
      const items = [...host.querySelectorAll<HTMLLIElement>("ul[aria-label='Cities'] li")];
      const half = box.getBoundingClientRect().width * 0.575;
      const choices = items.filter((li) => {
        const name = li.textContent?.trim() ?? "";
        if (name === "China") return false;
        if (names.length && !names.includes(name)) return false;
        return Number(li.style.opacity || 1) > 0.6 && local(li).x > half;
      });
      return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
    };

    const receive = (cardIndex: number) => {
      if (Number(getComputedStyle(box).getPropertyValue("--q") || 1) < SHOWN) return;
      const request = REQUESTS[Number(cards[cardIndex].dataset.index)];
      const group = groupOf(request.group);
      counts[request.group] += 1;
      const count = group.querySelector<HTMLElement>("[data-count]");
      if (count) count.textContent = counts[request.group].toLocaleString(locale === "zh" ? "zh-CN" : "en");
      group.querySelector(`.${styles.portIn} i`)?.animate(
        [{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.2)", opacity: 0 }],
        { duration: 650, easing: EASE },
      );
      group.animate([{ borderColor: "rgba(255, 94, 31, .55)" }, { borderColor: "rgba(38, 38, 38, .1)" }], { duration: 700, easing: EASE });
      const target = visibleCity(GROUPS.find((item) => item.id === request.group)!.cities) ?? visibleCity([]);
      const from = group.querySelector<HTMLElement>(`.${styles.portOut}`);
      if (target && from) beams.push({ from, to: target, start: performance.now(), service: request.name, city: target.textContent?.trim() ?? "", landed: false });
    };

    const fly = () => {
      if (!idle.size || !freeLanes.size) return;
      // Cards take turns in a fixed order, skipping ones still in the air.
      let cardIndex = order % cards.length;
      while (!idle.has(cardIndex)) cardIndex = (cardIndex + 1) % cards.length;
      order = cardIndex + 1;
      idle.delete(cardIndex);

      const card = cards[cardIndex];
      const request = REQUESTS[Number(card.dataset.index)];
      const port = local(groupOf(request.group).querySelector(`.${styles.portIn}`)!);
      const { w, h } = local(card);
      // Take a free lane at random and start somewhere inside it.
      const lanes = [...freeLanes];
      const lane = lanes[Math.floor(Math.random() * lanes.length)];
      freeLanes.delete(lane);
      const laneHeight = (box.clientHeight - 40) / LANES;
      const startX = -40 + Math.random() * 200;
      const startY = 20 + lane * laneHeight + Math.max(0, laneHeight - h) * Math.random() - Math.max(0, h - laneHeight) / 2;
      const endX = port.x + port.w / 2 - w / 2;
      const endY = port.y + port.h / 2 - h / 2;
      // Cards hold their lane for most of the way and only converge on the
      // port at the end, shrinking as they do.
      const midX = startX + (endX - startX) * 0.6;
      const midY = startY + (endY - startY) * 0.12;
      const duration = FLY_MIN + Math.random() * FLY_SPREAD;
      const at = (x: number, y: number, scale: number) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale})`;
      const animation = card.animate(
        [
          { transform: at(startX, startY, 0.7), opacity: 0, easing: EASE },
          { transform: at(startX, startY, 1), opacity: 1, offset: 400 / duration, easing: "linear" },
          { transform: at(midX, midY, 1), opacity: 1, offset: 0.6, easing: "ease-in" },
          // Gathers in before the node group column, so it doesn't sprawl over it.
          { transform: at(endX - w * 0.45, endY, 0.55), opacity: 1, offset: 0.82, easing: "ease-in" },
          { transform: at(endX, endY, 0.1), opacity: 0 },
        ],
        { duration, fill: "forwards" },
      );
      animations.add(animation);
      animation.onfinish = () => {
        animations.delete(animation);
        freeLanes.add(lane);
        receive(cardIndex);
        later(() => {
          idle.add(cardIndex);
          fly();
        }, REST_MIN + Math.random() * REST_SPREAD);
      };
    };

    for (let slot = 0; slot < IN_FLIGHT; slot += 1) later(fly, slot * 450);

    // Sample latencies drift a little.
    const drift = window.setInterval(() => {
      box.querySelectorAll<HTMLElement>("[data-latency]").forEach((element) => {
        const base = Number(element.dataset.latency);
        element.textContent = String(Math.round(base + (Math.random() - 0.5) * 10));
      });
    }, 2000);

    // Comets and landing rings.
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (let index = beams.length - 1; index >= 0; index -= 1) {
        const beam = beams[index];
        const elapsed = now - beam.start;
        if (elapsed > BEAM_TRAVEL + RING) {
          beams.splice(index, 1);
          continue;
        }
        const from = local(beam.from);
        const to = local(beam.to);
        const ax = from.x + from.w / 2, ay = from.y + from.h / 2;
        const bx = to.x, by = to.y;
        const cx = (ax + bx) / 2, cy = Math.min(ay, by) - Math.abs(bx - ax) * 0.35;
        const points: number[] = [];
        for (let step = 0; step <= 40; step += 1) {
          const t = step / 40;
          points.push((1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by);
        }
        drawComet(context, points, elapsed / BEAM_CYCLE, 1, 1);
        if (elapsed >= BEAM_TRAVEL) {
          if (!beam.landed) {
            beam.landed = true;
            const chipText = chipRef.current;
            if (chipText) {
              chipText.textContent = chip(beam.service, beam.city);
              chipText.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 400, easing: EASE });
            }
          }
          const t = (elapsed - BEAM_TRAVEL) / RING;
          context.beginPath();
          context.arc(bx, by, 4 + 18 * (1 - Math.pow(1 - t, 3)), 0, Math.PI * 2);
          context.strokeStyle = `rgba(255, 72, 0, ${0.8 * (1 - t)})`;
          context.lineWidth = 1.5;
          context.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      timers.forEach((id) => clearTimeout(id));
      animations.forEach((animation) => animation.cancel());
      clearInterval(drift);
      cancelAnimationFrame(frame);
    };
  }, [chip, locale, mapHostRef]);

  return (
    <>
      <header className={styles.head}>
        <h2>{copy.title}</h2>
        <p>{copy.lead}</p>
      </header>

      <div className={styles.boxWrap}>
        <span className={styles.ticks} aria-hidden="true"><i /><i /><i /><i /></span>
        <div ref={boxRef} className={`${styles.box} ${boxClassName}`}>
          {map}

          <div className={styles.wave} aria-hidden="true"><div className={styles.waveTrack}><Wave /><Wave /></div></div>

          <div className={styles.groupsCol}>
            <span className={styles.colLabel}>{copy.groupsLabel} <small>{copy.sample}</small></span>
            {GROUPS.map((group) => <NodeGroup key={group.id} group={group} copy={copy} />)}
          </div>

          <canvas ref={beamRef} className={styles.beams} aria-hidden="true" />

          <div className={styles.flyLayer} aria-hidden="true">
            {REQUESTS.map((request, index) => <RequestCard key={request.name} request={request} index={index} copy={copy} />)}
          </div>
          <ul className={styles.srList} aria-label={copy.servicesLabel}>
            {SERVICES.map((service) => <li key={service.name}>{service.name}</li>)}
          </ul>

          <div className={styles.status}>
            <span className={styles.line} aria-hidden="true" />
            <span className={styles.chip}>
              <Check size={16} strokeWidth={2} aria-hidden="true" />
              <span className={styles.roll}><span ref={chipRef}>{copy.chipIdle}</span></span>
            </span>
          </div>
        </div>
        <BrandMarquee label={copy.marqueeLabel} />
      </div>
      <p className={styles.fine}>{copy.fine}</p>
    </>
  );
}

/** The block on its own, with its own map: /demo/features, and the home
 *  page on narrow screens or with reduced motion. */
export function FeatureUnlock({ locale }: { locale: HomeLocale }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const curlRef = useRef(0);

  // Scroll → curl and reveal.
  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return;
    const narrow = window.matchMedia("(max-width: 768px), (prefers-reduced-motion: reduce)");
    const update = () => {
      let progress = 1;
      // Narrow screens skip the scroll effect and show the globe as is.
      if (!narrow.matches) {
        const { top, height } = track.getBoundingClientRect();
        const distance = height - window.innerHeight;
        progress = distance > 0 ? Math.min(1, Math.max(0, -top / distance)) : 1;
      }
      const p = progress * progress * (3 - 2 * progress);
      curlRef.current = p;
      stage.style.setProperty("--p", p.toFixed(4));
      // The left columns come in once the globe has shrunk clear of them.
      stage.style.setProperty("--q", Math.min(1, Math.max(0, (p - 0.78) / 0.22)).toFixed(4));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    narrow.addEventListener("change", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      narrow.removeEventListener("change", update);
    };
  }, []);

  return (
    <div ref={trackRef} className={`${styles.scope} ${styles.track}`}>
      <div ref={stageRef} className={styles.stage}>
        <UnlockContent
          locale={locale}
          map={(
            <div className={styles.map}>
              <WorldMapCap curlRef={curlRef} graticule routes={false} label={featureCopy[locale].unlock.mapLabel} />
            </div>
          )}
        />
      </div>
    </div>
  );
}
