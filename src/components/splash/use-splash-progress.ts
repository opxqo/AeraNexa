"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { SplashTask } from "@/lib/splash-tasks";

export type SplashPhase = "loading" | "exit" | "gone";

export type SplashProgressOptions = {
  /** What to wait for. Must be a stable reference (memoize it), or the splash restarts. Omit to simulate. */
  tasks?: SplashTask[];
  /** Without `tasks`: how long the simulated progress takes to fill. */
  simulateMs?: number;
  /** Progress never runs faster than this, so a cached load doesn't flash past. */
  minMs?: number;
  /** Past this the splash lets go whatever is still loading. */
  maxMs?: number;
  /** Full progress, held this long before the exit starts. */
  holdMs?: number;
  /** How long the exit takes; the splash is gone after it. */
  exitMs?: number;
  /** Drive the progress by hand (the demo's scrubber): no tasks, and it never finishes. */
  controlled?: number | null;
  onPhase?: (phase: SplashPhase) => void;
  onDone?: () => void;
};

const SMOOTH_MS = 140; // time constant of the progress catching up with the real one

/**
 * The splash's progress engine. `progressRef.current` is a 0–1 value refreshed every frame
 * (smoothed, and never ahead of the minimum display time); the animation reads it from its own
 * frame loop, so React never re-renders per frame. `phase` is the lifecycle for CSS.
 */
export function useSplashProgress({
  tasks,
  simulateMs = 2500,
  minMs = 700,
  maxMs = 3000,
  holdMs = 150,
  exitMs = 900,
  controlled = null,
  onPhase,
  onDone,
}: SplashProgressOptions): { phase: SplashPhase; progressRef: MutableRefObject<number>; phaseRef: MutableRefObject<SplashPhase> } {
  const [phase, setPhase] = useState<SplashPhase>("loading");
  const progressRef = useRef(0);
  const phaseRef = useRef<SplashPhase>("loading");
  const controlledRef = useRef(controlled);
  const callbacksRef = useRef({ onPhase, onDone });

  useEffect(() => {
    controlledRef.current = controlled;
  }, [controlled]);

  useEffect(() => {
    callbacksRef.current = { onPhase, onDone };
  }, [onPhase, onDone]);

  useEffect(() => {
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    const previousGutter = html.style.scrollbarGutter;
    let locked = true;
    // Keep the scrollbar's room while scrolling is off, so the page doesn't shift when it comes back.
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    const unlock = () => {
      if (!locked) return;
      locked = false;
      html.style.overflow = previousOverflow;
      html.style.scrollbarGutter = previousGutter;
    };

    const start = performance.now();
    const fractions = (tasks ?? []).map(() => 0);
    const totalWeight = (tasks ?? []).reduce((sum, task) => sum + task.weight, 0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    let raf = 0;
    let shown = 0;
    let last = start;
    let finished = false;

    const enter = (next: SplashPhase) => {
      phaseRef.current = next;
      setPhase(next);
      callbacksRef.current.onPhase?.(next);
    };

    tasks?.forEach((task, i) => {
      task
        .run((fraction) => {
          fractions[i] = Math.max(fractions[i], fraction);
        })
        .catch(() => {})
        .finally(() => {
          fractions[i] = 1; // a failed preload must not hold the page hostage
        });
    });

    const realProgress = (elapsed: number) => {
      if (elapsed >= maxMs) return 1;
      if (!tasks) return 1 - Math.pow(1 - Math.min(1, elapsed / simulateMs), 2.4);
      return tasks.reduce((sum, task, i) => sum + task.weight * fractions[i], 0) / totalWeight;
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - start;
      const dt = Math.min(64, now - last);
      last = now;

      const manual = controlledRef.current;
      if (manual !== null) {
        progressRef.current += (manual - progressRef.current) * (1 - Math.exp(-dt / 60));
      } else if (!finished) {
        // Loading can't outrun the minimum display time: it fills at most linearly over minMs.
        const goal = Math.min(realProgress(elapsed), elapsed / minMs);
        shown += (goal - shown) * (1 - Math.exp(-dt / SMOOTH_MS));
        if (goal >= 1 && shown > 0.995) {
          shown = 1;
          finished = true;
          timers.push(
            setTimeout(() => enter("exit"), holdMs),
            setTimeout(() => {
              cancelled = true;
              cancelAnimationFrame(raf);
              unlock();
              enter("gone");
              callbacksRef.current.onDone?.();
            }, holdMs + exitMs),
          );
        }
        progressRef.current = shown;
      }
      // Keeps running through the exit: the animations read the progress, and some idle-animate.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      unlock();
    };
  }, [tasks, simulateMs, minMs, maxMs, holdMs, exitMs]);

  return { phase, progressRef, phaseRef };
}
