"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandLoader } from "@/components/brand-loader";
import { useReducedMotion } from "@/components/splash/use-reduced-motion";
import { finishEntering, useEntering, type EnterRequest } from "@/lib/enter-panel";
import styles from "./enter-splash.module.css";

// The hand-over after a successful sign-in or sign-up, as one continuous shot:
//   leave   the page fades to its own colour while the logo, drawn exactly where the auth page's
//           is, stays put and comes alive (BrandLoader, starting as the plain logo)
//   wait    the logo glides to the middle of the screen, drawing in as it goes, and a bar appears
//           under it; the packet hops round the logo and the bar creeps along while the panel loads
//   land    with the panel there and the bar full, the logo settles into the plain mark and flies to the sidebar's,
//           shrinking and taking its colour; the page colour fades away and the panel comes in
//   done    the sidebar's own logo takes over
// It lives in the root layout because the auth page is gone the moment the route changes.

const LEAVE_MS = 320; // the backdrop's fade-in (enter-splash.module.css)
const MIN_WAIT_MS = 1000; // the loader gets to show itself, even when the panel is instant
const LAND_HOLD_MS = 120; // the bar full, held a beat before the logo leaves
const WAIT_SIZE = 32; // the logo draws in to this while it waits (it starts as big as the auth page's)
const BAR_WIDTH = 150;
const BAR_GAP = 18; // between the logo and the bar
const BAR_HEIGHT = 2;
const GIVE_UP_MS = 15000; // a slow first compile in development is not a reason to give up early
const FLIGHT_MS = 720;

export function EnterSplash() {
  const request = useEntering();
  return request ? <Entering key={request.id} request={request} /> : null;
}

function Entering({ request }: { request: EnterRequest }) {
  const { to, from } = request;
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const arrived = useRef(false);
  const [settled, setSettled] = useState(false);

  // The route changes only once the backdrop has closed over the page, or the panel would show
  // through it for a moment.
  useEffect(() => {
    const timer = setTimeout(() => router.push(to), LEAVE_MS + 30);
    return () => clearTimeout(timer);
  }, [router, to]);

  useEffect(() => {
    arrived.current = pathname === to || pathname.startsWith(`${to}/`);
  }, [pathname, to]);

  useEffect(() => {
    const root = rootRef.current;
    const mark = markRef.current;
    const bar = barRef.current;
    const fill = fillRef.current;
    if (!root || !mark || !bar || !fill) return;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    const previousGutter = html.style.scrollbarGutter;
    html.style.overflow = "hidden";

    // While waiting, the logo and the bar under it sit together in the middle of the screen: the
    // logo glides there from the auth page's (drawing in as it goes) and the bar is placed under it.
    const shrink = Math.min(1, WAIT_SIZE / from.width);
    const place = () => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      const size = from.width * shrink;
      const top = (height - (size + BAR_GAP + BAR_HEIGHT)) / 2; // the pair, centred as one
      const left = (width - size) / 2;
      mark.style.transform = `translate(${left - from.left}px, ${top - from.top}px) scale(${shrink})`;
      bar.style.left = `${(width - BAR_WIDTH) / 2}px`;
      bar.style.top = `${top + size + BAR_GAP}px`;
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    let cancelled = false;
    let fontsReady = false;
    const started = performance.now();
    document.fonts.ready.then(() => {
      fontsReady = true;
    });

    const finish = (delay: number) => {
      timers.push(
        setTimeout(() => {
          html.dataset.enter = "done";
          finishEntering();
          // Not among `timers`: it has to outlive this component, which finishEntering() unmounts.
          setTimeout(() => delete html.dataset.enter, 400);
        }, delay),
      );
    };

    const land = () => {
      // Measure before the panel starts to move: this is where the sidebar's logo will rest.
      const box = document.querySelector("[data-enter-target]")?.getBoundingClientRect();
      const fits = box && box.width > 0 && box.left >= 0 && box.left < window.innerWidth && box.top >= 0;
      root.dataset.phase = "land";
      setSettled(true);
      // The panel is taller than the screen and will have a scrollbar: keep its room while scrolling is
      // off, so nothing shifts when it is given back. (Not before: the auth page has none, and keeping
      // room for one there would push the page, and the logo with it, to one side.)
      if (html.scrollHeight > window.innerHeight) html.style.scrollbarGutter = "stable";
      html.dataset.enter = "land";
      if (fits && !reduced) {
        mark.style.transform = `translate(${box.left - from.left}px, ${box.top - from.top}px) scale(${box.width / from.width})`;
        mark.style.color = "rgba(255, 255, 255, .68)"; // the brand bar's own colour (globals.css .brand)
        finish(FLIGHT_MS + 60);
      } else {
        mark.dataset.away = ""; // no sidebar to land in (narrow screens, reduced motion): just let go
        finish(reduced ? 300 : 700);
      }
    };

    // The bar is the wait made visible: it creeps toward 90% over the minimum wait, and only fills
    // once the panel is really there, so it is full exactly when the logo is about to leave.
    let shown = 0;
    let last = started;
    let full = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - started;
      const dt = Math.min(64, now - last);
      last = now;
      const ready = arrived.current && fontsReady && !!document.querySelector("[data-enter-target]");
      const goal = ready && elapsed >= MIN_WAIT_MS ? 1 : 0.9 * (1 - Math.pow(1 - Math.min(1, elapsed / MIN_WAIT_MS), 2.2));
      shown += (goal - shown) * (1 - Math.exp(-dt / 140));
      if (goal === 1 && shown > 0.995 && !full) {
        full = true;
        fill.style.transform = "scaleX(1)";
        timers.push(setTimeout(land, LAND_HOLD_MS));
        return;
      }
      fill.style.transform = `scaleX(${shown})`;
      if (elapsed >= GIVE_UP_MS) {
        root.dataset.phase = "land";
        mark.dataset.away = "";
        finish(700);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    // The first frame is drawn transparent; the next one starts the fade.
    raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.dataset.phase = "wait";
        place();
        raf = requestAnimationFrame(tick);
      }),
    );

    // Keep them centred if the window changes size while waiting.
    const onResize = () => {
      if (root.dataset.phase === "wait") place();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      html.style.overflow = previousOverflow;
      html.style.scrollbarGutter = previousGutter;
    };
    // The request is fixed for this component's life (it is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className={styles.root} data-phase="leave">
      <div className={styles.backdrop} />
      <div
        ref={markRef}
        className={styles.mark}
        data-enter-mark=""
        style={{ left: from.left, top: from.top, width: from.width, height: from.height }}
      >
        <BrandLoader intro label="Loading" settled={settled} size={from.width} />
      </div>
      <div ref={barRef} aria-hidden="true" className={styles.bar} style={{ width: BAR_WIDTH }}>
        <span ref={fillRef} className={styles.fill} />
      </div>
    </div>
  );
}
