import { HOME_LOCALE_COOKIE, toHomeLocale } from "@/lib/home-copy";
import type { AuthData } from "@/lib/api/types";
import { accounts, addAccount, DEMO_ACCOUNT, DEMO_EMAIL_CODE, nicknameOf, startSession } from "./session";

// authApi's answers in the demo site, from the accounts kept in the browser instead of a server.

const text = {
  zh: {
    badLogin: "账号或密码错误",
    badCode: `验证码不正确（演示站的验证码固定为 ${DEMO_EMAIL_CODE}）`,
    taken: "这个邮箱已经注册过了，请直接登录",
    unknown: "没有找到这个账号",
    short: "密码至少 8 位",
    mismatch: "两次输入的密码不一致",
    sent: `演示站不会真的发邮件，验证码固定为 ${DEMO_EMAIL_CODE}`,
  },
  en: {
    badLogin: "Wrong account or password.",
    badCode: `That code is not right (the demo's code is always ${DEMO_EMAIL_CODE}).`,
    taken: "This email is already registered. Please log in.",
    unknown: "No account with that email.",
    short: "The password needs at least 8 characters.",
    mismatch: "The two passwords do not match.",
    sent: `The demo sends no email; the code is always ${DEMO_EMAIL_CODE}.`,
  },
};

const copy = () => {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(HOME_LOCALE_COOKIE);
  } catch {
    // Default language.
  }
  return text[toHomeLocale(value ?? undefined)];
};

const normalize = (value: string) => value.trim().toLowerCase();
const isAdmin = (login: string) => normalize(login) === DEMO_ACCOUNT.login || normalize(login) === DEMO_ACCOUNT.email;

const user = (email: string): AuthData => ({
  id: 1,
  email,
  nickname: nicknameOf(email),
  role: "user",
  is_active: true,
  transfer_enable: 0,
  last_login_at: null,
  created_at: 0,
  banned: 0,
  remind_expire: 0,
  remind_traffic: 0,
  expired_at: null,
  balance: 0,
  commission_balance: 0,
  plan_id: null,
  telegram_id: null,
  uuid: "",
});

const fail = (message: string) => Promise.reject(new Error(message));

export const demoAuth = {
  async login({ email, password }: { email: string; password: string }) {
    if (isAdmin(email)) {
      if (password !== DEMO_ACCOUNT.password) return fail(copy().badLogin);
      startSession({ email: DEMO_ACCOUNT.email, nickname: DEMO_ACCOUNT.login });
      return user(DEMO_ACCOUNT.email);
    }
    const found = accounts().find((item) => item.email === normalize(email));
    if (!found || found.password !== password) return fail(copy().badLogin);
    startSession({ email: found.email, nickname: nicknameOf(found.email) });
    return user(found.email);
  },

  async register({ email, password, password_confirmation, email_code }: { email: string; password: string; password_confirmation?: string; email_code?: string }) {
    const messages = copy();
    const address = normalize(email);
    if (email_code?.trim() !== DEMO_EMAIL_CODE) return fail(messages.badCode);
    if (password.length < 8) return fail(messages.short);
    if (password_confirmation !== undefined && password !== password_confirmation) return fail(messages.mismatch);
    if (address === DEMO_ACCOUNT.email || accounts().some((item) => item.email === address)) return fail(messages.taken);
    addAccount({ email: address, password });
    startSession({ email: address, nickname: nicknameOf(address) });
    return user(address);
  },

  async sendEmailVerify(email: string, purpose: "register" | "reset-password") {
    const messages = copy();
    const address = normalize(email);
    const known = address === DEMO_ACCOUNT.email || accounts().some((item) => item.email === address);
    if (purpose === "register" && known) return fail(messages.taken);
    if (purpose === "reset-password" && !known) return fail(messages.unknown);
    return { message: messages.sent };
  },

  async forget({ email, email_code, password, password_confirmation }: { email: string; email_code: string; password: string; password_confirmation?: string }) {
    const messages = copy();
    const address = normalize(email);
    if (email_code.trim() !== DEMO_EMAIL_CODE) return fail(messages.badCode);
    if (password.length < 8) return fail(messages.short);
    if (password_confirmation !== undefined && password !== password_confirmation) return fail(messages.mismatch);
    if (address === DEMO_ACCOUNT.email) return true; // the built-in account keeps its password
    if (!accounts().some((item) => item.email === address)) return fail(messages.unknown);
    addAccount({ email: address, password });
    return true;
  },
};
