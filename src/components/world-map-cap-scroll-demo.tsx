"use client";

import { useEffect, useRef } from "react";
import { WorldMapCap } from "@/components/world-map-cap";
import styles from "@/app/demo/world-map/world-map-demo.module.css";

// /demo/world-map/cap: scrolling down curls the cap into a whole globe.
// The stage sticks in the viewport while its tall track scrolls past; the
// share of the track scrolled (0–1, eased) is the map's curl. Scrolling back
// up unrolls it.
const ease = (t: number) => t * t * (3 - 2 * t);

export function WorldMapCapScrollDemo({ label }: { label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const curlRef = useRef(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const { top, height } = track.getBoundingClientRect();
      const distance = height - window.innerHeight;
      const progress = distance > 0 ? Math.min(1, Math.max(0, -top / distance)) : 0;
      curlRef.current = ease(progress);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={trackRef} className={styles.curlTrack}>
      <section className={`${styles.stage} ${styles.curlStage}`} aria-label={label}>
        <WorldMapCap curlRef={curlRef} />
      </section>
    </div>
  );
}
