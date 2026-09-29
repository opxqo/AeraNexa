"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import { FeatureUnlock, UnlockContent, useGlobeLink } from "@/components/feature-unlock";
import { WorldGlobe } from "@/components/world-globe";
import { WorldMapCap } from "@/components/world-map-cap";
import { featureCopy } from "@/lib/feature-copy";
import { homeCopy, type HomeLocale } from "@/lib/home-copy";
import heroStyles from "@/app/home-hero.module.css";
import unlockStyles from "./feature-unlock.module.css";
import styles from "./home-relay.module.css";

// The home hero and the first feature block ("AI & streaming unlocked"),
// told with one map. The hero's flat cap sits under the headline; scrolling
// down, the stage sticks, the headline fades, and the same map curls into a
// globe while it shrinks and slides into the right side of the block's box
// (an empty slot there marks where it lands). Then the requests, comets and
// the green pulses back to China come in around it.
//
// Scroll progress p (0–1, eased) is written straight to the DOM: the map's
// transform, the curl (curlRef) and CSS variables on the stage (--p, --q for
// the block's inner parts as on its own, --h for the hero fading out, --u
// for the block's frame fading in). React only re-renders once, when the
// hub's comets switch off as the curl starts (routes).
//
// The curled map is only a stand-in: as it lands (--g, from p = .78) it fades
// out and the 3D globe of /demo/world-map/globe (WorldGlobe) fades in over the
// same spot, facing the same way (the map's seam, `seamRef`), and takes over
// the requests. Once it has, the map stops drawing.
//
// Below 921px (where the hero's map overflows its viewport) and with reduced
// motion, the two stay apart: the hero keeps its flat map and the block
// shows its own globe (FeatureUnlock).
const RELAY = "(min-width: 921px) and (prefers-reduced-motion: no-preference)";

