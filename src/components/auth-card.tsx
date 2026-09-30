"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandLoader } from "@/components/brand-loader";
import { BrandMark } from "@/components/brand-mark";
import { setHomeLocale } from "@/app/home-locale-action";
import { authApi } from "@/lib/api/auth";
import { startEntering, useEntering } from "@/lib/enter-panel";
import { languages, textFor, type LanguageCode } from "@/lib/auth-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./auth-card.module.css";

// The sign-in, sign-up and reset-password pages, laid out after linear.app's:
// one question at a time in a 288px column, the next one fading down into the
// same place (see auth-card.module.css). The steps map onto our own back end:
// email and password to sign in; email, a code from the mail, then a password
// to sign up or to reset one.
type AuthMode = "login" | "register" | "forget";
type Step = "choose" | "email" | "password" | "code" | "newPassword";

const FLOW: Record<AuthMode, Step[]> = {
  login: ["choose", "email", "password"],
  register: ["choose", "email", "code", "newPassword"],
  forget: ["email", "code", "newPassword"],
};

// The first-step buttons don't call anything yet (the social ones are placeholders for the
// redirect, the email one just moves on), so they show their loader for a beat, as the real
// thing would: long enough to see the packet leave and reach a node or two.
const SOCIAL_LOAD_MS = 1300;
const EMAIL_LOAD_MS = 650;

