"use client";

import { useEffect, useRef, type RefObject } from "react";
import { CosmosStage } from "./splash-cosmos";
import { MapStage } from "./splash-map";
import { NetworkStage } from "./splash-network";
import styles from "./splash-stage.module.css";
import { useReducedMotion } from "./use-reduced-motion";
import { useSplashProgress, type SplashProgressOptions } from "./use-splash-progress";

export type StagedVariant = "map" | "network" | "cosmos";

// Timing per variant. The map dissolves into the hero's own map underneath; the others lift
// away like a curtain.
const CONFIG: Record<StagedVariant, { minMs: number; maxMs: number; holdMs: number; exitMs: number; exit: "curtain" | "dissolve" }> = {
  map: { minMs: 2200, maxMs: 5000, holdMs: 250, exitMs: 700, exit: "dissolve" },
  network: { minMs: 2400, maxMs: 5000, holdMs: 150, exitMs: 900, exit: "curtain" },
  cosmos: { minMs: 2800, maxMs: 5000, holdMs: 150, exitMs: 900, exit: "curtain" },
};

type StagedSplashProps = SplashProgressOptions & {
  variant: StagedVariant;
  /** Map variant: the element the hero's map sits in, so the dots land exactly on it. */
  targetRef?: RefObject<HTMLElement | null>;
};

export function StagedSplash({ variant, targetRef, ...options }: StagedSplashProps) {
  const config = CONFIG[variant];
  const reduced = useReducedMotion();
  const { phase, progressRef } = useSplashProgress({ ...config, ...options });
  const percentRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let announced = -1;
    const paint = () => {
      const value = progressRef.current;
      if (barRef.current) barRef.current.style.transform = `scaleX(${value})`;
      const percent = Math.round(value * 100);
      if (percent !== announced) {
        announced = percent;
        if (percentRef.current) percentRef.current.textContent = `${String(percent).padStart(3, "0")}%`;
        trackRef.current?.setAttribute("aria-valuenow", String(percent));
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  if (phase === "gone") return null;

  return (
    <div className={styles.root} data-exit={config.exit} data-phase={phase} data-variant={variant}>
      <div aria-hidden="true" className={styles.grid} />
      {variant === "map" && <MapStage progressRef={progressRef} reduced={reduced} targetRef={targetRef} />}
      {variant === "network" && <NetworkStage progressRef={progressRef} reduced={reduced} />}
      {variant === "cosmos" && <CosmosStage progressRef={progressRef} reduced={reduced} />}
      <div className={styles.readout}>
        <span ref={percentRef} aria-hidden="true" className={styles.pct}>000%</span>
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