function subscribeRelay(onChange: () => void) {
  const query = window.matchMedia(RELAY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Scroll share (of the sticky distance) at which the relay is complete; the
// rest holds the finished block in place for a moment.
const COMPLETE = 0.85;
// Sticky scroll distance, in viewport heights.
const TRAVEL = 1.6;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (t: number) => t * t * (3 - 2 * t);

function Intro({ locale }: { locale: HomeLocale }) {
  const { hero } = homeCopy[locale];
  return (
    <section className={heroStyles.intro} aria-labelledby="home-heading">
      <p className={heroStyles.eyebrow}>GLOBAL NETWORK <span>·</span> HIGH-SPEED <span>·</span> SECURE</p>
      <h1 id="home-heading">{hero.lead}<br /><span>{hero.highlight}</span>{hero.tail}</h1>
      <p className={heroStyles.description}>{hero.description}</p>
      <div className={heroStyles.ctaRow}>
        <Link className={heroStyles.primaryCta} href="/register">{hero.primary} <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></Link>
        <Link className={heroStyles.secondaryCta} href="/pricing">{hero.secondary}</Link>
      </div>
    </section>
  );
}

function Relay({ locale }: { locale: HomeLocale }) {
  const { hero } = homeCopy[locale];
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const boxSlotRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const curlRef = useRef(0);
  const seamRef = useRef(0);
  const pausedRef = useRef(false);
  const activeRef = useRef(false);
  const link = useGlobeLink();
  const [routes, setRoutes] = useState(true);
  // The 3D globe is up (its fade-in may begin; without WebGL the map stays).
  const globeReady = useCallback(() => stageRef.current?.setAttribute("data-globe", "ready"), []);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    const heroLayer = heroRef.current;
    const heroSlot = heroSlotRef.current;
    const boxSlot = boxSlotRef.current;
    const map = mapRef.current;
    if (!track || !stage || !heroLayer || !heroSlot || !boxSlot || !map) return;

    let stageHeight = 0;
    let from = { x: 0, y: 0, w: 1 };
    let to = { x: 0, y: 0, w: 1 };
    let hubRoutes = true;

    const update = () => {
      // The stage sticks once its bottom meets the viewport's (it can be
      // taller than the viewport: the hero's map runs below the fold).
      const scrolled = window.innerHeight - stageHeight - track.getBoundingClientRect().top;
      const distance = track.offsetHeight - stageHeight;
      const p = ease(clamp(distance > 0 ? scrolled / (distance * COMPLETE) : 0));
      curlRef.current = p;
      // The map travels ahead of its curl (ease-out), so the growing globe
      // rises into view instead of sinking below the fold.
      const move = 1 - (1 - p) * (1 - p);
      const scale = 1 + (to.w / from.w - 1) * move;
      map.style.transform = `translate(${((to.x - from.x) * move).toFixed(2)}px, ${((to.y - from.y) * move).toFixed(2)}px) scale(${scale.toFixed(4)})`;
      stage.style.setProperty("--p", p.toFixed(4));
      stage.style.setProperty("--q", clamp((p - 0.78) / 0.22).toFixed(4));
      stage.style.setProperty("--h", clamp(p / 0.3).toFixed(4));
      stage.style.setProperty("--u", clamp((p - 0.55) / 0.3).toFixed(4));
      const g = clamp((p - 0.78) / 0.14);
      stage.style.setProperty("--g", g.toFixed(4));
      activeRef.current = g > 0.001;
      pausedRef.current = g >= 0.999 && stage.dataset.globe === "ready";
      stage.toggleAttribute("data-unlocked", p > 0.9);
      if (p < 0.05 !== hubRoutes) {
        hubRoutes = p < 0.05;
        setRoutes(hubRoutes);
      }
    };

    const measure = () => {
      // At least the viewport, and the block's 840px minimum (see the CSS).
      stageHeight = Math.max(window.innerHeight, 840, heroLayer.offsetHeight);
      stage.style.height = `${stageHeight}px`;
      stage.style.top = `${Math.min(0, window.innerHeight - stageHeight)}px`;
      track.style.height = `${stageHeight + window.innerHeight * TRAVEL}px`;
      // Where the map starts (the hero's slot) and lands (the box's slot),
      // relative to the stage; neither slot moves with the scroll.
      const base = stage.getBoundingClientRect();
      const start = heroSlot.getBoundingClientRect();
      const end = boxSlot.getBoundingClientRect();
      from = { x: start.left - base.left, y: start.top - base.top, w: start.width };
      to = { x: end.left - base.left, y: end.top - base.top, w: end.width };
      map.style.left = `${from.x}px`;
      map.style.top = `${from.y}px`;
      map.style.width = `${from.w}px`;
      update();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(heroLayer);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={trackRef} className={styles.track}>
      <div ref={stageRef} className={styles.stage}>
        <div ref={heroRef} className={styles.heroLayer}>
          <div className={styles.heroIntro}><Intro locale={locale} /></div>
          <div ref={heroSlotRef} className={`${heroStyles.mapViewport} ${styles.heroSlot}`} aria-hidden="true" />
        </div>

        <div ref={mapRef} className={styles.mapLayer} aria-label={hero.mapLabel}>
          <WorldMapCap curlRef={curlRef} seamRef={seamRef} pausedRef={pausedRef} graticule routes={routes} steerRef={link.steerRef} label={featureCopy[locale].unlock.mapLabel} />
        </div>

        <div className={`${unlockStyles.scope} ${styles.unlockLayer}`}>
          <UnlockContent
            locale={locale}
            link={link}
            mapHostRef={boxSlotRef}
            boxClassName={unlockStyles.clearBox}
            map={(
              <div ref={boxSlotRef} className={unlockStyles.globeSlot}>
                <WorldGlobe seamRef={seamRef} activeRef={activeRef} tripRef={link.tripRef} onReady={globeReady} label={featureCopy[locale].unlock.mapLabel} />
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}

export function HomeRelay({ locale }: { locale: HomeLocale }) {
  // The server renders the relay (desktop); narrow screens switch after
  // hydration.
  const relay = useSyncExternalStore(subscribeRelay, () => window.matchMedia(RELAY).matches, () => true);
  const { hero } = homeCopy[locale];

  if (relay) return <Relay locale={locale} />;
  return (
    <>
      <Intro locale={locale} />
      <div className={heroStyles.mapViewport} aria-label={hero.mapLabel}>
        <WorldMapCap className={heroStyles.mapCanvas} label={hero.mapImageLabel} />
      </div>
      <div className={styles.apart}>
        <FeatureUnlock locale={locale} />
      </div>
    </>
  );
}
