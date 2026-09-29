import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteFooter } from "@/components/footer/site-footer";
import { HomeHeader } from "@/components/home-header";
import { PricingCards, PricingHero } from "@/components/pricing/pricing-plans";
import { PricingTables } from "@/components/pricing/pricing-tables";
import { HOME_LOCALE_COOKIE, toHomeLocale } from "@/lib/home-copy";
import { pricingCopy } from "@/lib/pricing-copy";
import styles from "@/components/pricing/pricing-page.module.css";

// The language picked in the header lives in a cookie, as on the home page.
async function readLocale() {
  return toHomeLocale((await cookies()).get(HOME_LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = pricingCopy[await readLocale()];
  return { title: meta.title, description: meta.description };
}

// The public pricing page: the plans, then the comparison tables. (/plan is
// the signed-in "buy a subscription" page.)
export default async function PricingPage() {
  const locale = await readLocale();
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
