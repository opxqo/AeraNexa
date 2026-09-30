import type { CSSProperties, ReactNode } from "react";
import styles from "./brand-loader.module.css";

// The site's own loading animation, drawn on the logo (brand-mark.tsx, viewBox 64): a packet of
// light hops relay to relay round the mark, left node → apex → right node, then home along the
// signal arc. Each stop is a beat: the node swells, takes the packet's colour and sends out a ring.
// The three arrivals of a lap are a group; groups alternate colour, orange then the text colour
// (black on a light page, white on a dark one), so the nodes keep changing colour and the packet
// changes with them. Pure SVG and CSS, so it renders on
// the server and costs nothing to keep running.
//
// The packet is a dash on one closed path (`pathLength` 1); the stylesheet slides its head round
// the loop in three eased hops, with a dwell at each node. The loop is 155.75 units long (two legs
// of 48.56, the arc 58.62), so the apex sits at 0.3118 of it and the right node at 0.6236: those
// two numbers are written into the keyframes in brand-loader.module.css, which must agree.

const APEX = { x: 32, y: 11 };
const LEFT = { x: 8.5, y: 53.5 };
const RIGHT = { x: 55.5, y: 53.5 };

// Legs, then the signal arc walked backwards, so the loop closes on itself.
const LOOP = "M8.5 53.5 L32 11 L55.5 53.5 C46 40 39 38.3 32 38.3 C25 38.3 18 40 8.5 53.5";

type BrandLoaderProps = {
  /** Width and height in px. */
  size?: number;
  /** The first group's colour: the brand orange unless given (white on an orange button). */
  accent?: string;
  /** The second group's colour: the surrounding text colour (black on light, white on dark) unless given. */
  accentAlt?: string;
  /** Read out by screen readers, and shown beside the mark with `showLabel`. */
  label?: string;
  showLabel?: boolean;
  /** Seconds per lap. Or set `--loader-duration` on a parent to slow a whole group. */
  duration?: number;
  /** Start as the solid logo (exactly BrandMark's drawing) and fade the lines down as the packet leaves. */
  intro?: boolean;
  /** Come to rest as the plain logo: lines solid again, node colours, rings and packet faded out. */
  settled?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function BrandLoader({ size = 32, accent, label = "Loading", showLabel = false, duration, accentAlt, intro = false, settled = false, className = "", style }: BrandLoaderProps) {
  // Thin strokes vanish at small sizes: fatten them below 24px.
  const compact = size < 24;
  const stroke = compact ? 7.2 : 5;
  const radius = compact ? 7.6 : 6;
  const vars = {
    "--size": `${size}px`,
    ...(accent ? { "--loader-accent": accent } : null),
    ...(accentAlt ? { "--loader-accent-alt": accentAlt } : null),
    ...(duration ? { "--loader-duration": `${duration}s` } : null),
    ...style,
  } as CSSProperties;

  return (
    <span className={`${styles.loader} ${className}`.trim()} data-intro={intro || undefined} data-settled={settled || undefined} role="status" style={vars}>
      <svg aria-hidden="true" className={styles.svg} viewBox="0 0 64 64">
        <path className={styles.track} d={LOOP} strokeWidth={stroke} />

        <g className={styles.cometWrap}>
          <g className={styles.comet}>
            <path className={`${styles.packet} ${styles.glow}`} d={LOOP} pathLength={1} strokeWidth={stroke * 1.9} />
            <path className={`${styles.packet} ${styles.tailFar}`} d={LOOP} pathLength={1} strokeWidth={stroke} />
            <path className={`${styles.packet} ${styles.tailNear}`} d={LOOP} pathLength={1} strokeWidth={stroke} />
            <path className={`${styles.packet} ${styles.head}`} d={LOOP} pathLength={1} strokeWidth={stroke} />
          </g>
        </g>

        {[
          { at: APEX, stop: styles.stopApex },
          { at: RIGHT, stop: styles.stopRight },
          { at: LEFT, stop: styles.stopLeft },
        ].map(({ at, stop }) => (
          <g key={stop} className={stop}>
            <g className={styles.hue}>
              <circle className={styles.ring} cx={at.x} cy={at.y} r={radius} strokeWidth={stroke * 0.4} />
            </g>
            <circle className={styles.node} cx={at.x} cy={at.y} r={radius} />
            <g className={styles.hue}>
              <circle className={styles.tint} cx={at.x} cy={at.y} r={radius + 0.3} />
            </g>
          </g>
        ))}
      </svg>
      {showLabel ? <span className={styles.text}>{label}</span> : <span className={styles.sr}>{label}</span>}
    </span>
  );
}

/** Content with a loader laid over it while `busy`: the content dims and softens, and can't be clicked. */
export function LoaderOverlay({ busy, label, children, className = "" }: { busy: boolean; label?: string; children: ReactNode; className?: string }) {
  return (
    <div aria-busy={busy} className={`${styles.host} ${className}`.trim()}>
      <div className={styles.content} data-busy={busy}>
        {children}
      </div>
      {busy && (
        <div className={styles.overlay}>
          <BrandLoader label={label} size={40} />
        </div>
      )}
    </div>
  );
}
