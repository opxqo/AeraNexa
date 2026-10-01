"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { siClaude, siGithubcopilot, siGooglegemini, siHbomax, siNetflix, siPerplexity, siSpotify, siTiktok, siYoutube } from "simple-icons";
import { WorldGlobe } from "@/components/world-globe";
import { WorldMapCap } from "@/components/world-map-cap";
import type { CapTrip } from "@/components/world-map-cap-city-layer";
import { GREEN_PACKET, PACKET, TRAVEL, drawComet, type CometStyle } from "@/lib/demo/cap-comet";
import { CAP_GLOBE_FILL } from "@/lib/demo/cap-projection";
import { fluidPath, playPulse, pulseDuration } from "@/lib/demo/flow-line";
import { chatgpt, disneyPlus, grok, midjourney, primeVideo, type BrandIcon } from "@/lib/brand-icons";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-unlock.module.css";

// First block of the home page (and /demo/features): every AI and streaming
// service we unlock, next to the globe that unlocks it.
//
// The left half is a node graph, after the one on flora.ai (see
// src/lib/demo/flow-line.ts for how its links are drawn): four service
// nodes, joined by curved links to one routing node, which is joined by two
// more to a ring around the globe: a request link into its upper port and a
// response link out of its lower one. The nodes can be dragged (the links
// follow); the globe and its ring stay put. A request runs the whole way and
// back, and lights the links as it goes:
//   1. the service node lights up; an orange pulse runs along its link into
//      the routing node, which shows the rule it matched and the city it
//      picked;
//   2. an orange pulse runs on along the request link to the ring's upper
//      port, and a small packet flies from there to China (a ring there says
//      "received");
//   3. an orange comet (the home page's) flies from China to the city and
//      lands with a shockwave; a green pulse flies back to China — the map's
//      own round trip (`tripRef`, see CapTrip);
//   4. a green packet flies from China to the ring's lower port, and green
//      pulses run back along the response link and the service node's link to
//      the service node, which turns green:
//      "200 · Tokyo · 52ms".
//
// So that China and the city are always in view together, the globe is
// steered (`steerRef`): the requests are told in two scenes, the AI services
// over Asia-Pacific and the streaming services over Eurasia, and the globe
// turns from one to the other between them.
//
// The site owner confirmed every service listed is tested on the nodes; the
// requests, the routing and the latencies are illustrations.
//
// On its own (FeatureUnlock, /demo/features and narrow screens) the stage
// sticks while its track scrolls past, a flat cap curls into a globe that
// settles on the right, and the graph comes in near the end (--p drives the
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
// (and close to the ring's ports), the Eurasia scene brings Europe and Africa
// round. (The Americas can't share a view with China without hugging the limb.)
const SCENES = [
  { group: "ai", center: 128, cities: ["Tokyo", "Singapore", "Sydney", "Mumbai"] },
  { group: "media", center: 62, cities: ["London", "Frankfurt", "Johannesburg", "Mumbai", "Singapore"] },
] as const;
// Sample round-trip times (ms).
const RTT: Record<string, number> = { Tokyo: 52, Singapore: 61, Sydney: 132, Mumbai: 96, London: 186, Frankfurt: 178, Johannesburg: 224 };
const latency = (city: string, index: number) => (RTT[city] ?? 100) + ((index * 7) % 9) - 4;

// The graph. Four service nodes sit in a column; a node is a 16px label row,
// a 4px gap and a 48px card (keep in step with .slot, .nodeLabel, .nodeCard
// in the CSS), and its link leaves the card's right edge at mid-height.
const SLOTS = 4;
const LINK_OFFSET = 16 + 4 + 48 / 2;
// The two links from the routing node to the globe's ring come after the
// four slots': the request link (into the upper port), the response link
// (out of the lower one).
const REQ_LINK = SLOTS;
const RES_LINK = SLOTS + 1;
// The ring stands this far outside the globe's edge (px). Its ports sit this
// many degrees above and below due west; the two links leave the routing node
// this far above and below its mid-height (px).
const RING_GAP = 14;
const PORT_ANGLE = 24;
const GATE_SPREAD = 12;

