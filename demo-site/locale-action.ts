import { writeLocale } from "@/lib/demo-site/locale";
import type { HomeLocale } from "@/lib/home-copy";

// Stands in for src/app/home-locale-action.ts (a Server Action, which a static export cannot have).
export async function setHomeLocale(locale: HomeLocale) {
  writeLocale(locale);
}
