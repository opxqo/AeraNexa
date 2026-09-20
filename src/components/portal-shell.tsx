"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen20Regular,
  Cart20Regular,
  DataBarVertical20Regular,
  Gift20Regular,
  Home20Regular,
  PersonCircle20Regular,
  Receipt20Regular,
  Server20Regular,
  TicketDiagonal20Regular,
} from "@fluentui/react-icons";
import {
  ChevronDown,
  Languages,
  LogOut,
  Menu,
  Sun,
  Moon,
  User,
  UserCircle,
  X,
  Check,
} from "lucide-react";
import { portalSections, type PortalIcon } from "@/lib/navigation";
import { useToast } from "@/components/v2-modal";

const languages = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en-US", label: "English" },
  { code: "ja-JP", label: "日本語" },
  { code: "vi-VN", label: "Tiếng Việt" },
  { code: "ko-KR", label: "한국어" },
  { code: "fa-IR", label: "فارسی" },
];

const portalIconByKey: Record<PortalIcon, React.ComponentType<{ fontSize?: number; "aria-hidden"?: boolean }>> = {
  dashboard: Home20Regular,
  knowledge: BookOpen20Regular,
  plans: Cart20Regular,
  nodes: Server20Regular,
  orders: Receipt20Regular,
  invite: Gift20Regular,
  profile: PersonCircle20Regular,
  tickets: TicketDiagonal20Regular,
  traffic: DataBarVertical20Regular,
};

interface PortalShellProps {
  children: React.ReactNode;
  basePath?: string;
  userEmail?: string;
  userRole?: string;
  onLogout?: () => Promise<void>;
}

export function PortalShell({
  children,
  basePath = "",
  userEmail,
  userRole,
  onLogout,
}: PortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

  const isDemo = basePath === "/demo" || pathname.startsWith("/demo");
  const effectiveBasePath = isDemo ? "/demo" : "";

  const [open, setOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState("zh-CN");
  const [isDarkMode, setIsDarkMode] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  const strippedPathname = effectiveBasePath
    ? pathname.replace(new RegExp(`^${effectiveBasePath}`), "") || "/dashboard"
    : pathname;

  const current = portalSections.find(
    ({ href }) => strippedPathname === href || strippedPathname.startsWith(`${href}/`),
  );
  const groups = [undefined, "订阅", "财务", "用户"] as const;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDarkMode(
        document.documentElement.getAttribute("data-theme") === "dark" ||
          localStorage.getItem("theme") === "dark",
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    if (onLogout) await onLogout();
    showToast("已成功登出", "info");
    if (!onLogout) router.push(isDemo ? "/demo/login" : "/login");
  };

  const handleToggleTheme = () => {
    const newDark = !isDarkMode;
    setIsDarkMode(newDark);
    if (newDark) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
      showToast("已切换至暗色模式", "info");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
      showToast("已切换至亮色模式", "info");
    }
  };

  const displayEmail = userEmail || (isDemo ? "demo@aeranexa.com" : "未登录用户");

  return (
    <div className="portal-shell">
      {/* 移动端菜单按钮 */}
      <button
        className="mobile-menu"
        type="button"
        aria-label={open ? "关闭导航" : "打开导航"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* 左侧经典边栏 */}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <Link className="brand" href={`${effectiveBasePath}/dashboard`} onClick={() => setOpen(false)}>
          AeraNexa
        </Link>

        <nav className="primary-nav" aria-label="用户面板导航">
          {groups.map((group) => (
            <div className="nav-group" key={group ?? "main"}>
              {group && <p className="nav-label">{group}</p>}
              {portalSections
                .filter((section) => section.group === group)
                .map(({ href, label, icon }) => {
                  const Icon = portalIconByKey[icon];
                  const targetHref = `${effectiveBasePath}${href}`;
                  const active =
                    pathname === targetHref ||
                    pathname === href ||
                    pathname.startsWith(`${targetHref}/`) ||
                    (effectiveBasePath === "" && pathname.startsWith(`${href}/`));
                  return (
                    <Link
                      key={href}
                      href={targetHref}
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <Icon fontSize={18} aria-hidden />
                      <span>{label}</span>
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>

        <p className="sidebar-version">
          {isDemo ? "AeraNexa Demo Preview" : "AeraNexa v0.1.0"}
        </p>
      </aside>

      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        />
      )}

      {/* 主界面 */}
      <div className="portal-main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <p className="topbar-title">{current?.label ?? "AeraNexa"}</p>
            {/* 模式状态切换按钮 */}
            {isDemo ? (
              <Link href="/dashboard" className="v2-mode-badge demo" title="点击切换至 API 生产模式">
                演示模式 · 切换至生产
              </Link>
            ) : (
              <Link href="/demo/dashboard" className="v2-mode-badge prod" title="点击查看纯前端 Mock 演示页面">
                生产模式 · 查看Demo演示
              </Link>
            )}
          </div>

          <div className="topbar-actions">
            {/* 主题切换 */}
            <button
              className="icon-button"
              type="button"
              aria-label="切换主题"
              onClick={handleToggleTheme}
            >
              {isDarkMode ? <Moon size={17} /> : <Sun size={17} />}
            </button>

            {/* 语言切换菜单 */}
            <div style={{ position: "relative" }} ref={langRef}>
              <button
                className="icon-button"
                type="button"
                aria-label="切换语言"
                onClick={() => setLangMenuOpen((v) => !v)}
              >
                <Languages size={17} />
              </button>

              {langMenuOpen && (
                <div className="v2-dropdown-menu" style={{ minWidth: 120 }}>
                  {languages.map((lang) => (
                    <div
                      key={lang.code}
                      onClick={() => {
                        setCurrentLang(lang.code);
                        setLangMenuOpen(false);
                        showToast(`已切换至 ${lang.label}`, "info");
                      }}
                      className={`v2-dropdown-item ${currentLang === lang.code ? "active" : ""}`}
                    >
                      <span>{lang.label}</span>
                      {currentLang === lang.code && <Check size={14} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 用户菜单下拉 */}
            <div style={{ position: "relative" }} ref={accountRef}>
              <button
                className="account-button"
                type="button"
                onClick={() => setAccountMenuOpen((v) => !v)}
              >
                <UserCircle size={18} aria-hidden="true" />
                <span className="account-copy">{displayEmail}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>

              {accountMenuOpen && (
                <div className="v2-dropdown-menu" style={{ minWidth: 140 }}>
                  {userRole === "admin" ? (
                    <>
                      <Link
                        href="/admin"
                        onClick={() => setAccountMenuOpen(false)}
                        className="v2-dropdown-item"
                      >
                        <UserCircle size={15} />
                        <span>管理员面板</span>
                      </Link>
                      <div className="v2-dropdown-divider" />
                    </>
                  ) : null}
                  <Link
                    href={`${effectiveBasePath}/profile`}
                    onClick={() => setAccountMenuOpen(false)}
                    className="v2-dropdown-item"
                  >
                    <User size={15} />
                    <span>个人中心</span>
                  </Link>
                  <div className="v2-dropdown-divider" />
                  <div
                    onClick={handleLogout}
                    className="v2-dropdown-item"
                    style={{ color: "#ff4d4f" }}
                  >
                    <LogOut size={15} />
                    <span>登出</span>
                  </div>
                </div>
              )}
            </div>

          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
