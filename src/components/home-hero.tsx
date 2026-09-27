import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HomeHeader } from "@/components/home-header";
import { WorldMapCap } from "@/components/world-map-cap";
import styles from "@/app/home-hero.module.css";

export function HomeHero() {
  return (
    <div className={styles.page}>
      <HomeHeader />

      <main>
        <section className={styles.intro} aria-labelledby="home-heading">
          <p className={styles.eyebrow}>GLOBAL NETWORK <span>·</span> HIGH-SPEED <span>·</span> SECURE</p>
          <h1 id="home-heading">更快，更稳定的<br /><span>全球网络</span>连接。</h1>
          <p className={styles.description}>AeraNexa 提供高速、稳定、安全的全球节点，让你随时随地连接更广阔的世界。</p>
          <div className={styles.ctaRow}>
            <Link className={styles.primaryCta} href="/register">立即开始 <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></Link>
            <Link className={styles.secondaryCta} href="/plan">查看套餐</Link>
          </div>
        </section>

        <div className={styles.mapViewport} aria-label="全球节点网络示意图">
          <WorldMapCap className={styles.mapCanvas} />
        </div>
      </main>
    </div>
  );
}
