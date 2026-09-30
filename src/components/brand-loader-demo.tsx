"use client";

import { useState, type CSSProperties } from "react";
import { BrandLoader, LoaderOverlay } from "@/components/brand-loader";
import { Skeleton } from "@/components/skeleton";
import styles from "./brand-loader-demo.module.css";

const SIZES = [16, 20, 24, 32, 48, 72, 96];

const SURFACES = [
  { name: "浅色", background: "#ffffff", color: "#262626", border: "#ececec" },
  { name: "灰色", background: "#ecebe9", color: "#101010", border: "transparent" },
  { name: "深色", background: "#161616", color: "#f8fafb", border: "transparent" },
  { name: "橙色", background: "#f45300", color: "#ffffff", border: "transparent", accent: "#ffffff", accentAlt: "#101010" },
];

const LAP = 2.4;

export function BrandLoaderDemo({ initialAt }: { initialAt: number | null }) {
  const [slow, setSlow] = useState(false);
  const [busyButton, setBusyButton] = useState(true);
  const [busyCard, setBusyCard] = useState(true);

  const duration = slow ? LAP * 4 : LAP;
  // ?at=0.26 parks every loader at that moment of the lap, to look at one frame.
  const vars = {
    "--loader-duration": `${duration}s`,
    ...(initialAt !== null ? { "--loader-shift": `${-initialAt * duration}s`, "--loader-play": "paused" } : null),
  } as CSSProperties;

  return (
    <main className={styles.page} style={vars}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>COMPONENT · LOADING</p>
          <h1>BrandLoader</h1>
          <p className={styles.lead}>
            数据包在 Logo 的三个中继节点之间逐跳传递，到站的节点会鼓起、扩出涟漪，并变成数据包的颜色。每三次到站为一组，两组颜色交替：浅色底是橙与黑，深色底是橙与白，节点因此一次次换色。纯 SVG + CSS，一圈 {duration.toFixed(1)} 秒，两圈一个颜色周期。
          </p>
          <div className={styles.tools}>
            <button className={styles.tool} data-on={slow} onClick={() => setSlow((value) => !value)} type="button">
              慢放 ×0.25
            </button>
            {initialAt !== null && <span className={styles.frame}>停在第 {Math.floor(initialAt) + 1} 圈的 {Math.round((initialAt % 1) * 100)}%</span>}
          </div>
        </header>

        <section className={styles.section}>
          <h2>放大看</h2>
          <div className={styles.stage}>
            <BrandLoader size={200} />
          </div>
        </section>

        <section className={styles.section}>
          <h2>尺寸</h2>
          <div className={styles.sizes}>
            {SIZES.map((size) => (
              <figure key={size} className={styles.size}>
                <BrandLoader size={size} />
                <figcaption>{size}px</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>底色</h2>
          <div className={styles.surfaces}>
            {SURFACES.map(({ name, background, color, border, accent, accentAlt }) => (
              <figure key={name} className={styles.surface} style={{ background, color, borderColor: border }}>
                <BrandLoader accent={accent} accentAlt={accentAlt} size={56} />
                <figcaption>{name}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>按钮里</h2>
          <div className={styles.buttons}>
            <button className={styles.primary} disabled={busyButton} onClick={() => setBusyButton(false)} type="button">
              {busyButton ? <BrandLoader accent="#ffffff" accentAlt="#101010" label="处理中" size={16} /> : null}
              {busyButton ? "处理中…" : "重新提交"}
            </button>
            <button className={styles.secondary} disabled={busyButton} type="button">
              {busyButton ? <BrandLoader label="处理中" size={16} /> : null}
              {busyButton ? "处理中…" : "保存草稿"}
            </button>
            <button className={styles.ghost} onClick={() => setBusyButton(true)} type="button">
              {busyButton ? "（点上面的按钮结束）" : "再来一次"}
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2>盖在内容上</h2>
          <div className={styles.cardRow}>
            <LoaderOverlay busy={busyCard} className={styles.card} label="正在加载节点">
              <div className={styles.cardBody}>
                <Skeleton style={{ width: 120, height: 14 }} />
                <Skeleton style={{ width: "72%", height: 28 }} />
                <Skeleton style={{ width: "100%", height: 12 }} />
                <Skeleton style={{ width: "88%", height: 12 }} />
                <Skeleton style={{ width: "94%", height: 12 }} />
              </div>
            </LoaderOverlay>
            <button className={styles.tool} data-on={busyCard} onClick={() => setBusyCard((value) => !value)} type="button">
              {busyCard ? "加载中（点击结束）" : "已加载（点击重新加载）"}
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2>带文字</h2>
          <div className={styles.labels}>
            <BrandLoader label="正在获取节点列表" showLabel size={20} />
            <BrandLoader label="Syncing subscription" showLabel size={24} />
          </div>
        </section>
      </div>
    </main>
  );
}
