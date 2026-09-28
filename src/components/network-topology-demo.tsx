"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, Globe2, Network, Play, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { WorldMapCap } from "@/components/world-map-cap";
import styles from "./network-topology-demo.module.css";

const TOP_ROUTE = "M 252 102 C 408 137 638 238 798 278";
const BOTTOM_ROUTE = "M 252 458 C 408 423 638 322 798 282";
const INNER_ROUTE = "M 252 102 C 468 206 468 354 252 458";

function GlobeArtwork({ staticFallback }: { staticFallback: boolean }) {
  return (
    <svg className={styles.globeArtwork} viewBox="0 0 360 360" aria-hidden="true">
      <defs>
        <clipPath id="topology-globe-clip"><circle cx="180" cy="180" r="166" /></clipPath>
        <radialGradient id="topology-ocean" cx="36%" cy="28%" r="78%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#edf3fa" />
        </radialGradient>
      </defs>
      <circle cx="180" cy="180" r="166" fill="url(#topology-ocean)" stroke="#d8e1ed" />
      {staticFallback && <>
        <g clipPath="url(#topology-globe-clip)" fill="none" stroke="#c9d5e3" strokeWidth="1">
          <ellipse cx="180" cy="180" rx="72" ry="166" />
          <ellipse cx="180" cy="180" rx="132" ry="166" />
          <ellipse cx="180" cy="180" rx="166" ry="54" />
          <ellipse cx="180" cy="180" rx="166" ry="112" />
        </g>
        <circle cx="254" cy="142" r="5" fill="#f45300" />
      </>}
    </svg>
  );
}

function SourceNode({ kind }: { kind: "services" | "nodes" }) {
  const isServices = kind === "services";
  return (
    <article className={`${styles.node} ${isServices ? styles.services : styles.nodes}`}>
      <span className={styles.nodeIcons} aria-hidden="true">
        {isServices ? <><Sparkles /><Play /></> : <><Network /><AudioLines /></>}
      </span>
      <h2>{isServices ? "AI 与流媒体站点" : "全球节点"}</h2>
      <p>{isServices ? "网络请求" : "智能选择 · 安全直连"}</p>
    </article>
  );
}

export function NetworkTopologyDemo() {
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionAllowed(!preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/demo/features"><ArrowLeft size={16} /> 返回特性页</Link>

        <header className={styles.header}>
          <p className={styles.kicker}><BrandMark size={20} /> AERANEXA · GLOBAL NETWORK</p>
          <h1>一条连接，抵达全球</h1>
          <p className={styles.description}>服务请求与全球节点汇入同一张网络，在地球上找到合适的路径。</p>
        </header>

        <section className={styles.stage} aria-label="服务请求、全球节点与地球之间的连接示意">
          <svg className={styles.routes} viewBox="0 0 1200 560" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="topology-brand-line" x1="0" x2="1">
                <stop offset="0" stopColor="#38bdf8" />
                <stop offset="1" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <path className={styles.route} d={TOP_ROUTE} />
            <path className={styles.route} d={BOTTOM_ROUTE} />
            <path className={styles.logoArc} d={INNER_ROUTE} />
            <path className={styles.routeCore} d={TOP_ROUTE} />
            {motionAllowed && <circle className={styles.signal} r="4"><animateMotion dur="5.8s" repeatCount="indefinite" path={TOP_ROUTE} /></circle>}
            <circle className={styles.anchor} cx="252" cy="102" r="5" />
            <circle className={styles.anchor} cx="252" cy="458" r="5" />
            <circle className={styles.anchor} cx="798" cy="280" r="5" />
          </svg>

          <div className={styles.sourceTop}><SourceNode kind="services" /></div>
          <div className={styles.sourceBottom}><SourceNode kind="nodes" /></div>

          <div className={styles.mobileSources}>
            <SourceNode kind="services" />
            <SourceNode kind="nodes" />
          </div>
          <svg className={styles.mobileRoutes} viewBox="0 0 360 300" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.route} d="M86 2 C112 116 142 214 180 266" />
            <path className={styles.route} d="M274 2 C248 116 218 214 180 266" />
            <path className={styles.logoArc} d="M86 2 C148 86 212 86 274 2" />
          </svg>

          <div className={styles.globeNode}>
            <div className={styles.globeClip}>
              <GlobeArtwork staticFallback={!motionAllowed} />
              <WorldMapCap className={styles.mapProjection} globe graticule routes={false} label="全球节点点阵地球" />
            </div>
            <span className={styles.globeLabel}><Globe2 size={14} /> 全球目的地</span>
          </div>
        </section>

        <footer className={styles.footer}><span className={styles.footerDot} /> 连接路径示意 · 地球点阵展示全球网络</footer>
      </div>
    </main>
  );
}
