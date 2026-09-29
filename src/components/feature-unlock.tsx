"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { siClaude, siGithubcopilot, siGooglegemini, siHbomax, siNetflix, siPerplexity, siSpotify, siTiktok, siYoutube } from "simple-icons";
import { WorldMapCap } from "@/components/world-map-cap";
import type { CapTrip } from "@/components/world-map-cap-city-layer";
import { PACKET, drawComet } from "@/lib/demo/cap-comet";
import { chatgpt, disneyPlus, grok, midjourney, primeVideo, type BrandIcon } from "@/lib/brand-icons";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-unlock.module.css";

// First block of the home page (and /demo/features): every AI and streaming
// service we unlock, next to the globe that unlocks it.
//
// One request at a time tells the story, on fixed rails (nothing drifts):
//   1. a request card slides along a rail on the left to its port;
//   2. a small packet flies from the port to China on the globe (a ring
//      there says "received");
//   3. an orange comet (the home page's) flies from China to a city that is
//      in view and lands with a shockwave;
//   4. a green pulse flies back from the city to China and ends in a green
//      ring — the request succeeded;
//   5. the card turns green ("200 · via Tokyo · 52ms") and fades out.
// Steps 3–4 are the map's own round trip (`tripRef`, see CapTrip).
//
// So that China and the city are always in view together, the globe is
// steered (`steerRef`): the requests are told in two scenes, the AI services
// over Asia-Pacific and the streaming services over Eurasia, and the globe
// turns from one to the other between them.
//
// The site owner confirmed every service listed is tested on the nodes; the
// requests and latencies are illustrations.
//
// On its own (FeatureUnlock, /demo/features and narrow screens) the stage
// sticks while its track scrolls past, a flat cap curls into a globe that
// settles on the right, and the rails come in near the end (--p drives the
// map, --q the rest; no re-renders). On the home page (HomeRelay) the hero's
// own map makes that trip instead: UnlockContent is rendered without a map,
// around an empty slot the hero map lands in.

type Request = { name: string; brand: string; icon: BrandIcon; host: string; call: string; scene: number };

const si = (icon: { path: string }): BrandIcon => ({ path: icon.path });

// Scene 0 (AI services, Asia-Pacific) then scene 1 (streaming, Eurasia).
const REQUESTS: Request[] = [
  { name: "ChatGPT", brand: "#10A37F", icon: chatgpt, host: "chatgpt.com", call: "POST /backend-api/conversation", scene: 0 },
  { name: "Claude", brand: `#${siClaude.hex}`, icon: si(siClaude), host: "claude.ai", call: "POST /api/append_message", scene: 0 },
  { name: "Gemini", brand: `#${siGooglegemini.hex}`, icon: si(siGooglegemini), host: "gemini.google.com", call: "POST /app", scene: 0 },
  { name: "Perplexity", brand: `#${siPerplexity.hex}`, icon: si(siPerplexity), host: "www.perplexity.ai", call: "POST /rest/sse/perplexity_ask", scene: 0 },
  { name: "GitHub Copilot", brand: "#262626", icon: si(siGithubcopilot), host: "api.githubcopilot.com", call: "POST /chat/completions", scene: 0 },
  { name: "Grok", brand: "#262626", icon: grok, host: "grok.com", call: "POST /rest/app-chat", scene: 0 },
  { name: "Midjourney", brand: "#262626", icon: midjourney, host: "www.midjourney.com", call: "POST /api/submit-jobs", scene: 0 },
  { name: "Netflix", brand: `#${siNetflix.hex}`, icon: si(siNetflix), host: "www.netflix.com", call: "GET /watch", scene: 1 },
  { name: "YouTube", brand: `#${siYoutube.hex}`, icon: si(siYoutube), host: "www.youtube.com", call: "GET /watch", scene: 1 },
  { name: "Disney+", brand: "#113CCF", icon: disneyPlus, host: "www.disneyplus.com", call: "GET /play", scene: 1 },
  { name: "Prime Video", brand: "#00A8E1", icon: primeVideo, host: "www.primevideo.com", call: "GET /detail", scene: 1 },
  { name: "HBO Max", brand: "#5822B4", icon: si(siHbomax), host: "play.hbomax.com", call: "GET /video", scene: 1 },
  { name: "Spotify", brand: `#${siSpotify.hex}`, icon: si(siSpotify), host: "open.spotify.com", call: "GET /track", scene: 1 },
  { name: "TikTok", brand: "#262626", icon: si(siTiktok), host: "www.tiktok.com", call: "GET /foryou", scene: 1 },
];