type Choice = "Google" | "GitHub" | "email";

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function AuthCard({ mode, initialInviteCode = "", initialLocale = "zh" }: { mode: AuthMode; initialInviteCode?: string; initialLocale?: HomeLocale }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lang, setLang] = useState<LanguageCode>(initialLocale === "en" ? "en-US" : "zh-CN");
  const text = textFor(lang);
  const flow = FLOW[mode];

  const [stepIndex, setStepIndex] = useState(0);
  const step = flow[stepIndex];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteNote, setInviteNote] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<Choice | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const entering = useEntering();
  const wasEntering = useRef(false);

  useEffect(() => () => clearTimeout(pendingTimer.current), []);

  // If the hand-over to the panel gives up, the page is ours again.
  useEffect(() => {
    if (wasEntering.current && !entering) setSubmitting(false);
    wasEntering.current = entering !== null;
  }, [entering]);

  // The logo's place on screen: the hand-over to the panel starts from it.
  const enterPanel = () => {
    const box = logoRef.current?.getBoundingClientRect();
    startEntering("/dashboard", box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: window.innerWidth / 2 - 24, top: window.innerHeight / 3, width: 48, height: 48 });
  };

  const go = useCallback((index: number) => {
    setStepIndex(index);
    setError("");
    setNotice("");
  }, []);
  const back = useCallback(() => go(Math.max(0, stepIndex - 1)), [go, stepIndex]);

  // Code countdown, toast timeout.
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Escape steps back; a click outside closes the language menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (langOpen) setLangOpen(false);
      else if (stepIndex > 0) back();
    };
    const onDown = (event: MouseEvent) => {
      if (langOpen && !langRef.current?.contains(event.target as Node)) setLangOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [back, langOpen, stepIndex]);

  // The invite link's code, checked once.
  useEffect(() => {
    if (mode !== "register") return;
    const code = initialInviteCode.trim();
    if (!code) return;
    const controller = new AbortController();
    fetch(`/api/auth/invite?code=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: { valid?: boolean; message?: string } };
        if (payload.data?.valid) {
          setInviteNote(textFor(lang).invite.valid);
          return;
        }
        setInviteCode("");
        setInviteNote(payload.data?.message ?? textFor(lang).invite.invalid);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) setInviteNote(textFor(lang).invite.unverified);
      });
    return () => controller.abort();
    // The note is written once per link; a language change only re-words new ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInviteCode, mode]);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const sendCode = async () => {
    try {
      const result = await authApi.sendEmailVerify(email.trim(), mode === "forget" ? "reset-password" : "register");
      setCountdown(60);
      setNotice(result.message || text.codeSent);
      return true;
    } catch (failure) {
      setError(errorMessage(failure, text.errors.sendFailed));
      return false;
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setNotice("");

    if (step === "email") {
      if (!validEmail) return setError(text.errors.email);
      if (mode === "login") return go(stepIndex + 1);
      setSubmitting(true);
      const sent = await sendCode();
      setSubmitting(false);
      if (sent) setStepIndex(stepIndex + 1);
      return;
    }
    if (step === "code") {
      if (!emailCode.trim()) return setError(text.errors.code);
      return go(stepIndex + 1);
    }
    if (!password) return setError(text.errors.password);
    if (step === "newPassword" && password !== rePassword) return setError(text.errors.mismatch);

    setSubmitting(true);
    try {
      if (mode === "login") {
        await authApi.login({ email: email.trim(), password });
        enterPanel();
      } else if (mode === "register") {
        await authApi.register({ email: email.trim(), password, password_confirmation: rePassword, email_code: emailCode, invite_code: inviteCode || undefined });
        enterPanel();
      } else {
        await authApi.forget({ email: email.trim(), email_code: emailCode, password, password_confirmation: rePassword });
        setNotice(text.errors.resetDone);
        setTimeout(() => router.push("/login"), 1500);
      }
    } catch (failure) {
      setError(errorMessage(failure, text.errors.network));
      setSubmitting(false);
      return;
    }
    // Sign-in and sign-up hand over to the panel behind the splash (enter-splash.tsx); keep the loader until the page goes.
    if (mode === "forget") setSubmitting(false);
  };

  const social = (provider: "Google" | "GitHub") => setToast(text.social(provider));
  const choose = (choice: Choice) => {
    if (pending) return;
    setPending(choice);
    pendingTimer.current = setTimeout(() => {
      setPending(null);
      if (choice === "email") go(1);
      else social(choice);
    }, choice === "email" ? EMAIL_LOAD_MS : SOCIAL_LOAD_MS);
  };
  const chooseLanguage = (code: LanguageCode) => {
    setLang(code);
    setLangOpen(false);
    const next: HomeLocale | null = code.startsWith("zh") ? "zh" : code === "en-US" ? "en" : null;
    if (next) startTransition(() => void setHomeLocale(next));
  };

  const title =
    step === "choose" ? (mode === "login" ? text.titles.login : text.titles.register)
    : step === "email" ? (mode === "forget" ? text.titles.forget : text.titles.email)
    : step === "password" ? text.titles.password
    : step === "code" ? text.titles.code
    : mode === "forget" ? text.titles.resetPassword : text.titles.newPassword;
  const backLabel = stepIndex === (mode === "forget" ? 0 : 1) ? (mode === "register" ? text.backToRegister : text.backToLogin) : text.back;
  const buttonLabel = step === "newPassword" ? (mode === "forget" ? text.resetPassword : text.createAccount) : step === "email" && stepIndex === 1 ? text.email : text.continue;

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div ref={logoRef} className={styles.logo} data-busy={submitting || pending !== null || undefined}>
          <span className={styles.pulse} aria-hidden="true" />
          <BrandMark size={48} />
        </div>

        <div key={step} className={styles.step}>
          <h1 className={styles.title}>{title}</h1>

          {step === "choose" ? (
            <>
              <div className={styles.stack}>
                <button type="button" className={`${styles.button} ${styles.primary}`} disabled={pending !== null} data-loading={pending === "Google" || undefined} onClick={() => choose("Google")}>
                  {pending === "Google" ? <BrandLoader accent="#ffffff" accentAlt="#101010" label={text.loading} size={20} /> : text.google}
                </button>
                <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={pending !== null} data-loading={pending === "GitHub" || undefined} onClick={() => choose("GitHub")}>
                  {pending === "GitHub" ? <BrandLoader label={text.loading} size={20} /> : text.github}
                </button>
                <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={pending !== null} data-loading={pending === "email" || undefined} onClick={() => choose("email")}>
                  {pending === "email" ? <BrandLoader label={text.loading} size={20} /> : text.email}
                </button>
              </div>
              {mode === "login" ? (
                <p className={`${styles.footer} ${styles.footerLogin}`}>{text.footer.noAccount} <Link href="/register">{text.footer.signUp}</Link></p>
              ) : (
                <>
                  <p className={`${styles.footer} ${styles.footerLegal}`}>
                    {text.footer.agree} <a href="#terms">{text.footer.terms}</a> {text.footer.and} <a href="#privacy">{text.footer.privacy}</a>{text.footer.end}
                  </p>
                  <p className={`${styles.footer} ${styles.footerAlt}`}>{text.footer.haveAccount} <Link href="/login">{text.footer.logIn}</Link></p>
                </>
              )}
            </>
          ) : (
            <form className={styles.stack} onSubmit={submit} noValidate>
              {step === "email" && (
                <>
                  <label className={styles.sr} htmlFor="auth-email">{text.labels.email}</label>
                  <input id="auth-email" className={styles.input} type="email" name="email" autoComplete="email" autoFocus placeholder={text.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)} />
                </>
              )}
              {step === "code" && (
                <>
                  <p className={styles.note}>{text.codeHint(email.trim())}</p>
                  <label className={styles.sr} htmlFor="auth-code">{text.labels.code}</label>
                  <input id="auth-code" className={styles.input} type="text" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder={text.codePlaceholder} value={emailCode} onChange={(event) => setEmailCode(event.target.value)} />
                </>
              )}
              {step === "password" && (
                <>
                  <label className={styles.sr} htmlFor="auth-password">{text.labels.password}</label>
                  <input id="auth-password" className={styles.input} type="password" name="password" autoComplete="current-password" autoFocus placeholder={text.passwordPlaceholder} value={password} onChange={(event) => setPassword(event.target.value)} />
                </>
              )}
              {step === "newPassword" && (
                <>
                  {inviteNote && <p className={styles.note}>{inviteNote}</p>}
                  <label className={styles.sr} htmlFor="auth-new-password">{text.labels.newPassword}</label>
                  <input id="auth-new-password" className={styles.input} type="password" name="password" autoComplete="new-password" autoFocus placeholder={text.passwordPlaceholder} value={password} onChange={(event) => setPassword(event.target.value)} />
                  <label className={styles.sr} htmlFor="auth-confirm">{text.labels.confirm}</label>
                  <input id="auth-confirm" className={styles.input} type="password" name="confirm" autoComplete="new-password" placeholder={text.confirmPlaceholder} value={rePassword} onChange={(event) => setRePassword(event.target.value)} />
                </>
              )}

              {error && <p className={styles.error} role="alert">{error}</p>}
              {!error && notice && <p className={styles.note} role="status">{notice}</p>}

              <button type="submit" className={`${styles.button} ${styles.secondary}`} disabled={submitting} data-loading={submitting || undefined}>
                {submitting ? <BrandLoader label={text.loading} size={20} /> : buttonLabel}
              </button>

              {step === "code" && (
                <button type="button" className={styles.link} disabled={countdown > 0 || submitting} onClick={() => void sendCode()}>
                  {countdown > 0 ? text.resendIn(countdown) : text.resend}
                </button>
              )}
              <button type="button" className={styles.link} onClick={back}>{backLabel}</button>
              {step === "password" && <Link className={`${styles.link} ${styles.mutedLink}`} href="/forgetpassword">{text.forgot}</Link>}
            </form>
          )}
        </div>
      </div>

      {toast && <div className={styles.toast} role="status">{toast}</div>}

      <div ref={langRef} className={styles.lang}>
        <button type="button" className={styles.langButton} aria-haspopup="menu" aria-expanded={langOpen} onClick={() => setLangOpen((open) => !open)}>
          {languages.find((item) => item.code === lang)?.label}
        </button>
        {langOpen && (
          <div className={styles.langMenu} role="menu" aria-label={text.language}>
            {languages.map((item) => (
              <button key={item.code} type="button" role="menuitemradio" aria-checked={item.code === lang} className={styles.langItem} data-active={item.code === lang || undefined} onClick={() => chooseLanguage(item.code)}>{item.label}</button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
