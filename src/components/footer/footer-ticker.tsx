"use client";

import { useEffect, useRef, useState } from "react";
import type { TickerTab } from "@/lib/footer-copy";
import styles from "./site-footer.module.css";

// The footer's pill and its line of big words. The pill's white thumb slides to
// the chosen tab, squashing on the way (0.45s, ease-out, scaleX .95 / scaleY
// .85, then back); each tab's words scroll for ever at 40px a second (the list
// is repeated to fill the width, and every copy runs one list-width to the
// left, so the loop has no seam); switching cross-fades the two lines.
const SPEED = 40;

export function FooterTicker({ tabs }: { tabs: TickerTab[] }) {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  // Fill each track with copies of its list, again when the width changes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const build = () => {
      root.querySelectorAll<HTMLElement>("[data-track]").forEach((track) => {
        track.querySelectorAll("[data-clone]").forEach((node) => node.remove());
        const list = track.querySelector<HTMLElement>("[data-list]");
        const width = list?.getBoundingClientRect().width ?? 0;
        if (!list || !width) return;
        const copies = Math.ceil(Math.max(window.innerWidth, track.clientWidth) / width) + 1;
        list.style.animationDuration = `${Math.ceil(width / SPEED)}s`;
        for (let index = 1; index < copies; index += 1) {
          const copy = list.cloneNode(true) as HTMLElement;
          copy.setAttribute("data-clone", "");
          copy.setAttribute("aria-hidden", "true");
          copy.querySelectorAll("a").forEach((link) => link.setAttribute("tabindex", "-1"));
          track.append(copy);
        }
      });
    };
    build();
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(build, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const choose = (index: number) => {
    if (index === active) return;
    thumbRef.current?.animate(
      [
        { transform: `translateX(${active * 100}%) scale(1, 1)`, offset: 0 },
        { transform: `translateX(${(active + (index - active) * 0.45) * 100}%) scale(.95, .85)`, offset: 0.44, easing: "cubic-bezier(.34, 1.56, .64, 1)" },
        { transform: `translateX(${index * 100}%) scale(1, 1)`, offset: 1 },
      ],
      { duration: 450, easing: "cubic-bezier(.215, .61, .355, 1)" },
    );
    setActive(index);
  };

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <div className={`${styles.switch} ${styles.rv}`} style={{ "--d": ".05s" } as React.CSSProperties}>
        <div className={styles.switchInner}>
          {tabs.map((tab, index) => (
            <button key={tab.label} type="button" className={`${styles.switchBtn} ${styles.mono} ${styles.t10}`} data-active={index === active ? "" : undefined} aria-pressed={index === active} onClick={() => choose(index)}>
              {tab.label}
            </button>
          ))}
        </div>
        <span ref={thumbRef} className={styles.switchThumb} style={{ transform: `translateX(${active * 100}%)` }} aria-hidden="true" />
      </div>
      <div className={`${styles.ticker} ${styles.rv}`} style={{ "--d": ".1s" } as React.CSSProperties}>
        {tabs.map((tab, index) => (
          <div key={tab.label} className={styles.tickerTrack} data-track data-active={index === active ? "" : undefined}>
            <div className={styles.tickerList} data-list>
              {tab.items.map((item) => (
                <div key={item.label} className={styles.tickerItem}>
                  <a className={`${styles.tickerLink} ${styles.t32}`} href={item.href} tabIndex={index === active ? undefined : -1}>{item.label}</a>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
