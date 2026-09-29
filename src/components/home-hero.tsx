import { HomeHeader } from "@/components/home-header";
import { FeatureBento } from "@/components/feature-bento";
import { FeatureClients } from "@/components/feature-clients";
import { FeatureTabs } from "@/components/feature-tabs";
import { HomePricing } from "@/components/home-pricing";
import { HomeRelay } from "@/components/home-relay";
import { featureCopy } from "@/lib/feature-copy";
import { homeCopy, type HomeLocale } from "@/lib/home-copy";
import styles from "@/app/home-hero.module.css";
import featureStyles from "@/components/feature-bento.module.css";
import relayStyles from "@/components/home-relay.module.css";

// The home page: the hero, whose map carries on into the first feature block
// (HomeRelay), then the rest of the feature blocks.
export function HomeHero({ locale }: { locale: HomeLocale }) {
  const copy = homeCopy[locale];
  const { sections } = featureCopy[locale];

  return (
    <div className={styles.page} lang={copy.lang}>
      <HomeHeader locale={locale} />

      <main>
        <HomeRelay locale={locale} />

        <section className={`${featureStyles.page} ${relayStyles.features}`}>
          <span className={`${featureStyles.rails} ${featureStyles.outer}`} aria-hidden="true" />
          <span className={featureStyles.rails} aria-hidden="true" />

          <header className={featureStyles.head}>
            <h2>{sections.stableTitle}</h2>
            <p>{sections.stableLead}</p>
          </header>
          <FeatureBento locale={locale} />

          <header className={`${featureStyles.head} ${featureStyles.secondHead}`}>
            <h2>{sections.detailTitle}</h2>
            <p>{sections.detailLead}</p>
          </header>
          <FeatureTabs locale={locale} />

          <div className={featureStyles.block}><FeatureClients locale={locale} /></div>

          <HomePricing locale={locale} />
        </section>
      </main>
    </div>
  );
}
