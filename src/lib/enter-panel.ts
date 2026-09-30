import { useSyncExternalStore } from "react";

// "Signing you in": once a login or sign-up succeeds, the page hands over to the panel in one
// continuous shot. The logo on the auth page keeps its place, comes alive, and flies into the
// panel's sidebar when the panel is there (components/enter-splash.tsx, mounted in the root layout
// so it outlives the auth page).

/** A rectangle in viewport pixels: where the auth page's logo is. */
export type EnterBox = { left: number; top: number; width: number; height: number };

export type EnterRequest = { id: number; to: string; from: EnterBox };

let current: EnterRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Start the hand-over to `to`, from the logo at `from`. */
export function startEntering(to: string, from: EnterBox) {
  if (current) return;
  current = { id: nextId++, to, from };
  emit();
}

export function finishEntering() {
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The hand-over in progress, else null. */
export function useEntering() {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
