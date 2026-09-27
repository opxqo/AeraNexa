"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api/auth";
import styles from "./auth-card.module.css";

type AuthMode = "login" | "register" | "forget";

const supportedLanguages = [
  { code: "en-US", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
];

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.59.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 170 170" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.71-11.65-14.01-6.19-9.57-11.1-20.2-14.73-31.89-3.63-11.69-5.45-22.75-5.45-33.19 0-14.36 3.54-26.33 10.63-35.91 7.08-9.58 16.03-14.48 26.85-14.71 4.57 0 9.77 1.25 15.61 3.76 5.83 2.5 9.77 3.81 11.8 3.91 1.63 0 5.76-1.39 12.39-4.17 6.64-2.77 12.34-3.99 17.1-3.65 12.63.87 22.84 5.71 30.64 14.52-11.09 6.74-16.52 15.93-16.3 27.56.22 9.13 3.75 16.85 10.59 23.16 6.84 6.31 15.06 9.95 24.66 10.92-2.18 6.74-4.89 13.37-8.13 19.89zm-32.91-105.77c0-6.74 2.45-13.1 7.34-19.08 4.9-5.98 11.04-9.84 18.43-11.58.22 1.3.33 2.5.33 3.59 0 6.74-2.56 13.21-7.67 19.41-5.11 6.2-11.37 10.06-18.76 11.58-.11-1.3-.33-2.61-.33-3.92z"/>
    </svg>
  );
}

function AsteriskMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="34" height="34" viewBox="0 0 34 34" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="translate(17, 17)">
        <rect x="-3.2" y="-14" width="6.4" height="11" rx="3.2" />
        <rect x="-3.2" y="-14" width="6.4" height="11" rx="3.2" transform="rotate(72)" />
        <rect x="-3.2" y="-14" width="6.4" height="11" rx="3.2" transform="rotate(144)" />
        <rect x="-3.2" y="-14" width="6.4" height="11" rx="3.2" transform="rotate(216)" />
        <rect x="-3.2" y="-14" width="6.4" height="11" rx="3.2" transform="rotate(288)" />
        <circle cx="0" cy="0" r="4.5" />
      </g>
    </svg>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AuthCard({ mode, initialInviteCode = "" }: { mode: AuthMode; initialInviteCode?: string }) {
  const router = useRouter();

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForget = mode === "forget";

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteMessage, setInviteMessage] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);

  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("en-US");

  // 60-second code countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  // Invite code validation
  useEffect(() => {
    if (!isRegister || typeof window === "undefined") return;
    const code = initialInviteCode.trim();
    if (!code) return;

    const controller = new AbortController();
    fetch(`/api/auth/invite?code=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: { valid?: boolean; message?: string } };
        if (payload.data?.valid) {
          setInviteMessage(selectedLang === "zh-CN" ? "邀请链接有效，注册后将自动绑定邀请关系" : "Invitation link is valid");
          return;
        }
        setInviteCode("");
        setInviteMessage(payload.data?.message ?? (selectedLang === "zh-CN" ? "邀请链接无效或已失效" : "Invalid invite code"));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setInviteMessage(selectedLang === "zh-CN" ? "暂时无法校验邀请码，提交注册时将再次验证" : "Unable to verify invite code");
        }
      });
    return () => controller.abort();
  }, [initialInviteCode, isRegister, selectedLang]);

  // Send email verification code
  const handleSendCode = async () => {
    if (countdown > 0) return;
    if (!email || !email.includes("@")) {
      setErrorMessage(selectedLang === "zh-CN" ? "请先输入有效的邮箱地址" : "Please enter a valid email address");
      return;
    }
    setErrorMessage("");

    try {
      const result = await authApi.sendEmailVerify(email, isForget ? "reset-password" : "register");
      setCountdown(60);
      setSuccessMessage(result.message || (selectedLang === "zh-CN" ? "验证码已发送，请查收邮箱" : "Verification code sent to your email"));
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, selectedLang === "zh-CN" ? "验证码发送失败，请稍后重试" : "Failed to send verification code"));
    }
  };

  // Submit authentication
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!email || !email.includes("@")) {
      setErrorMessage(selectedLang === "zh-CN" ? "请输入有效的邮箱地址" : "Please enter a valid email address");
      return;
    }
    if (!password) {
      setErrorMessage(selectedLang === "zh-CN" ? "请输入密码" : "Please enter your password");
      return;
    }

    if (isRegister) {
      if (!emailCode.trim()) {
        setErrorMessage(selectedLang === "zh-CN" ? "请输入邮箱验证码" : "Please enter the verification code");
        return;
      }
      if (password !== rePassword) {
        setErrorMessage(selectedLang === "zh-CN" ? "两次输入的密码不一致" : "Passwords do not match");
        return;
      }
      if (!agreeTerms) {
        setErrorMessage(selectedLang === "zh-CN" ? "请同意服务条款后继续注册" : "Please accept terms and conditions");
        return;
      }
    }
    if (isForget) {
      if (!emailCode.trim()) {
        setErrorMessage(selectedLang === "zh-CN" ? "请输入邮箱验证码" : "Please enter the verification code");
        return;
      }
      if (password !== rePassword) {
        setErrorMessage(selectedLang === "zh-CN" ? "两次输入的密码不一致" : "Passwords do not match");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await authApi.login({ email, password });
        router.push("/dashboard");
      } else if (isRegister) {
        await authApi.register({
          email,
          password,
          password_confirmation: rePassword,
          email_code: emailCode || undefined,
          invite_code: inviteCode || undefined,
        });
        router.push("/dashboard");
      } else if (isForget) {
        await authApi.forget({
          email,
          email_code: emailCode,
          password,
          password_confirmation: rePassword,
        });
        setSuccessMessage(selectedLang === "zh-CN" ? "密码重置成功，请使用新密码登录" : "Password reset successful, please log in with your new password");
        setTimeout(() => router.push("/login"), 1500);
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, selectedLang === "zh-CN" ? "请求失败，请检查网络或后端接口服务" : "Authentication failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocialClick = (provider: "Google" | "Apple") => {
    const isZh = selectedLang === "zh-CN" || selectedLang === "zh-TW";
    const msg =
      provider === "Google"
        ? isZh
          ? "Google 快捷登录已接入界面（等待填入 OAuth Client 凭证）"
          : "Google sign-in is ready for OAuth client credentials"
        : isZh
        ? "Apple 快捷登录已接入界面（等待填入 Apple 开发者凭证）"
        : "Apple sign-in is ready for Apple Developer credentials";
    setToastMsg(msg);
  };

  const isZh = selectedLang === "zh-CN" || selectedLang === "zh-TW";

  return (
    <main className={styles.loginPage}>
      {/* Toast Notification */}
      {toastMsg && (
        <div className={styles.toast} role="status" aria-live="polite">
          <AlertCircle size={16} />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className={styles.loginCard}>
        {/* Top Flower / Asterisk Mark */}
        <div className={styles.brandMarkContainer}>
          <AsteriskMark className={styles.asteriskIcon} />
        </div>

        {/* Heading */}
        <h1 className={styles.title}>
          {isLogin ? "Welcome back" : isRegister ? (isZh ? "创建账户" : "Create an account") : isZh ? "重置密码" : "Reset your password"}
        </h1>

        {/* Social Login Buttons (Login & Register) */}
        {!isForget && (
          <>
            <div className={styles.socialButtons}>
              <button
                type="button"
                className={styles.socialBtn}
                onClick={() => handleSocialClick("Google")}
                aria-label="Continue with Google"
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>

              <button
                type="button"
                className={styles.socialBtn}
                onClick={() => handleSocialClick("Apple")}
                aria-label="Continue with Apple"
              >
                <span className={styles.socialAppleIcon}>
                  <AppleIcon />
                </span>
                <span>Continue with Apple</span>
              </button>
            </div>

            {/* Subtle Divider */}
            <div className={styles.divider} aria-hidden="true" />
          </>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className={styles.alertError} role="alert">
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div className={styles.alertSuccess} role="status">
            <Check size={15} style={{ flexShrink: 0 }} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Main form */}
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          {/* Email field */}
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>
              {isZh ? "邮箱" : "Email"}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={isLogin ? "samlee.mobbin@gmail.com" : "name@example.com"}
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {/* Verification code (Register / Forget) */}
          {!isLogin && (
            <div className={styles.field}>
              <label htmlFor="emailCode" className={styles.label}>
                {isZh ? "邮箱验证码" : "Verification Code"}
              </label>
              <div className={styles.verifyRow}>
                <input
                  id="emailCode"
                  name="emailCode"
                  type="text"
                  placeholder={isZh ? "验证码" : "Code"}
                  className={styles.input}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.verifyBtn}
                  disabled={countdown > 0}
                  onClick={handleSendCode}
                >
                  {countdown > 0 ? `${countdown}s` : isZh ? "发送" : "Send"}
                </button>
              </div>
            </div>
          )}

          {/* Password field */}
          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>
              {isLogin ? (isZh ? "密码" : "Password") : isForget ? (isZh ? "新密码" : "New Password") : (isZh ? "设置密码" : "Password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder="••••••••••"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* Confirm password (Register / Forget) */}
          {!isLogin && (
            <div className={styles.field}>
              <label htmlFor="rePassword" className={styles.label}>
                {isZh ? "确认密码" : "Confirm Password"}
              </label>
              <input
                id="rePassword"
                name="rePassword"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••••"
                className={styles.input}
                value={rePassword}
                onChange={(e) => setRePassword(e.target.value)}
                required
              />
            </div>
          )}

          {/* Invite Code (Register) */}
          {isRegister && (
            <>
              <div className={styles.field}>
                <label htmlFor="inviteCode" className={styles.label}>
                  {isZh ? "邀请码（选填）" : "Invite Code (Optional)"}
                </label>
                <input
                  id="inviteCode"
                  name="inviteCode"
                  type="text"
                  placeholder={isZh ? "选填" : "Optional"}
                  className={styles.input}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                {inviteMessage && <small style={{ color: "#6b7280", fontSize: 12 }}>{inviteMessage}</small>}
              </div>

              <label className={styles.termsLabel}>
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                />
                <span>
                  {isZh ? "我已阅读并同意" : "I agree to the"} <a href="#terms">{isZh ? "服务条款" : "Terms & Conditions"}</a>
                </span>
              </label>
            </>
          )}

          {/* Continue / Submit Button */}
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isLogin ? (
              "Continue"
            ) : isRegister ? (
              isZh ? "创建账户" : "Create account"
            ) : (
              isZh ? "重置密码" : "Reset password"
            )}
          </button>
        </form>

        {/* Footer Links */}
        <div className={styles.footerLinks}>
          {isLogin ? (
            <>
              <p className={styles.footerRow}>
                <span>Don&#39;t have an account yet?</span>{" "}
                <Link href="/register" className={styles.footerLink}>
                  Sign up
                </Link>
              </p>
              <p className={styles.footerRow}>
                <span>Forgot password?</span>{" "}
                <Link href="/forgetpassword" className={styles.footerLink}>
                  Reset
                </Link>
              </p>
            </>
          ) : isRegister ? (
            <p className={styles.footerRow}>
              <span>{isZh ? "已有账户？" : "Already have an account?"}</span>{" "}
              <Link href="/login" className={styles.footerLink}>
                {isZh ? "去登录" : "Log in"}
              </Link>
            </p>
          ) : (
            <p className={styles.footerRow}>
              <span>{isZh ? "想起密码了？" : "Remember your password?"}</span>{" "}
              <Link href="/login" className={styles.footerLink}>
                {isZh ? "返回登录" : "Log in"}
              </Link>
            </p>
          )}
        </div>
      </div>

      {/* Floating Bottom Right Help / Language Button */}
      <aside className={styles.floatingHelp} aria-label="Help & Language">
        <button
          type="button"
          className={styles.helpButton}
          aria-label="Help and language settings"
          aria-expanded={langMenuOpen}
          onClick={() => setLangMenuOpen((v) => !v)}
        >
          ?
        </button>

        {langMenuOpen && (
          <div className={styles.langPopover} role="menu">
            <div className={styles.langPopoverHeader}>Language / 语言</div>
            {supportedLanguages.map((lang) => (
              <button
                key={lang.code}
                type="button"
                role="menuitem"
                className={`${styles.langItem} ${selectedLang === lang.code ? styles.langActive : ""}`}
                onClick={() => {
                  setSelectedLang(lang.code);
                  setLangMenuOpen(false);
                }}
              >
                <span>{lang.label}</span>
                {selectedLang === lang.code && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
      </aside>
    </main>
  );
}
