import Link from "next/link";
import type { PricingCopy } from "@/lib/pricing-copy";
import { PlanScene } from "./pricing-scenes";
import styles from "./pricing-page.module.css";

// The hero's picture is pixel art after lightdash.com's: 20px cells with a fine
// diagonal hatch, drawn here in the site's orange. The plan cards' pictures
// are in pricing-scenes.tsx.
function Hatch() {
  return (
    <defs>
      <pattern id="px-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="3" stroke="#fff" strokeOpacity=".2" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

function Cell({ x, y, w, h, fill }: { x: number; y: number; w: number; h: number; fill: string }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill={fill} />
      <rect x={x} y={y} width={w} height={h} fill="url(#px-hatch)" />
    </>
  );
}

// The hero's picture: 11 × 10 cells of bars. Rows 0–5 have cells in columns
// 2–6 and 9–10, rows 6–9 in columns 0–5 and 7–8, one colour per column.
const HERO_TOP: Record<number, string> = { 2: "#7a6a60", 3: "#ffb27a", 4: "#2a1408", 5: "#7a2400", 6: "#f45300", 9: "#ff8a3d", 10: "#ff7a2f" };
const HERO_BOTTOM: Record<number, string> = { 0: "#8f7a6c", 1: "#ffb88a", 2: "#4a1e08", 3: "#5c1a00", 4: "#ff6a1f", 5: "#2a1408", 7: "#c43c00", 8: "#ff8a3d" };

function HeroMosaic({ className }: { className: string }) {
  const w = 223 / 11;
  const h = 209 / 10;
  const cells: { row: number; column: number; fill: string }[] = [];
  for (let row = 0; row < 10; row += 1) {
    const palette = row < 6 ? HERO_TOP : HERO_BOTTOM;
    for (const [column, fill] of Object.entries(palette)) cells.push({ row, column: Number(column), fill });
  }
  return (
    <svg className={className} viewBox="0 0 223 209" shapeRendering="crispEdges" aria-hidden="true">
      <Hatch />
      {cells.map(({ row, column, fill }) => <Cell key={`${row}-${column}`} x={column * w} y={row * h} w={w + 0.5} h={h + 0.5} fill={fill} />)}
    </svg>
  );
}

// A 9 × 7 check: a two-pixel line with square ends.
function Tick() {
  return (
    <svg className={styles.tick} viewBox="0 0 8.333 6.666" fill="none" aria-hidden="true">
      <path d="M0 4.166 2.5 6.666 8.333 0" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeMiterlimit="10" />
    </svg>
  );
}

/** The pricing page's hero: the headline and a mosaic. */
export function PricingHero({ copy }: { copy: PricingCopy }) {
  return (
    <>
      <section className={styles.hero}>
        <h1>{copy.hero.lead}<br />{copy.hero.tail}</h1>
        <HeroMosaic className={styles.heroArt} />
      </section>
      <div className={styles.spacer} />
    </>
  );
}

/** The three plan cards (the pricing page, and the bottom of the home page). */
export function PricingCards({ copy }: { copy: PricingCopy }) {
  return (
    <>
      <section className={styles.band} aria-label={copy.compare.title}>
        <div className={styles.plans}>
          {copy.plans.map((plan) => (
            <article key={plan.label} className={styles.plan} data-featured={plan.featured ? "" : undefined} data-night={plan.tone ? "" : undefined}>
              <PlanScene scene={plan.scene} dark={Boolean(plan.featured || plan.tone)} className={styles.scene} />
              <div className={styles.planTop}>
                <div className={styles.planLabel}>{plan.label}</div>
                <div className={styles.planTitle}>
                  <span className={styles.planHeadline}>{plan.price ? plan.price.amount : plan.headline}</span>
                  {plan.price && <span className={styles.planUnit}>{plan.price.unit}</span>}
                </div>
                <p className={styles.planBlurb}>{plan.lead && <b>{plan.lead} </b>}{plan.blurb}</p>
                <Link className={styles.button} href={plan.cta.href}>{plan.cta.label}</Link>
              </div>
              <div className={styles.planEyebrow}>{plan.eyebrow}</div>
              <ul className={styles.features}>
                {plan.features.map((feature) => (
                  <li key={feature} className={styles.feature}><Tick />{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
