import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HomeHeader } from "@/components/home-header";
import { WorldMapCap } from "@/components/world-map-cap";
import { homeCopy, type HomeLocale } from "@/lib/home-copy";
import styles from "@/app/home-hero.module.css";

export function HomeHero({ locale }: { locale: HomeLocale }) {
  const copy = homeCopy[locale];
  const { hero } = copy;

  return (
    <div className={styles.page} lang={copy.lang}>
      <HomeHeader locale={locale} />

      <main>
        <section className={styles.intro} aria-labelledby="home-heading">
          <p className={styles.eyebrow}>GLOBAL NETWORK <span>·</span> HIGH-SPEED <span>·</span> SECURE</p>
          <h1 id="home-heading">{hero.lead}<br /><span>{hero.highlight}</span>{hero.tail}</h1>
          <p className={styles.description}>{hero.description}</p>
          <div className={styles.ctaRow}>
            <Link className={styles.primaryCta} href="/register">{hero.primary} <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></Link>
            <Link className={styles.secondaryCta} href="/plan">{hero.secondary}</Link>
          </div>
        </section>

        <div className={styles.mapViewport} aria-label={hero.mapLabel}>
          <WorldMapCap className={styles.mapCanvas} label={hero.mapImageLabel} />
        </div>
      </main>
    </div>
  );
}
