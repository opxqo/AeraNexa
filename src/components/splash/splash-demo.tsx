"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WorldMapCap } from "@/components/world-map-cap";
import { createSplashTasks } from "@/lib/splash-tasks";
import { SPLASH_VARIANTS, Splash, type SplashVariant } from "./index";
import styles from "./splash-demo.module.css";

type Mode = "real" | "simulated";

/** Frames per second, refreshed twice a second: a quick check that a variant holds up. */
function useFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const loop = (now: number) => {
      frames += 1;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

/**
 * How closely the map splash's finished frame matches the hero's first frame (the static SVG
 * the real map shows before its canvas takes over), over the middle of the map where the
 * hero's edge fade is fully opaque. Both are composited on the page colour.
 */
async function compareWithHeroFrame(slot: HTMLElement) {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-stage=map]");
  if (!canvas) return "没有地图开屏的画布（先选 A，并把进度拖到 100%）";
  const box = slot.getBoundingClientRect();
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  const mobile = box.width <= 600;
  const image = new Image();
  image.src = `/demo/world-map-cap-${mobile ? "mobile" : "desktop"}.svg`;
  await image.decode();
  const reference = document.createElement("canvas");
  reference.width = canvas.width;
  reference.height = canvas.height;
  const draw = reference.getContext("2d")!;
  const height = box.width * 0.4;
  draw.drawImage(image, box.left * dpr, box.top * dpr, box.width * dpr, height * dpr);
  const x0 = Math.round((box.left + box.width * 0.2) * dpr);
  const y0 = Math.round((box.top + height * 0.25) * dpr);
  const w = Math.round(box.width * 0.6 * dpr);
  const h = Math.round(height * 0.5 * dpr);
  const a = canvas.getContext("2d")!.getImageData(x0, y0, w, h).data;
  const b = draw.getImageData(x0, y0, w, h).data;
  let sum = 0;
  let bad = 0;
  let inkA = 0;
  let inkB = 0;
  for (let index = 0; index < a.length; index += 4) {
    const alphaA = a[index + 3] / 255;
    const alphaB = b[index + 3] / 255;
    const diff = Math.abs(a[index] * alphaA + 252 * (1 - alphaA) - (b[index] * alphaB + 252 * (1 - alphaB)));
    sum += diff;
    if (diff > 24) bad += 1;
    inkA += alphaA;
    inkB += alphaB;
  }
  const n = a.length / 4;
  return `${mobile ? "手机" : "桌面"}点集 · 区域 ${w}×${h}px · 平均差 ${(sum / n).toFixed(2)}/255 · 差异像素 ${((bad / n) * 100).toFixed(2)}% · 墨量 开屏 ${(inkA / n).toFixed(4)} / SVG ${(inkB / n).toFixed(4)}`;
}

export function SplashDemo({
  initialVariant,
  initialScrub,
  autoCompare = false,
}: {
  initialVariant: SplashVariant;
  initialScrub: number | null;
  /** `?diff=1`: run the hero-frame comparison a moment after load. */
  autoCompare?: boolean;
}) {
  const [variant, setVariant] = useState<SplashVariant>(initialVariant);
  const [mode, setMode] = useState<Mode>("real");
  const [slow, setSlow] = useState(false);
  const [run, setRun] = useState(0);
  const [scrub, setScrub] = useState(initialScrub !== null);
  const [progress, setProgress] = useState(initialScrub ?? 0);
  // The hero's map appears when the splash starts to leave, so it starts from the same frame the dots land in.
  const [mapOn, setMapOn] = useState(false);
  const mapSlot = useRef<HTMLDivElement>(null);
  const fps = useFps();
  const [diff, setDiff] = useState("");

  useEffect(() => {
    if (!autoCompare) return;
    const timer = setTimeout(() => {
      if (mapSlot.current) compareWithHeroFrame(mapSlot.current).then(setDiff, (error) => setDiff(String(error)));
    }, 3000);
    return () => clearTimeout(timer);
  }, [autoCompare]);

  // Fresh tasks for every replay; a stable array per run so the splash doesn't restart mid-load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => (mode === "real" && !scrub ? createSplashTasks({ slow, fresh: true }) : undefined), [mode, slow, scrub, run]);

  const choose = (next: SplashVariant) => {
    setVariant(next);
    setMapOn(false);
    const url = new URL(window.location.href);
    url.searchParams.set("v", next);
    window.history.replaceState(null, "", url);
  };
  const replay = () => {
    setMapOn(false);
    setRun((n) => n + 1);
  };

  return (
    <main className={styles.page}>
      <Splash
        key={`${variant}-${mode}-${slow}-${scrub}-${run}`}
        controlled={scrub ? progress : null}
        onPhase={(phase) => {
          if (phase !== "loading") setMapOn(true);
        }}
        simulateMs={variant === "minimal" ? 2500 : 3600}
        targetRef={mapSlot}
        tasks={tasks}
        variant={variant}
      />

      {/* A stand-in for the hero: the same page colour and grid, and the map where the hero puts it. */}
      <section className={styles.intro}>
        <p className={styles.eyebrow}>AERANEXA · GLOBAL RELAY</p>
        <h1 className={styles.title}>
          One network,
          <br />
          <em>every route.</em>
        </h1>
        <p className={styles.lead}>The page underneath. When the splash finishes it hands over to this map.</p>
      </section>
      <div ref={mapSlot} className={styles.mapViewport}>
        {mapOn && <WorldMapCap />}
      </div>

      <div className={styles.controls}>
        <span className={styles.group} role="group" aria-label="变体">
          {SPLASH_VARIANTS.map(({ id, label }) => (
            <button key={id} className={styles.btn} data-on={variant === id} onClick={() => choose(id)} type="button">
              {label}
            </button>
          ))}
        </span>
        <span className={styles.row}>
          <button className={styles.btn} onClick={replay} type="button">
            重放
          </button>
          <span className={styles.group} role="group" aria-label="进度来源">
            <button className={styles.btn} data-on={mode === "real"} disabled={scrub} onClick={() => setMode("real")} type="button">
              真实加载
            </button>
            <button className={styles.btn} data-on={mode === "simulated"} disabled={scrub} onClick={() => setMode("simulated")} type="button">
              模拟进度
            </button>
          </span>
          <button className={styles.btn} data-on={slow} disabled={mode !== "real" || scrub} onClick={() => setSlow((v) => !v)} type="button">
            慢网 ×3
          </button>
          <button className={styles.btn} data-on={scrub} onClick={() => setScrub((v) => !v)} type="button">
            拖动进度
          </button>
          {variant === "map" && (
            <button className={styles.btn} onClick={() => mapSlot.current && compareWithHeroFrame(mapSlot.current).then(setDiff, (error) => setDiff(String(error)))} type="button">
              对比 Hero 首帧
            </button>
          )}
          <output className={styles.fps}>{fps} fps</output>
          {scrub && (
            <label className={styles.scrub}>
              <input
                aria-label="进度"
                max={1}
                min={0}
                onChange={(event) => setProgress(Number(event.target.value))}
                step={0.005}
                type="range"
                value={progress}
              />
              <span>{Math.round(progress * 100)}%</span>
            </label>
          )}
        </span>
        {diff && <output className={styles.diff}>{diff}</output>}
      </div>
    </main>
  );
}
