"use server";

import { cookies } from "next/headers";
import { HOME_LOCALE_COOKIE, toHomeLocale, type HomeLocale } from "@/lib/home-copy";

// Remember the home page language for a year. Setting the cookie in a Server
// Action returns the re-rendered page in the same round trip.
export async function setHomeLocale(locale: HomeLocale) {
  const cookieStore = await cookies();
  cookieStore.set(HOME_LOCALE_COOKIE, toHomeLocale(locale), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
