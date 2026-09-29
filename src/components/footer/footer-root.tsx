"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./site-footer.module.css";

/** The footer element. It marks itself `data-in` once its top has come up the
 *  screen, which lets its blocks (`.rv`, `.rvLine`) slide and draw in. */
export function FooterRoot({ lang, children }: { lang: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const footer = ref.current;
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      footer.setAttribute("data-in", "");
      observer.disconnect();
    }, { rootMargin: "0px 0px -12% 0px" });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return <footer ref={ref} className={styles.footer} lang={lang}>{children}</footer>;
}
