"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Globe2, KeyRound, LogIn, UserPlus, Check, AlertCircle, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api/auth";

type AuthMode = "login" | "register" | "forget";

const supportedLanguages = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en-US", label: "English" },
  { code: "ja-JP", label: "日本語" },
  { code: "vi-VN", label: "Tiếng Việt" },
  { code: "ko-KR", label: "한국어" },
  { code: "fa-IR", label: "فارسی" },
];

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AuthCard({ mode }: { mode: AuthMode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isDemo = pathname.startsWith("/demo");
  const basePath = isDemo ? "/demo" : "";

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForget = mode === "forget";

  // 表单状态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);

  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("zh-CN");

  // 60 秒验证码倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 发送邮箱验证码
  const handleSendCode = async () => {
    if (countdown > 0) return;
    if (!email || !email.includes("@")) {
      setErrorMessage("请先输入有效的邮箱地址");
      return;
    }
    setErrorMessage("");

    if (isDemo) {
      setCountdown(60);
      setSuccessMessage("验证码已模拟发送至邮箱");
      return;
    }

    try {
      const result = await authApi.sendEmailVerify(email, isForget ? "reset-password" : "register");
      setCountdown(60);
      setSuccessMessage(result.message || "验证码已发送，请查收邮箱");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "验证码发送失败，请稍后重试"));
    }
  };

  // 提交认证
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    // Demo 模式下直接跳转
    if (isDemo) {
      if (isLogin) router.push("/demo/dashboard");
      else if (isRegister) router.push("/demo/dashboard");
      else router.push("/demo/login");
      return;
    }

    // 生产模式表单基础校验
    if (!email || !email.includes("@")) {
      setErrorMessage("请输入有效的邮箱地址");
      return;
    }
    if (!password) {
      setErrorMessage("请输入密码");
      return;
    }

    if (isRegister) {
      if (!emailCode.trim()) {
        setErrorMessage("请输入邮箱验证码");
        return;
      }
      if (password !== rePassword) {
        setErrorMessage("两次输入的密码不一致");
        return;
      }
      if (!agreeTerms) {
        setErrorMessage("请同意服务条款后继续注册");
        return;
      }
    }
    if (isForget) {
      if (!emailCode.trim()) {
        setErrorMessage("请输入邮箱验证码");
        return;
      }
      if (password !== rePassword) {
        setErrorMessage("两次输入的密码不一致");
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
        setSuccessMessage("密码重置成功，请使用新密码登入");
        setTimeout(() => router.push("/login"), 1500);
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "请求失败，请检查网络或后端接口服务"));
    } finally {
      setSubmitting(false);
    }
  };

  const currentLangLabel =
    supportedLanguages.find((l) => l.code === selectedLang)?.label ?? "简体中文";

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-card-body">
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h1 style={{ margin: 0 }}>AeraNexa</h1>
            {isDemo && <span className="v2-mode-badge demo">Demo演示</span>}
          </div>
          <p>Connect beyond boundaries.</p>

          {/* 错误提示框 */}
          {errorMessage && (
            <div
              style={{
                marginBottom: 14,
                padding: "8px 12px",
                background: "rgba(255, 77, 79, 0.1)",
                border: "1px solid rgba(255, 77, 79, 0.3)",
                borderRadius: 4,
                color: "#ff4d4f",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 成功提示框 */}
          {successMessage && (
            <div
              style={{
                marginBottom: 14,
                padding: "8px 12px",
                background: "rgba(82, 196, 26, 0.1)",
                border: "1px solid rgba(82, 196, 26, 0.3)",
                borderRadius: 4,
                color: "#52c41a",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
              }}
            >
              <Check size={15} style={{ flexShrink: 0 }} />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* 邮箱 */}
            <input
              aria-label="邮箱"
              type="email"
              autoComplete="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {/* 邮箱验证码 (注册 / 找回密码) */}
            {!isLogin && (
              <div className="verify-row">
                <input
                  aria-label="邮箱验证码"
                  placeholder="邮箱验证码"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                />
                <button
                  type="button"
                  className="verify-button"
                  disabled={countdown > 0}
                  onClick={handleSendCode}
                  style={{
                    cursor: countdown > 0 ? "not-allowed" : "pointer",
                    opacity: countdown > 0 ? 0.6 : 1,
                  }}
                >
                  {countdown > 0 ? `${countdown}s` : "发送"}
                </button>
              </div>
            )}

            {/* 密码 (登录) */}
            {isLogin && (
              <input
                aria-label="密码"
                type="password"
                autoComplete="current-password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}

            {/* 密码 (注册) */}
            {isRegister && (
              <>
                <input
                  aria-label="密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <input
                  aria-label="重复密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="重复密码"
                  value={rePassword}
                  onChange={(e) => setRePassword(e.target.value)}
                  required
                />
                <input
                  aria-label="邀请码"
                  placeholder="邀请码(选填)"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                <label className="terms">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                  />
                  我已阅读并同意 <a href="#terms">服务条款</a>
                </label>
              </>
            )}

            {/* 新密码 (找回密码) */}
            {isForget && (
              <>
                <input
                  aria-label="新密码"
                  type="password"
                  placeholder="请输入新密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <input
                  aria-label="确认新密码"
                  type="password"
                  placeholder="请再次输入新密码"
                  value={rePassword}
                  onChange={(e) => setRePassword(e.target.value)}
                  required
                />
              </>
            )}

            {/* 提交按钮 */}
            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
              style={{ width: "100%", border: 0, cursor: submitting ? "not-allowed" : "pointer" }}
            >
              {submitting ? (
                <Loader2 size={17} className="animate-spin" />
              ) : isLogin ? (
                <>
                  <LogIn size={17} />
                  登入
                </>
              ) : isRegister ? (
                <>
                  <UserPlus size={17} />
                  注册
                </>
              ) : (
                <>
                  <KeyRound size={17} />
                  重置密码
                </>
              )}
            </button>
          </form>
        </div>

        {/* 底部导航与语言切换 */}
        <footer className="login-card-footer">
          <span>
            {isLogin ? (
              <>
                <Link href={`${basePath}/register`}>注册</Link>
                <Link href={`${basePath}/forgetpassword`}>忘记密码</Link>
              </>
            ) : (
              <Link href={`${basePath}/login`}>返回登入</Link>
            )}
          </span>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setLangMenuOpen((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              <Globe2 size={16} />
              <span>{currentLangLabel}</span>
            </button>

            {langMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  right: 0,
                  marginBottom: 8,
                  background: "var(--v2-surface)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  borderRadius: 4,
                  border: "1px solid var(--v2-border)",
                  padding: "4px 0",
                  minWidth: 120,
                  zIndex: 100,
                }}
              >
                {supportedLanguages.map((lang) => (
                  <div
                    key={lang.code}
                    onClick={() => {
                      setSelectedLang(lang.code);
                      setLangMenuOpen(false);
                    }}
                    className={`v2-dropdown-item ${selectedLang === lang.code ? "active" : ""}`}
                    style={{ justifyContent: "space-between" }}
                  >
                    <span>{lang.label}</span>
                    {selectedLang === lang.code && <Check size={14} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}
