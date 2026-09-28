import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { FeatureBento } from "@/components/feature-bento";
import { FeatureClients } from "@/components/feature-clients";
import { FeatureTabs } from "@/components/feature-tabs";
import { FeatureUnlock } from "@/components/feature-unlock";
import { featureCopy } from "@/lib/feature-copy";
import { HOME_LOCALE_COOKIE, toHomeLocale } from "@/lib/home-copy";
import styles from "@/components/feature-bento.module.css";

export const metadata: Metadata = {
  title: "特性展示 Demo",
  description: "AeraNexa 首页特性展示区（Bento Grid）演示，布局参照 cloudflare.com",
};

export default async function FeaturesDemoPage() {
  // Same language cookie as the home page.
  const locale = toHomeLocale((await cookies()).get(HOME_LOCALE_COOKIE)?.value);
  const { sections, lang } = featureCopy[locale];

  return (
    <main className={styles.page} lang={lang}>
      <span className={`${styles.rails} ${styles.outer}`} aria-hidden="true" />
      <span className={styles.rails} aria-hidden="true" />

      <div className={styles.backRow}>
        <Link className={styles.back} href="/"><ArrowLeft size={16} /> 返回首页</Link>
      </div>

      <FeatureUnlock locale={locale} />

      <header className={`${styles.head} ${styles.secondHead}`}>
        <h2>{sections.stableTitle}</h2>
        <p>{sections.stableLead}</p>
      </header>

      <FeatureBento locale={locale} />

      <header className={`${styles.head} ${styles.secondHead}`}>
        <h2>{sections.detailTitle}</h2>
        <p>{sections.detailLead}</p>
      </header>

      <FeatureTabs locale={locale} />

      <div className={styles.block}><FeatureClients locale={locale} /></div>
    </main>
  );
}