// Where the globe looks (the longitude kept at the middle) and where the
// requests may land. Both ends of a trip must be in view, and the globe only
// turns about its axis, so a scene can only show cities within about 60° of
// longitude of its centre: the Asia-Pacific scene keeps China near the middle
// (and close to the rails), the Eurasia scene brings Europe and Africa round.
// (The Americas can't share a view with China without hugging the limb.)
const SCENES = [
  { center: 128, cities: ["Tokyo", "Singapore", "Sydney", "Mumbai"] },
  { center: 62, cities: ["London", "Frankfurt", "Johannesburg", "Mumbai", "Singapore"] },
];
// Sample round-trip times (ms).
const RTT: Record<string, number> = { Tokyo: 52, Singapore: 61, Sydney: 132, Mumbai: 96, London: 186, Frankfurt: 178, Johannesburg: 224 };
const latency = (city: string, index: number) => (RTT[city] ?? 100) + ((index * 7) % 9) - 4;

// Layout of the rails (px): five, 64 apart, centred in the box; the card
// stops with its right edge just short of the port.
const LANES = 5;
const LANE_PITCH = 64;
const CARD_HEIGHT = 48;
const CARD_LEFT = 24;

// Timing (ms). A packet flies for PACKET_TRAVEL; drawComet's phase puts its
// hit at 0.4 of its cycle, so the cycle is PACKET_TRAVEL / 0.4.
const SLIDE = 800;
const PACKET_TRAVEL = 900;
const PACKET_CYCLE = PACKET_TRAVEL / 0.4;
const HOLD = 900;
const SPACING = 2200;
const PER_SCENE = 5;
const SETTLE = 4000;
const PAN = 2000;
const FIRST = 1200;
const EASE = "cubic-bezier(.32, .72, 0, 1)";
// Below this share of the reveal (--q) the block is still hidden behind the
// hero: no requests start, and the globe turns as usual.
const SHOWN = 0.5;

// Motion is for wide screens without a reduced-motion preference; elsewhere
// the globe turns with the home page's own comets instead.
const MOTION = "(min-width: 769px) and (prefers-reduced-motion: no-preference)";

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION).matches, () => true);
}

/** The two ways the block drives its globe (see WorldMapCap): `steerRef`
 *  holds the longitude to keep in the middle, `tripRef` plays a round trip. */
export type GlobeLink = {
  steerRef: RefObject<number | null>;
  tripRef: RefObject<((trip: CapTrip) => boolean) | null>;
};

export function useGlobeLink(): GlobeLink {
  const steerRef = useRef<number | null>(null);
  const tripRef = useRef<((trip: CapTrip) => boolean) | null>(null);
  return { steerRef, tripRef };
}

function Logo({ request }: { request: Request }) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: request.brand }} aria-hidden="true">
      <path d={request.icon.path} fillRule={request.icon.fillRule} />
    </svg>
  );
}

function RequestCard({ request, index }: { request: Request; index: number }) {
  return (
    <div className={styles.req} data-index={index} data-state="idle">
      <Logo request={request} />
      <span className={styles.reqText}>
        <b>{request.host}</b>
        <small>{request.call}</small>
      </span>
      <span className={styles.mark}><Check size={11} strokeWidth={3} aria-hidden="true" /></span>
    </div>
  );
}

