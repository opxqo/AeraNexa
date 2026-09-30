"use client";

// Split-flap ("airport board") display.
// Source: Componentry, "Split Flap Display" on 21st.dev (https://21st.dev/@componentry/components/split-flap-display),
// MIT licence as listed there. Keep this notice.
// Reworked for this project: the original only knew A-Z, 0-9 and punctuation and stepped each cell through
// that alphabet, which cannot land on Chinese. Cells now flip through a few characters taken from a
// `charset` you pass (the characters of the messages) and settle on the target. The dark skeuomorphic chrome,
// indicator strips and multi-row mode were dropped: it is one row of cells drawn with our tokens, and the
// card around it is the caller's. Also: flips are timer chains that clean up, and `animate={false}` jumps.

import * as React from "react";
import { cn } from "cn";

type Size = "xs" | "sm" | "md";

const SIZES: Record<Size, { w: number; h: number; font: number; gap: number }> = {
  xs: { w: 18, h: 28, font: 14, gap: 2 },
  sm: { w: 22, h: 32, font: 17, gap: 2 },
  md: { w: 30, h: 44, font: 24, gap: 3 },
};

/** Width in px of `columns` cells of a size, to work out how many fit a container. */
export const flapCellPitch = (size: Size) => SIZES[size].w + SIZES[size].gap;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function Glyph({ char, height }: { char: string; height: number }) {
  return (
    <span className="absolute inset-x-0 flex items-center justify-center leading-none" style={{ height }}>
      {char}
    </span>
  );
}

const HALF = "absolute inset-x-0 overflow-hidden";
const TOP = "bg-[color-mix(in_oklab,var(--primary),white_9%)]";
const BOTTOM = "bg-[color-mix(in_oklab,var(--primary),white_4%)]";

function FlapCell({ target, size, delay, flipSpeed, pool, animate }: { target: string; size: Size; delay: number; flipSpeed: number; pool: string[]; animate: boolean }) {
  const { w, h, font } = SIZES[size];
  const [current, setCurrent] = React.useState(animate ? " " : target);
  const [next, setNext] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "top" | "bottom">("idle");
  const shown = React.useRef(current);

  React.useEffect(() => {
    if (shown.current === target) return;
    let cancelled = false;

    const settle = (char: string) => {
      shown.current = char;
      setCurrent(char);
      setNext(null);
      setPhase("idle");
    };

    const run = async () => {
      if (!animate) return settle(target);
      await sleep(delay);
      const candidates = pool.filter((char) => char !== target && char !== shown.current);
      const steps = Array.from({ length: candidates.length ? 2 + Math.floor(Math.random() * 3) : 0 }, () => candidates[Math.floor(Math.random() * candidates.length)]);
      for (const char of [...steps, target]) {
        if (cancelled) return;
        setNext(char);
        setPhase("top");
        await sleep(flipSpeed / 2);
        if (cancelled) return;
        setPhase("bottom");
        await sleep(flipSpeed / 2);
        if (cancelled) return;
        settle(char);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [target, delay, flipSpeed, pool, animate]);

  const top = next ?? current;
  return (
    <span aria-hidden="true" className="relative block shrink-0 select-none font-medium text-primary-foreground" style={{ width: w, height: h, fontSize: font, perspective: 240 }}>
      <span className={cn(HALF, "top-0 h-1/2 rounded-t-[3px]", TOP)}>
        <Glyph char={top} height={h} />
      </span>
      <span className={cn(HALF, "bottom-0 h-1/2 rounded-b-[3px]", BOTTOM)}>
        <span className="absolute inset-x-0 bottom-0" style={{ height: h }}>
          <Glyph char={current} height={h} />
        </span>
      </span>
      {phase === "top" && (
        <span className={cn(HALF, "top-0 z-10 h-1/2 rounded-t-[3px]", TOP)} style={{ transformOrigin: "bottom", animation: `flap-top ${flipSpeed / 2}ms ease-in forwards` }}>
          <Glyph char={current} height={h} />
        </span>
      )}
      {phase === "bottom" && next !== null && (
        <span className={cn(HALF, "bottom-0 z-10 h-1/2 rounded-b-[3px]", BOTTOM)} style={{ transformOrigin: "top", animation: `flap-bottom ${flipSpeed / 2}ms ease-out forwards` }}>
          <span className="absolute inset-x-0 bottom-0" style={{ height: h }}>
            <Glyph char={next} height={h} />
          </span>
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-px -translate-y-1/2 bg-black/60" />
    </span>
  );
}

export type SplitFlapDisplayProps = {
  /** What the row spells. Longer than `columns`: cut with an ellipsis. Shorter: padded with blanks. */
  text: string;
  /** Number of cells in the row. */
  columns: number;
  size?: Size;
  /** Characters the cells flip through on their way to the target. Usually the characters of your messages. */
  charset?: string;
  /** Delay in ms between one cell starting to flip and the next (makes a wave). */
  staggerDelay?: number;
  /** Duration in ms of one flap. */
  flipSpeed?: number;
  /** false: no flipping, the text just appears (for prefers-reduced-motion). */
  animate?: boolean;
  className?: string;
};

export function SplitFlapDisplay({ text, columns, size = "sm", charset = "", staggerDelay = 14, flipSpeed = 70, animate = true, className }: SplitFlapDisplayProps) {
  const pool = React.useMemo(() => Array.from(new Set(Array.from(charset.replace(/\s/g, "").toUpperCase()))), [charset]);
  const chars = Array.from(text.toUpperCase());
  const cells = chars.length > columns ? [...chars.slice(0, Math.max(0, columns - 1)), "…"] : [...chars, ...Array.from({ length: columns - chars.length }, () => " ")];
  return (
    <span className={cn("flex", className)} style={{ gap: SIZES[size].gap }}>
      {cells.map((char, index) => (
        <FlapCell key={index} target={char} size={size} delay={index * staggerDelay} flipSpeed={flipSpeed} pool={pool} animate={animate} />
      ))}
    </span>
  );
}

export default SplitFlapDisplay;
