"use client";

import { useEffect, useRef } from "react";
import { BrandMark } from "@/components/brand-mark";
import styles from "./splash.module.css";
import { useSplashProgress, type SplashProgressOptions } from "./use-splash-progress";

/** The minimal variant: the mark over a thin progress bar on warm grey (after Relume's loading screen). */
export function MinimalSplash(options: SplashProgressOptions) {
  const { phase, progressRef } = useSplashProgress({ minMs: 700, maxMs: 3000, ...options });
  const barRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let announced = -1;
    const paint = () => {
      const value = progressRef.current;
      if (barRef.current) barRef.current.style.transform = `scaleX(${value})`;
      const percent = Math.round(value * 100);
      if (percent !== announced && trackRef.current) {
        announced = percent;
        trackRef.current.setAttribute("aria-valuenow", String(percent));
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  if (phase === "gone") return null;

  return (
    <div className={styles.root} data-phase={phase}>
      <div className={styles.center}>
        <span className={styles.logo}>
          <BrandMark size={24} />
        </span>
        <span
          ref={trackRef}
          aria-label="Loading"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={0}
          className={styles.track}
          role="progressbar"
        >
          <span ref={barRef} className={styles.bar} />
        </span>
      </div>
    </div>
  );
}