// Logo strip along the bottom of the box, after Cloudflare's "And thousands
// more…" wall: every tested service, in its brand colour, scrolling past
// (two copies of the row slide left by half their width, so the loop is
// seamless).
function BrandMarquee({ label }: { label: string }) {
  const row = (copy: number) => (
    <ul className={styles.marqueeRow} aria-hidden={copy > 0 ? true : undefined}>
      {REQUESTS.map((request) => (
        <li key={request.name}>
          <Logo request={request} />
          {request.name}
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

// A small orange packet from a rail's port to China; `start` is stamped by
// the draw loop on the first frame it sees the packet.
type Packet = { from: HTMLElement; start: number | null };

/** The header, the box (rails and requests, comets, the globe's steering, the
 *  brand strip) and the fine print. `map` goes at the bottom of the box: the
 *  map itself, or an empty slot the home hero's map lands in. `mapHostRef`
 *  points at whatever holds the map, where the city tags are looked up
 *  (defaults to the box). */
export function UnlockContent({ locale, link, map, mapHostRef, boxClassName = "" }: { locale: HomeLocale; link: GlobeLink; map: ReactNode; mapHostRef?: RefObject<HTMLElement | null>; boxClassName?: string }) {
  const copy = featureCopy[locale].unlock;
  const boxRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);
  const { steerRef, tripRef } = link;
  const done = copy.done;

  useEffect(() => {
    const box = boxRef.current;
    const canvas = beamRef.current;
    const context = canvas?.getContext("2d");
    if (!box || !canvas || !context) return;
    if (!window.matchMedia(MOTION).matches) return;

    const cards = [...box.querySelectorAll<HTMLElement>(`.${styles.req}`)];
    const ports = [...box.querySelectorAll<HTMLElement>(`.${styles.port}`)];
    const sceneCards = SCENES.map((_, scene) => cards.flatMap((_card, index) => (REQUESTS[index].scene === scene ? [index] : [])));
    const idle = new Set(cards.keys());
    const freeLanes = new Set(ports.keys());
    const cursors = SCENES.map(() => 0);
    const cityCursors = SCENES.map(() => 0);
    const timers = new Set<number>();
    const packets: Packet[] = [];
    let laneTurn = 0;
    let scene = 0;
    let disposed = false;
    let hub: HTMLElement | null = null;

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
    const shown = () => Number(getComputedStyle(box).getPropertyValue("--q") || 1) >= SHOWN;
    // China's marker on the globe (the city layer's <li>, by its hidden text).
    const findHub = () => {
      hub ??= [...(mapHostRef?.current ?? box).querySelectorAll<HTMLLIElement>("ul[aria-label='Cities'] li")].find((li) => li.textContent?.trim() === "China") ?? null;
      return hub;
    };

    const release = (cardIndex: number, lane: number) => {
      const card = cards[cardIndex];
      card.getAnimations().forEach((animation) => animation.cancel());
      card.dataset.state = "idle";
      const port = ports[lane];
      delete port.dataset.ok;
      idle.add(cardIndex);
      freeLanes.add(lane);
    };

    // The card leaves: a short drift right and a fade.
    const leave = (cardIndex: number, lane: number, dx: number) => {
      const card = cards[cardIndex];
      card.animate([{ transform: `translateX(${dx}px)` }, { transform: `translateX(${dx + 12}px)` }], { duration: 400, easing: EASE, fill: "forwards" });
      const fadeOut = card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: "ease-out", fill: "forwards" });
      fadeOut.onfinish = () => {
        if (!disposed) release(cardIndex, lane);
      };
    };

    // Hand the request to the globe: try the scene's cities in turn until one
    // is in view together with China (a pan in progress may need a moment).
    const send = (cardIndex: number, lane: number, sceneIndex: number, dx: number, tries: number) => {
      const cities = SCENES[sceneIndex].cities;
      for (let step = 0; step < cities.length; step += 1) {
        const city = cities[(cityCursors[sceneIndex] + step) % cities.length];
        const trip: CapTrip = {
          city,
          onReturn: () => {
            if (disposed) return;
            const card = cards[cardIndex];
            card.dataset.state = "ok";
            const result = card.querySelector<HTMLElement>("small");
            if (result) {
              result.textContent = done(city, latency(city, cardIndex));
              result.animate([{ transform: "translateY(60%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 400, easing: EASE });
            }
            const port = ports[lane];
            port.dataset.ok = "";
            port.querySelector("span")?.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.2)", opacity: 0 }], { duration: 650, easing: EASE });
            later(() => leave(cardIndex, lane, dx), HOLD);
          },
        };
        if (tripRef.current?.(trip)) {
          cityCursors[sceneIndex] = (cityCursors[sceneIndex] + step + 1) % cities.length;
          return;
        }
      }
      if (tries < 3) later(() => send(cardIndex, lane, sceneIndex, dx, tries + 1), 350);
      else leave(cardIndex, lane, dx);
    };

    const startRequest = () => {
      const pool = sceneCards[scene];
      let cardIndex = -1;
      for (let step = 0; step < pool.length; step += 1) {
        const candidate = pool[(cursors[scene] + step) % pool.length];
        if (idle.has(candidate)) {
          cardIndex = candidate;
          cursors[scene] = (cursors[scene] + step + 1) % pool.length;
          break;
        }
      }
      let lane = -1;
      for (let step = 0; step < LANES; step += 1) {
        const candidate = (laneTurn + step) % LANES;
        if (freeLanes.has(candidate)) {
          lane = candidate;
          laneTurn = candidate + 1;
          break;
        }
      }
      if (cardIndex < 0 || lane < 0) return;
      idle.delete(cardIndex);
      freeLanes.delete(lane);

      const card = cards[cardIndex];
      const port = ports[lane];
      const portBox = local(port);
      // The card slides in from the rail's start and stops just short of the port.
      const dx = portBox.x + portBox.w / 2 - 10 - CARD_LEFT - card.offsetWidth;
      card.style.top = `${portBox.y + portBox.h / 2 - CARD_HEIGHT / 2}px`;
      const result = card.querySelector<HTMLElement>("small");
      if (result) result.textContent = REQUESTS[cardIndex].call;
      card.dataset.state = "pending";
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out", fill: "forwards" });
      card.animate([{ transform: "translateX(-24px)" }, { transform: `translateX(${dx}px)` }], { duration: SLIDE, easing: EASE, fill: "forwards" });

      const sceneIndex = scene;
      later(() => {
        // At the port: it rings, and a packet leaves for China.
        port.querySelector("span")?.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.2)", opacity: 0 }], { duration: 650, easing: EASE });
        packets.push({ from: port, start: null });
        later(() => send(cardIndex, lane, sceneIndex, dx, 0), PACKET_TRAVEL);
      }, SLIDE);
    };

    // Scenes: PER_SCENE requests, a wait for the last answers, then the globe
    // turns to the next scene (no new requests while it does).
    const step = (index: number, count: number) => {
      if (!shown()) {
        later(() => step(index, count), 500);
        return;
      }
      if (count < PER_SCENE) {
        startRequest();
        later(() => step(index, count + 1), SPACING);
        return;
      }
      later(() => {
        scene = (index + 1) % SCENES.length;
        later(() => step(scene, 0), PAN);
      }, SETTLE);
    };
    later(() => step(0, 0), FIRST);

    // The globe's steering and the packets, drawn on this box's own canvas.
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Look at the current scene, swaying a little; released when hidden.
      steerRef.current = shown() ? SCENES[scene].center + 8 * Math.sin(((now / 1000) * Math.PI * 2) / 20) : null;

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
      const target = findHub();
      for (let index = packets.length - 1; index >= 0; index -= 1) {
        const packet = packets[index];
        if (packet.start === null) packet.start = now;
        const elapsed = now - packet.start;
        if (!target || elapsed > PACKET_TRAVEL + 250) {
          packets.splice(index, 1);
          continue;
        }
        const from = local(packet.from);
        const to = local(target);
        const ax = from.x + from.w / 2, ay = from.y + from.h / 2;
        const bx = to.x, by = to.y;
        // A gentle arc, so the packets fan in to China rather than run in parallel.
        const cx = (ax + bx) / 2, cy = Math.min(ay, by) - Math.abs(bx - ax) * 0.14 - 12;
        const points: number[] = [];
        for (let stepIndex = 0; stepIndex <= 32; stepIndex += 1) {
          const t = stepIndex / 32;
          points.push((1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by);
        }
        drawComet(context, points, elapsed / PACKET_CYCLE, 1, 1, PACKET);
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      timers.forEach((id) => clearTimeout(id));
      cancelAnimationFrame(frame);
      steerRef.current = null;
      cards.forEach((card) => {
        card.getAnimations().forEach((animation) => animation.cancel());
        card.dataset.state = "idle";
      });
      ports.forEach((port) => delete port.dataset.ok);
    };
  }, [done, mapHostRef, steerRef, tripRef]);

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

          <div className={styles.rails} aria-hidden="true">
            {Array.from({ length: LANES }, (_, lane) => (
              <span key={lane} className={styles.rail} style={{ top: `calc(50% + ${(lane - (LANES - 1) / 2) * LANE_PITCH}px)` }}>
                <i className={styles.port}><span /></i>
              </span>
            ))}
          </div>

          <canvas ref={beamRef} className={styles.beams} aria-hidden="true" />

          <div className={styles.reqLayer} aria-hidden="true">
            {REQUESTS.map((request, index) => <RequestCard key={request.name} request={request} index={index} />)}
          </div>
          <ul className={styles.srList} aria-label={copy.requestsLabel}>
            {REQUESTS.map((request) => <li key={request.name}>{request.name}</li>)}
          </ul>

          <div className={styles.legend} aria-hidden="true">
            <span data-tone="out"><i />{copy.legendRequest}</span>
            <span data-tone="ok"><i />{copy.legendBack}</span>
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
  const link = useGlobeLink();
  const motion = useMotion();

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
      // The rails come in once the globe has shrunk clear of them.
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
          link={link}
          map={(
            <div className={styles.map}>
              <WorldMapCap curlRef={curlRef} graticule routes={!motion} steerRef={link.steerRef} tripRef={link.tripRef} label={featureCopy[locale].unlock.mapLabel} />
            </div>
          )}
        />
      </div>
    </div>
  );
}
