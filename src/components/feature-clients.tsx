"use client";

import { useState, type ReactNode } from "react";
import { Laptop, Monitor, Pause, Play, Smartphone, TabletSmartphone } from "lucide-react";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-clients.module.css";

// Client showcase, after cloudflare.com's #home-customers block (see
// feature-clients.module.css for the measurements). The tabs rotate through
// supported clients every 4.5s (the progress line under the selected tab is
// the timer: when its animation ends, the next client comes up; pausing
// pauses the animation). Formats follow wantsClash() in
// src/lib/server/panel/clash.ts: clash / mihomo / stash / nyanpasu / verge
// user agents get Clash YAML, everything else Base64.
type Client = {
  name: string;
  icon: ReactNode;
  platforms: string;
  format: "Clash YAML" | "Base64";
};

const CLIENTS: Client[] = [
  {
    name: "Clash Verge",
    icon: <Monitor strokeWidth={1.6} />,
    platforms: "Windows / macOS / Linux",
    format: "Clash YAML",
  },
  {
    name: "Clash Meta for Android",
    icon: <Smartphone strokeWidth={1.6} />,
    platforms: "Android",
    format: "Clash YAML",
  },
  {
    name: "Shadowrocket",
    icon: <TabletSmartphone strokeWidth={1.6} />,
    platforms: "iOS",
    format: "Base64",
  },
  {
    name: "Stash",
    icon: <Laptop strokeWidth={1.6} />,
    platforms: "iOS / macOS",
    format: "Clash YAML",
  },
  {
    name: "v2rayN",
    icon: <Monitor strokeWidth={1.6} />,
    platforms: "Windows",
    format: "Base64",
  },
];

const PLATFORMS = ["Windows", "macOS", "iOS", "iPadOS", "Android", "Linux", "Windows", "macOS", "iOS", "iPadOS", "Android", "Linux"];

export function FeatureClients({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].clients;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const client = CLIENTS[index];
  const select = (next: number) => setIndex((next + CLIENTS.length) % CLIENTS.length);

  return (
    <div className={`${styles.section} ${paused ? styles.paused : ""}`}>
      <header className={styles.head}>
        <h2>{copy.title}</h2>
        <p>{copy.lead}</p>
      </header>

      <div className={styles.window}>
        <div className={styles.bar}>
          <span className={styles.lights} aria-hidden="true"><i /><i /><i /></span>
          <div role="tablist" aria-label={copy.tablistLabel} style={{ display: "flex", gap: 8 }}>
            {CLIENTS.map((item, itemIndex) => (
              <button
                key={item.name}
                type="button"
                role="tab"
                id={`client-tab-${itemIndex}`}
                aria-selected={itemIndex === index}
                aria-controls="client-panel"
                tabIndex={itemIndex === index ? 0 : -1}
                className={styles.tab}
                onClick={() => setIndex(itemIndex)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") select(index + 1);
                  if (event.key === "ArrowLeft") select(index - 1);
                }}
              >
                <span className={styles.tabInner}>{item.icon}{item.name}</span>
                {itemIndex === index && <span key={index} className={styles.progress} onAnimationEnd={() => select(index + 1)} />}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.body}>
          <button type="button" className={styles.pause} aria-label={paused ? copy.resume : copy.pause} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
          </button>

          <div key={index} id="client-panel" role="tabpanel" aria-labelledby={`client-tab-${index}`} className={styles.stage}>
            <span className={styles.frame} aria-hidden="true" />
            <span className={styles.beam} aria-hidden="true" />
            <div className={styles.grid}>
              <div>
                <p className={styles.quote}>{copy.steps[client.name].lead}<span>{copy.steps[client.name].tail}</span></p>
                <div className={styles.who}>
                  <b>{client.name}</b>
                  <span>{client.platforms} · {copy.delivered(client.format)}</span>
                </div>
              </div>
              <div className={styles.tile} aria-hidden="true">
                {client.icon}
                <small>{client.format}</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className={styles.caption}>{copy.platforms}</p>
      <div className={styles.wall} aria-hidden="true">
        <div className={styles.track}>
          {PLATFORMS.map((platform, platformIndex) => <span key={platformIndex}>{platform}</span>)}
        </div>
      </div>
    </div>
  );
}
