import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HomeHero } from "@/components/home-hero";
import { HOME_LOCALE_COOKIE, homeCopy, toHomeLocale } from "@/lib/home-copy";

// The language picked in the header lives in a cookie, so the server renders
// the chosen language on the first paint.
async function readLocale() {
  const cookieStore = await cookies();
  return toHomeLocale(cookieStore.get(HOME_LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = homeCopy[await readLocale()];
  return { title: { absolute: meta.title }, description: meta.description };
}

export default async function HomePage() {
  return <HomeHero locale={await readLocale()} />;
}
