"use client";

import { SiteFooter } from "@/components/footer/site-footer";
import { HomeHeader } from "@/components/home-header";
import { PricingCards, PricingHero } from "@/components/pricing/pricing-plans";
import { PricingTables } from "@/components/pricing/pricing-tables";
import { useDemoLocale } from "@/lib/demo-site/locale";
import { pricingCopy } from "@/lib/pricing-copy";
import styles from "@/components/pricing/pricing-page.module.css";

/** The pricing page (src/app/pricing/page.tsx) with the language read in the browser. */
export function DemoPricing() {
  const locale = useDemoLocale();
  const copy = pricingCopy[locale];
  return (
    <div className={styles.page} lang={copy.lang}>
      <HomeHeader locale={locale} />
      <main className={`${styles.column} ${styles.underHeader}`}>
        <PricingHero copy={copy} />
        <PricingCards copy={copy} />
        <PricingTables copy={copy} />
      </main>
      <SiteFooter locale={locale} current="/pricing" />
    </div>
  );
}
