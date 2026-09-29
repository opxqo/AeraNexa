import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PricingCards } from "@/components/pricing/pricing-plans";
import { pricingCopy } from "@/lib/pricing-copy";
import type { HomeLocale } from "@/lib/home-copy";
import featureStyles from "@/components/feature-bento.module.css";
import styles from "@/components/pricing/pricing-page.module.css";

// The bottom of the home page: the three plan cards (the same as on /pricing),
// with a link on to the full comparison.
export function HomePricing({ locale }: { locale: HomeLocale }) {
  const copy = pricingCopy[locale];
  return (
    <>
      <header className={`${featureStyles.head} ${featureStyles.secondHead}`}>
        <h2>{copy.home.title}</h2>
        <p>{copy.home.lead}</p>
      </header>
      <div className={styles.page} data-embed="" lang={copy.lang}>
        <PricingCards copy={copy} />
        <p className={styles.homeMore}>
          <Link href="/pricing">{copy.home.more} <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" /></Link>
        </p>
      </div>
    </>
  );
}
