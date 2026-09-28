import type { ReactNode } from "react";
import { LayoutDashboard } from "lucide-react";
import { BentoReveal, DeviceSeats, NodeStatus, SubscriptionFeed, UsageMeter } from "@/components/feature-bento-cards";
import { featureCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-bento.module.css";

// Feature showcase: a bento grid laid out after cloudflare.com's "Tailored
// to your team" block (see feature-bento.module.css for the measurements).
// Every card describes something the product does today; the moving parts
// with numbers are marked as sample data.

function Card({ span, title, children, visual, split = false }: { span: string; title: string; children: ReactNode; visual: ReactNode; split?: boolean }) {
  return (
    <article className={`${styles.card} ${span} ${split ? styles.split : ""}`}>
      {split && (
        <div className={styles.copy}>
          <h3>{title}</h3>
          <p>{children}</p>
        </div>
      )}
      <div className={styles.visual}>{visual}</div>
      {!split && (
        <div className={styles.copy}>
          <h3>{title}</h3>
          <p>{children}</p>
        </div>
      )}
    </article>
  );
}

export function FeatureBento({ locale }: { locale: HomeLocale }) {
  const { bento } = featureCopy[locale];
  return (
    <div className={styles.frame}>
      <span className={styles.tick} aria-hidden="true" />
      <span className={styles.tick} aria-hidden="true" />
      <span className={styles.tick} aria-hidden="true" />
      <span className={styles.tick} aria-hidden="true" />

      <BentoReveal className={styles.grid}>
        <Card span={styles.span8} title={bento.feed.title} visual={<SubscriptionFeed locale={locale} />}>
          {bento.feed.body}
        </Card>

        <article className={`${styles.accentCard} ${styles.span4}`}>
          <LayoutDashboard className={styles.accentIcon} size={28} strokeWidth={1.6} aria-hidden="true" />
          <h3>{bento.account.title}</h3>
          <p>{bento.account.body}</p>
        </article>

        <Card
          span={styles.span4}
          title={bento.protocols.title}
          visual={(
            <div className={styles.protocols}>
              <span className={styles.dotMark} aria-hidden="true">
                {[0.5, 0.25, 0.5, 0.25, 0, 0.25, 0.5, 0.25, 0.5].map((delay, index) => (
                  <i key={index} style={{ animationDelay: `${delay}s` }} />
                ))}
              </span>
              <div className={styles.chips}>
                <span className={styles.chip}>VLESS <b>+ REALITY</b></span>
                <span className={styles.chip}>VMess</span>
                <span className={styles.chip}>Trojan</span>
              </div>
            </div>
          )}
        >
          {bento.protocols.body}
        </Card>

        <Card span={styles.span8} split title={bento.status.title} visual={<NodeStatus locale={locale} />}>
          {bento.status.body}
        </Card>

        <Card span={styles.span6} title={bento.devices.title} visual={<DeviceSeats locale={locale} />}>
          {bento.devices.body}
        </Card>

        <Card span={styles.span6} title={bento.usage.title} visual={<UsageMeter locale={locale} />}>
          {bento.usage.body}
        </Card>
      </BentoReveal>
    </div>
  );
}
