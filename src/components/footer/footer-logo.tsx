"use client";

import { useEffect, useRef } from "react";
import styles from "./site-footer.module.css";

// The wordmark at the bottom of the footer, made of grey dots (after
// unitedcarriers.com's, whose script this follows): the word is drawn once on
// an offscreen canvas, and a dot is placed every 4·dpr pixels wherever it is
// solid. Each dot starts somewhere random on a canvas 1.5 × 3 times the box,
// and eases home (ease .04–.08, friction .8–.95). While the pointer moves,
// dots within √(3000·dpr) of it are thrown away from it and settle back.
// Only above 991px, and only while it is on screen.
const COLOR = "#a0a0a0";
const GAP = 4;
const PUSH = 3000;

type Dot = { ox: number; oy: number; x: number; y: number; vx: number; vy: number; ease: number; hover: number; friction: number };

export function FooterLogo({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!box || !canvas || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 991px)");

    let dots: Dot[] = [];
    let dpr = 1;
    let frame = 0;
    let visible = false;
    let disposed = false;
    const mouse = { x: -1000, y: -1000, active: false, timer: 0 };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const draw = () => {
      const radius = dpr;
      const range = PUSH * dpr;
      const reach = Math.sqrt(range);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = COLOR;
      context.beginPath();
      for (const dot of dots) {
        if (mouse.active) {
          const dx = mouse.x - dot.x;
          const dy = mouse.y - dot.y;
          const distance2 = dx * dx + dy * dy;
          if (distance2 < range) {
            dot.ease = dot.hover;
            const distance = Math.sqrt(distance2) || 1;
            const push = (-(reach - distance) / reach) * 150 * (0.5 + Math.random());
            dot.vx += (dx / distance) * push + (Math.random() - 0.5);
            dot.vy += (dy / distance) * push + (Math.random() - 0.5);
          }
        }
        dot.x += (dot.vx *= dot.friction) + (dot.ox - dot.x) * dot.ease;
        dot.y += (dot.vy *= dot.friction) + (dot.oy - dot.y) * dot.ease;
        context.moveTo(dot.x + radius, dot.y);
        context.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
      }
      context.fill();
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      draw();
    };

    const build = () => {
      stop();
      context.clearRect(0, 0, canvas.width, canvas.height);
      dots = [];
      if (narrow.matches) return;
      dpr = window.devicePixelRatio || 1;
      const parentWidth = box.clientWidth;
      const parentHeight = box.clientHeight;
      const cssWidth = 1.5 * parentWidth;
      const cssHeight = 3 * parentHeight;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const { width, height } = canvas;

      // The word, spaced out until it is about as wide as the page's logo is
      // (12.8 times its height), then fitted into the box.
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const paint = scratch.getContext("2d");
      if (!paint) return;
      const size = 100;
      paint.font = `800 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
      const letters = [...text.toUpperCase()];
      const advances = letters.map((letter) => paint.measureText(letter).width);
      const capital = size * 0.73;
      const natural = advances.reduce((sum, value) => sum + value, 0);
      const spacing = Math.max(0, (12.8 * capital - natural) / Math.max(1, letters.length - 1));
      const wordWidth = natural + spacing * (letters.length - 1);
      const fit = Math.min((parentWidth * dpr) / wordWidth, (parentHeight * dpr) / capital);
      const drawnWidth = wordWidth * fit;
      const drawnHeight = capital * fit;
      const left = (width - drawnWidth) / 2;
      const top = (height - drawnHeight) / 2;
      paint.setTransform(fit, 0, 0, fit, left, top + drawnHeight);
      paint.fillStyle = COLOR;
      let x = 0;
      letters.forEach((letter, index) => {
        paint.fillText(letter, x, 0);
        x += advances[index] + spacing;
      });
      const pixels = paint.getImageData(0, 0, width, height).data;

      const gap = GAP * dpr;
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(top + drawnHeight)); y += gap) {
        for (let column = Math.max(0, Math.floor(left)); column < Math.min(width, Math.ceil(left + drawnWidth)); column += gap) {
          if (pixels[(y * width + column) * 4 + 3] <= 60) continue;
          const settled = reduced;
          dots.push({
            ox: column,
            oy: y,
            x: settled ? column : Math.random() * width,
            y: settled ? y : Math.random() * height,
            vx: 0,
            vy: 0,
            ease: 0.04 + 0.04 * Math.random(),
            hover: 0.2 + 0.2 * Math.random(),
            friction: 0.8 + 0.15 * Math.random(),
          });
        }
      }
      if (reduced) draw();
      else if (visible) frame = requestAnimationFrame(loop);
    };

    const move = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (event.clientX - rect.left) * dpr;
      mouse.y = (event.clientY - rect.top) * dpr;
      mouse.active = true;
      window.clearTimeout(mouse.timer);
      mouse.timer = window.setTimeout(() => { mouse.active = false; }, 100);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (reduced || disposed) return;
      if (visible && !frame && dots.length) frame = requestAnimationFrame(loop);
      if (!visible) stop();
    });
    observer.observe(box);

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 200);
    };
    window.addEventListener("resize", onResize);
    if (!reduced) window.addEventListener("mousemove", move);
    void document.fonts.ready.then(() => {
      if (!disposed) build();
    });

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      window.clearTimeout(resizeTimer);
      window.clearTimeout(mouse.timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", move);
    };
  }, [text]);

  return (
    <div ref={boxRef} className={`${styles.logoBox} ${styles.rv}`} style={{ "--d": ".2s" } as React.CSSProperties} role="img" aria-label={text}>
      <canvas ref={canvasRef} className={styles.logoCanvas} aria-hidden="true" />
      <p className={styles.logoText} aria-hidden="true">{text}</p>
    </div>
  );
}
