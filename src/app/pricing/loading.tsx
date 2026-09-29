import { Skeleton } from "@/components/skeleton";
import styles from "@/components/pricing/pricing-page.module.css";

// Shown while the pricing page loads: the hero, three cards and a table, in
// the same places.
export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true">
      <div className={styles.column}>
        <section className={styles.hero}>
          <Skeleton style={{ width: 420, maxWidth: "70%", height: 100 }} />
        </section>
        <div className={styles.spacer} />
        <section className={styles.band}>
          <div className={styles.plans}>
            {[0, 1, 2].map((index) => (
              <div key={index} className={styles.plan} style={{ height: 520, padding: 32, gap: 16 }}>
                <Skeleton style={{ width: 80, height: 16 }} />
                <Skeleton style={{ width: 140, height: 32 }} />
                <Skeleton style={{ width: "90%", height: 40 }} />
                <Skeleton style={{ width: "100%", height: 40 }} />
              </div>
            ))}
          </div>
        </section>
        <div className={styles.table} style={{ marginTop: 88 }}>
          <div className={styles.panel} style={{ padding: 24, display: "grid", gap: 14 }}>
            {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} style={{ width: "100%", height: 30 }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