// Timing (ms). A request goes: pulse into the routing node (after a short
// lead), a beat, pulse on to the ring, a packet to China (PACKET_OUT), then the
// map's round trip, a packet home (PACKET_BACK) and the pulses back.
const LEAD = 250;
const BEAT = 150;
const PACKET_OUT = 700;
const PACKET_BACK = 600;
const HOLD = 900;
// A request that hasn't come home after this long (the page was hidden, say)
// is dropped, so its slot is not held for ever.
const WATCHDOG = 20000;
// One request every SPACING; a scene is PER_SCENE requests, then SETTLE for the
// last one to come home before the globe turns (PAN) to the next scene.
const SPACING = 2400;
const PER_SCENE = 5;
const SETTLE = 5400;
const PAN = 2000;
const FIRST = 1200;
const EASE = "cubic-bezier(.32, .72, 0, 1)";
const ORANGE = "#f45300";
const GREEN = "#22c55e";
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

// A service node: a label row (name, kind) over a card (logo, host, request
// line, state mark), like flora.ai's nodes.
function ServiceNode({ request, index, tag }: { request: Request; index: number; tag: string }) {
  return (
    <div className={styles.node} data-index={index} data-state="idle">
      <span className={styles.nodeLabel}><b>{request.name}</b><small>{tag}</small></span>
      <span className={styles.nodeCard}>
        <Logo request={request} />
        <span className={styles.nodeText}>
          <b>{request.host}</b>
          <small>{request.call}</small>
        </span>
        <span className={styles.mark}><Check size={11} strokeWidth={3} aria-hidden="true" /></span>
      </span>
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

// A small packet between a port on the ring and China, drawn on the box's own
// canvas; `start` is stamped by the draw loop on the first frame it sees it.
type Packet = { from: HTMLElement; to: HTMLElement; style: CometStyle; duration: number; start: number | null };

// One request on its way: which slot and node, which city, and whether it is over.
type Job = { slot: number; node: number; city: string; ms: number; done: boolean };

/** The header, the box (the node graph, comets, the globe's steering, the
 *  brand strip) and the fine print. `map` goes at the bottom of the box: the
 *  map itself, or an empty slot the home hero's map lands in. `mapHostRef`
 *  points at whatever holds the map: its city tags are looked up there, and
 *  the globe's outline is measured from it (defaults to the box). */
export function UnlockContent({ locale, link, map, mapHostRef, visibleRef, boxClassName = "" }: { locale: HomeLocale; link: GlobeLink; map: ReactNode; mapHostRef?: RefObject<HTMLElement | null>; visibleRef?: RefObject<boolean>; boxClassName?: string }) {
  const copy = featureCopy[locale].unlock;
  const boxRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<SVGSVGElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const portInRef = useRef<HTMLElement>(null);
  const portOutRef = useRef<HTMLElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const { steerRef, tripRef } = link;

  useEffect(() => {
    const box = boxRef.current;
    const canvas = beamRef.current;
    const context = canvas?.getContext("2d");
    const pulses = pulseRef.current;
    const gate = gateRef.current;
    const portIn = portInRef.current;
    const portOut = portOutRef.current;
    const ringLine = ringRef.current;
    const gateCard = gate?.querySelector<HTMLElement>(`.${styles.gwCard}`);
    const gateRule = gate?.querySelector<HTMLElement>("[data-row='rule']");
    const gateExit = gate?.querySelector<HTMLElement>("[data-row='exit']");
    if (!box || !canvas || !context || !pulses || !gate || !portIn || !portOut || !ringLine || !gateCard || !gateRule || !gateExit) return;
    if (!window.matchMedia(MOTION).matches) return;

    const nodes = [...box.querySelectorAll<HTMLElement>(`.${styles.node}`)];
    const slots = [...box.querySelectorAll<HTMLElement>(`.${styles.slot}`)];
    const links = [...box.querySelectorAll<SVGPathElement>(`.${styles.links} path`)];
    const sceneNodes = SCENES.map((_, scene) => nodes.flatMap((_node, index) => (REQUESTS[index].scene === scene ? [index] : [])));
    // What each slot shows, whether that service has not been used yet, and
    // whether a request is still under way in it.
    const slotNode: (number | null)[] = slots.map(() => null);
    const slotFresh = slots.map(() => false);
    const slotBusy = slots.map(() => false);
    // How far each slot's node, and the routing node, have been dragged.
    const slotShift = slots.map(() => ({ x: 0, y: 0 }));
    const gateShift = { x: 0, y: 0 };
    const onShow = new Set<number>();
    const cursors = SCENES.map(() => 0);
    const cityCursors = SCENES.map(() => 0);
    const timers = new Set<number>();
    const packets: Packet[] = [];
    let slotTurn = 0;
    let scene = 0;
    let disposed = false;
    let hub: HTMLElement | null = null;
    let inView = false;
    const visibilityObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; });
    visibilityObserver.observe(box);

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
    const shown = () => inView && visibleRef?.current !== false && Number(getComputedStyle(box).getPropertyValue("--q") || 1) >= SHOWN;
    // China's marker on the globe (the city layer's <li>, by its hidden text).
    const hubElement = () => {
      hub ??= [...(mapHostRef?.current ?? box).querySelectorAll<HTMLLIElement>("ul[aria-label='Cities'] li")].find((li) => li.textContent?.trim() === "China") ?? null;
      return hub;
    };

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    // Where a slot's node stands: its slot moved by how far it was dragged,
    // kept inside the box.
    const nodeBox = (slot: number) => {
      const r = local(slots[slot]);
      return { ...r, x: clamp(r.x + slotShift[slot].x, 0, Math.max(0, box.clientWidth - r.w)), y: clamp(r.y + slotShift[slot].y, 0, Math.max(0, box.clientHeight - r.h)) };
    };
    const place = (slot: number, nodeIndex: number) => {
      const r = nodeBox(slot);
      const node = nodes[nodeIndex];
      node.style.left = `${r.x}px`;
      node.style.top = `${r.y}px`;
      node.style.width = `${r.w}px`;
    };

    // Where everything attaches, and the six links between: from each slot's
    // node to the routing node, and from the routing node to the two ports on
    // the ring around the globe (request in, response out). The ring is
    // centred on the globe and stands RING_GAP outside it.
    const layout = () => {
      const card = local(gateCard);
      const gateIn = { x: card.x, y: card.y + card.h / 2 };
      const gateReq = { x: card.x + card.w, y: card.y + card.h / 2 - GATE_SPREAD };
      const gateRes = { x: card.x + card.w, y: card.y + card.h / 2 + GATE_SPREAD };
      slots.forEach((_slot, index) => {
        const r = nodeBox(index);
        links[index].setAttribute("d", fluidPath({ x: r.x + r.w, y: r.y + LINK_OFFSET }, gateIn));
        const shownNode = slotNode[index];
        if (shownNode !== null) place(index, shownNode);
      });
      const globe = mapHostRef?.current;
      if (!globe) return;
      const g = local(globe);
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      const ringRadius = (g.h * CAP_GLOBE_FILL) / 2 + RING_GAP;
      ringLine.setAttribute("cx", String(cx));
      ringLine.setAttribute("cy", String(cy));
      ringLine.setAttribute("r", String(ringRadius));
      const angle = (PORT_ANGLE * Math.PI) / 180;
      // Due west is π; above it (smaller y) is π + angle, below it π − angle.
      const onRing = (theta: number) => ({ x: cx + ringRadius * Math.cos(theta), y: cy + ringRadius * Math.sin(theta) });
      const inPoint = onRing(Math.PI + angle);
      const outPoint = onRing(Math.PI - angle);
      const putPort = (port: HTMLElement, point: { x: number; y: number }) => {
        port.style.left = `${point.x}px`;
        port.style.top = `${point.y}px`;
        port.dataset.ready = "";
      };
      putPort(portIn, inPoint);
      putPort(portOut, outPoint);
      links[REQ_LINK].setAttribute("d", fluidPath(gateReq, inPoint));
      links[RES_LINK].setAttribute("d", fluidPath(gateRes, outPoint));
    };

    const roll = (element: HTMLElement, text: string) => {
      element.textContent = text;
      element.animate([{ transform: "translateY(60%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 400, easing: EASE });
    };
    // A row of the routing node: it rolls to its new text (only if it changed).
    const setRow = (element: HTMLElement, text: string, tone: "out" | "ok" | "") => {
      if (tone) element.dataset.tone = tone;
      else delete element.dataset.tone;
      if (element.textContent !== text) roll(element, text);
    };
    const flash = (element: HTMLElement, tone: "out" | "ok") => {
      const rgb = tone === "ok" ? "34, 197, 94" : "244, 83, 0";
      element.animate(
        [{ borderColor: `rgba(${rgb}, .6)`, boxShadow: `0 0 0 4px rgba(${rgb}, .1)` }, { borderColor: "#f0f0f0", boxShadow: "0 1px 2px rgba(0, 0, 0, .05)" }],
        { duration: 800, easing: EASE },
      );
    };
    // Something docks at a port: the port rings and the ring around the globe
    // flashes.
    const dock = (port: HTMLElement, tone: "out" | "ok") => {
      port.dataset.tone = tone;
      port.querySelector("span")?.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.2)", opacity: 0 }], { duration: 650, easing: EASE });
      ringLine.animate([{ stroke: tone === "ok" ? "rgba(34, 197, 94, .7)" : "rgba(244, 83, 0, .7)" }, { stroke: "rgba(38, 38, 38, .14)" }], { duration: 700, easing: EASE });
      later(() => delete port.dataset.tone, 900);
    };
    const pulse = (link: number, color: string, reverse = false) => {
      const path = links[link];
      playPulse(pulses, { d: path.getAttribute("d") ?? "", length: path.getTotalLength(), color, reverse });
    };
    const send = (from: HTMLElement | null, to: HTMLElement | null, style: CometStyle, duration: number) => {
      if (from && to) packets.push({ from, to, style, duration, start: null });
    };

    // A node leaves its slot (a fade), and a node takes it (a rise).
    const retire = (nodeIndex: number) => {
      const node = nodes[nodeIndex];
      const out = node.animate([{ opacity: Number(getComputedStyle(node).opacity) }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      out.onfinish = () => {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.dataset.state = "idle";
        onShow.delete(nodeIndex);
      };
    };
    const seat = (slot: number, nodeIndex: number) => {
      const before = slotNode[slot];
      if (before !== null) retire(before);
      slotNode[slot] = nodeIndex;
      slotFresh[slot] = true;
      onShow.add(nodeIndex);
      const node = nodes[nodeIndex];
      node.getAnimations().forEach((animation) => animation.cancel());
      place(slot, nodeIndex);
      node.dataset.state = "rest";
      node.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 350, easing: EASE });
    };

    // The answer is home: a green packet to the ring's lower port, then green
    // pulses back along the response link and the service node's link.
    const back = (job: Job) => {
      if (job.done) return;
      const d2 = pulseDuration(links[RES_LINK].getTotalLength());
      const d1 = pulseDuration(links[job.slot].getTotalLength());
      send(hubElement(), portOut, GREEN_PACKET, PACKET_BACK);
      later(() => {
        dock(portOut, "ok");
        pulse(RES_LINK, GREEN, true);
      }, PACKET_BACK);
      later(() => {
        flash(gateCard, "ok");
        setRow(gateExit, copy.gateway.ok(job.ms), "ok");
        setRow(gateRule, copy.gateway.rule[SCENES[REQUESTS[job.node].scene].group], "");
      }, PACKET_BACK + d2);
      later(() => pulse(job.slot, GREEN, true), PACKET_BACK + d2 + BEAT);
      later(() => {
        if (job.done) return;
        job.done = true;
        const node = nodes[job.node];
        node.dataset.state = "ok";
        const result = node.querySelector<HTMLElement>(`.${styles.nodeText} small`);
        if (result) roll(result, copy.done(job.city, job.ms));
        // It rests, dimmed, where it is until another request takes the slot.
        later(() => {
          node.animate([{ opacity: 1 }, { opacity: 0.6 }], { duration: 400, easing: "ease-out", fill: "forwards" });
          slotBusy[job.slot] = false;
        }, HOLD);
      }, PACKET_BACK + d2 + BEAT + d1);
    };

    // Start a request. False when it can't start right now (no free slot, or
    // no city in view together with China), so the caller tries again.
    const begin = () => {
      layout();
      let slot = -1;
      for (let step = 0; step < SLOTS; step += 1) {
        const candidate = (slotTurn + step) % SLOTS;
        if (!slotBusy[candidate]) {
          slot = candidate;
          break;
        }
      }
      if (slot < 0) return false;
      // The service: the one waiting in the slot if it is unused and belongs
      // to this scene, otherwise the scene's next one that isn't on show.
      const waiting = slotNode[slot];
      const reuse = waiting !== null && slotFresh[slot] && REQUESTS[waiting].scene === scene;
      let chosen = reuse ? waiting : null;
      let nextCursor = cursors[scene];
      if (chosen === null) {
        const pool = sceneNodes[scene];
        for (let step = 0; step < pool.length; step += 1) {
          const candidate = pool[(cursors[scene] + step) % pool.length];
          if (!onShow.has(candidate)) {
            chosen = candidate;
            nextCursor = (cursors[scene] + step + 1) % pool.length;
            break;
          }
        }
      }
      if (chosen === null) return false;

      const d1 = pulseDuration(links[slot].getTotalLength());
      const d2 = pulseDuration(links[REQ_LINK].getTotalLength());
      const atGate = LEAD + d1;
      const atSend = atGate + BEAT;
      const atEntry = atSend + d2;
      const atChina = atEntry + PACKET_OUT;
      // The city is picked now (the routing node names it), and the map's
      // round trip is booked to start when the packet reaches China.
      const job: Job = { slot, node: chosen, city: "", ms: 0, done: false };
      const cities = SCENES[scene].cities;
      for (let step = 0; step < cities.length; step += 1) {
        const city = cities[(cityCursors[scene] + step) % cities.length];
        if (tripRef.current?.({ city, delay: atChina / 1000, onReturn: () => back(job) })) {
          job.city = city;
          job.ms = latency(city, chosen);
          cityCursors[scene] = (cityCursors[scene] + step + 1) % cities.length;
          break;
        }
      }
      if (!job.city) return false;

      cursors[scene] = nextCursor;
      slotTurn = slot + 1;
      slotBusy[slot] = true;
      if (!reuse) seat(slot, chosen);
      slotFresh[slot] = false;
      const node = nodes[chosen];
      node.dataset.state = "pending";
      const result = node.querySelector<HTMLElement>(`.${styles.nodeText} small`);
      if (result) result.textContent = REQUESTS[chosen].call;

      later(() => {
        if (job.done) return;
        job.done = true;
        nodes[chosen].dataset.state = "rest";
        slotBusy[slot] = false;
      }, WATCHDOG);
      later(() => pulse(slot, ORANGE), LEAD);
      later(() => {
        flash(gateCard, "out");
        setRow(gateRule, copy.gateway.rule[SCENES[scene].group], "");
        setRow(gateExit, copy.gateway.exit(job.city), "out");
      }, atGate);
      later(() => pulse(REQ_LINK, ORANGE), atSend);
      later(() => {
        dock(portIn, "out");
        send(portIn, hubElement(), PACKET, PACKET_OUT);
      }, atEntry);
      return true;
    };

    // Scenes: PER_SCENE requests, a wait for the last answers, then the globe
    // turns to the next scene (no new requests while it does).
    const step = (index: number, count: number) => {
      if (!shown() || document.hidden) {
        later(() => step(index, count), 500);
        return;
      }
      if (count < PER_SCENE) {
        if (begin()) later(() => step(index, count + 1), SPACING);
        else later(() => step(index, count), 400);
        return;
      }
      later(() => {
        scene = (index + 1) % SCENES.length;
        later(() => step(scene, 0), PAN);
      }, SETTLE);
    };

    // Dragging: the four service nodes and the routing node move with the
    // pointer (kept inside the box) and the links follow; the globe and its
    // ring stay where they are. The offsets belong to the slots, so a node
    // that takes over a slot stands where the last one was left.
    let drag: { element: HTMLElement; slot: number; x: number; y: number; from: { x: number; y: number } } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const element = (event.target as Element).closest<HTMLElement>(`.${styles.node}, .${styles.gateway}`);
      if (!element || !box.contains(element)) return;
      const slot = element === gate ? -1 : slotNode.indexOf(Number(element.dataset.index));
      if (element !== gate && slot < 0) return;
      drag = { element, slot, x: event.clientX, y: event.clientY, from: slot < 0 ? { ...gateShift } : { ...slotShift[slot] } };
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is gone already; the drag still follows the moves.
      }
      element.dataset.dragging = "";
      event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.slot >= 0) {
        const r = local(slots[drag.slot]);
        slotShift[drag.slot].x = clamp(drag.from.x + dx, -r.x, box.clientWidth - r.w - r.x);
        slotShift[drag.slot].y = clamp(drag.from.y + dy, -r.y, box.clientHeight - r.h - r.y);
      } else {
        // The routing node's own place (its rect less how far it has moved).
        const r = local(gate);
        const baseX = r.x - gateShift.x;
        const baseY = r.y - gateShift.y;
        gateShift.x = clamp(drag.from.x + dx, -baseX, box.clientWidth - r.w - baseX);
        gateShift.y = clamp(drag.from.y + dy, -baseY, box.clientHeight - r.h - baseY);
        gate.style.setProperty("--dx", `${gateShift.x}px`);
        gate.style.setProperty("--dy", `${gateShift.y}px`);
      }
      layout();
    };
    const onUp = () => {
      if (!drag) return;
      delete drag.element.dataset.dragging;
      drag = null;
    };
    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onUp);
    box.addEventListener("pointercancel", onUp);

    // Start with the scene's first services already in their slots, so the
    // graph is never empty.
    layout();
    sceneNodes[0].slice(0, SLOTS).forEach((nodeIndex, slot) => seat(slot, nodeIndex));
    gateRule.textContent = copy.gateway.idle;
    gateExit.textContent = "—";
    later(() => step(0, 0), FIRST);

    // The globe's steering, the graph's layout as the map settles or the box
    // resizes, and the packets, drawn on this box's own canvas.
    let frame = 0;
    let signature = "";
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // The relay keeps this scene mounted while the hero is visible. Read
      // its scroll ref before measuring DOM geometry or drawing transparent
      // packets; layout catches up on the first visible frame.
      if (!inView || document.hidden || visibleRef?.current === false) {
        steerRef.current = null;
        return;
      }
      // Look at the current scene, swaying a little; released when hidden.
      steerRef.current = shown() ? SCENES[scene].center + 8 * Math.sin(((now / 1000) * Math.PI * 2) / 20) : null;

      const globe = mapHostRef?.current;
      const g = globe ? local(globe) : null;
      const next = `${box.clientWidth}|${box.clientHeight}|${g ? [g.x, g.y, g.w, g.h].map(Math.round).join(",") : ""}`;
      if (next !== signature) {
        signature = next;
        layout();
      }

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
      for (let index = packets.length - 1; index >= 0; index -= 1) {
        const packet = packets[index];
        if (packet.start === null) packet.start = now;
        const elapsed = now - packet.start;
        if (elapsed > packet.duration + 250) {
          packets.splice(index, 1);
          continue;
        }
        const from = local(packet.from);
        const to = local(packet.to);
        const ax = from.x + from.w / 2, ay = from.y + from.h / 2;
        const bx = to.x + to.w / 2, by = to.y + to.h / 2;
        // A gentle arc over the globe.
        const cx = (ax + bx) / 2, cy = Math.min(ay, by) - Math.abs(bx - ax) * 0.14 - 12;
        const points: number[] = [];
        for (let stepIndex = 0; stepIndex <= 32; stepIndex += 1) {
          const t = stepIndex / 32;
          points.push((1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by);
        }
        // drawComet's phase puts the hit at TRAVEL of its cycle.
        drawComet(context, points, elapsed / (packet.duration / TRAVEL), 1, 1, packet.style);
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      visibilityObserver.disconnect();
      timers.forEach((id) => clearTimeout(id));
      cancelAnimationFrame(frame);
      steerRef.current = null;
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onUp);
      box.removeEventListener("pointercancel", onUp);
      gate.style.removeProperty("--dx");
      gate.style.removeProperty("--dy");
      nodes.forEach((node) => {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.dataset.state = "idle";
      });
      pulses.replaceChildren();
    };
  }, [copy, mapHostRef, steerRef, tripRef, visibleRef]);

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

          <div className={styles.graph} aria-hidden="true">
            <svg className={styles.links}>
              {Array.from({ length: SLOTS + 2 }, (_, index) => <path key={index} />)}
              <circle ref={ringRef} className={styles.ring} />
            </svg>
            <svg ref={pulseRef} className={styles.pulses} />
            <canvas ref={beamRef} className={styles.beams} />

            {Array.from({ length: SLOTS }, (_, index) => <span key={index} className={styles.slot} style={{ "--i": index } as CSSProperties} />)}
            {REQUESTS.map((request, index) => <ServiceNode key={request.name} request={request} index={index} tag={copy.tags[SCENES[request.scene].group]} />)}

            <div ref={gateRef} className={styles.gateway}>
              <span className={styles.nodeLabel}><b>{copy.gateway.name}</b><small>{copy.gateway.tag}</small></span>
              <span className={styles.gwCard}>
                <span className={styles.gwRow} data-row="rule">{copy.gateway.idle}</span>
                <span className={styles.gwRow} data-row="exit">—</span>
              </span>
            </div>
            <i ref={portInRef} className={styles.port}><span /></i>
            <i ref={portOutRef} className={styles.port}><span /></i>
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
  const globeRef = useRef<HTMLDivElement>(null);
  const curlRef = useRef(0);
  const seamRef = useRef(0);
  const pausedRef = useRef(false);
  const activeRef = useRef(false);
  const link = useGlobeLink();
  const motion = useMotion();
  const globeReady = useCallback(() => stageRef.current?.setAttribute("data-globe", "ready"), []);

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
      // The graph comes in once the globe has shrunk clear of it.
      stage.style.setProperty("--q", Math.min(1, Math.max(0, (p - 0.78) / 0.22)).toFixed(4));
      // The curled map hands over to the 3D globe (see home-relay.tsx).
      const g = Math.min(1, Math.max(0, (p - 0.78) / 0.14));
      stage.style.setProperty("--g", g.toFixed(4));
      activeRef.current = g > 0.001;
      pausedRef.current = g >= 0.999 && stage.dataset.globe === "ready";
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
          mapHostRef={globeRef}
          map={(
            <>
              <div className={`${styles.map} ${styles.capMap}`}>
                <WorldMapCap curlRef={curlRef} seamRef={seamRef} pausedRef={pausedRef} graticule routes={!motion} steerRef={link.steerRef} label={featureCopy[locale].unlock.mapLabel} />
              </div>
              <div ref={globeRef} className={styles.map}>
                <WorldGlobe seamRef={seamRef} activeRef={activeRef} tripRef={link.tripRef} onReady={globeReady} label={featureCopy[locale].unlock.mapLabel} />
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
