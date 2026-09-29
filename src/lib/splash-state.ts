import { useSyncExternalStore } from "react";

// Where the home page's opening splash is in its life, kept on <html data-splash> so CSS can
// see it before React does:
//   off      no splash this load (not the home page, seen already this session, reduced motion)
//   on       the splash is due: a cover (globals.css) hides the page until it mounts
//   running  the splash is up and loading
//   handoff  it is fading out; the page's own map may start now
//   done     gone
// The layout's inline script sets "on" or "off" before the first paint.

export type SplashState = "off" | "on" | "running" | "handoff" | "done";

const SEEN_KEY = "aeranexa-splash";
const listeners = new Set<() => void>();

function readSplashState(): SplashState {
  const value = document.documentElement.dataset.splash;
  return value === "on" || value === "running" || value === "handoff" || value === "done" ? value : "off";
}

export function setSplashState(next: SplashState) {
  document.documentElement.dataset.splash = next;
  // Once it has started to leave, this session has seen it.
  if (next === "handoff") {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server and hydration see "off", so the server HTML is the plain page. */
export function useSplashState(): SplashState {
  return useSyncExternalStore(subscribe, readSplashState, () => "off");
}

/** The home page's map waits for the splash to hand over, so it starts from the frame the dots land in. */
export function useHomeMapReady() {
  const state = useSplashState();
  return state !== "on" && state !== "running";
}
