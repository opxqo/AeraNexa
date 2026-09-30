"use client";

import { useSyncExternalStore } from "react";

// The demo site has no server to hold a login, so the "session" is two small records in localStorage:
// the accounts made on the sign-up page, and who is signed in. Both stay in the visitor's own browser.

export type DemoSession = { email: string; nickname: string };

const SESSION_KEY = "aeranexa-demo-session";
const ACCOUNTS_KEY = "aeranexa-demo-accounts";
const SESSION_EVENT = "aeranexa-demo-session-change";

/** The built-in account: signing in with it opens the account that has all the demo data. */
export const DEMO_ACCOUNT = { login: "admin", password: "admin123456", email: "admin@aeranexa.demo" };
/** The code every "email" sends, because nothing is sent. */
export const DEMO_EMAIL_CODE = "123456";

type Account = { email: string; password: string };

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the demo works for this visit only.
  }
}

export const nicknameOf = (email: string) => email.split("@")[0] || email;

export const accounts = () => read<Account[]>(ACCOUNTS_KEY) ?? [];

export function addAccount(account: Account) {
  write(ACCOUNTS_KEY, [...accounts().filter((item) => item.email !== account.email), account]);
}

let cached: { raw: string | null; value: DemoSession | null } = { raw: null, value: null };

/** The signed-in account, or null. The same object comes back until the stored text changes (useSyncExternalStore needs that). */
export function getSession(): DemoSession | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SESSION_KEY);
  } catch {
    return cached.value;
  }
  if (raw !== cached.raw) {
    let value: DemoSession | null = null;
    try {
      value = raw ? (JSON.parse(raw) as DemoSession) : null;
    } catch {
      value = null;
    }
    cached = { raw, value };
  }
  return cached.value;
}

export function startSession(session: DemoSession) {
  write(SESSION_KEY, session);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function endSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
  cached = { raw: null, value: null };
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** undefined until the browser has been asked (server render and first paint), then the session or null. */
export function useSession(): DemoSession | null | undefined {
  return useSyncExternalStore(subscribe, getSession, () => undefined);
}
