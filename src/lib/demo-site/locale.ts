"use client";

import { useSyncExternalStore } from "react";
import { HOME_LOCALE_COOKIE, toHomeLocale, type HomeLocale } from "@/lib/home-copy";

// The static demo has no cookies read on a server, so the page language is kept in localStorage and the
// pages read it in the browser.

export const LOCALE_EVENT = "aeranexa-locale-change";

export function writeLocale(locale: HomeLocale) {
  try {
    window.localStorage.setItem(HOME_LOCALE_COOKIE, toHomeLocale(locale));
  } catch {
    // Storage blocked: the language only lasts for this visit.
  }
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(LOCALE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(LOCALE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const read = () => {
  try {
    return toHomeLocale(window.localStorage.getItem(HOME_LOCALE_COOKIE) ?? undefined);
  } catch {
    return toHomeLocale(undefined);
  }
};

/** The chosen language; "zh" on the server and until the browser has been asked. */
export function useDemoLocale(): HomeLocale {
  return useSyncExternalStore(subscribe, read, () => toHomeLocale(undefined));
}
