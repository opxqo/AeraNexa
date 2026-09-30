"use client";

import { HomeHero } from "@/components/home-hero";
import { useDemoLocale } from "@/lib/demo-site/locale";

/** The home page, with the language read in the browser instead of from a cookie on a server. */
export function DemoHome() {
  return <HomeHero locale={useDemoLocale()} />;
}
