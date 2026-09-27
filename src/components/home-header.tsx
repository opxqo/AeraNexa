"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { ArrowRight, Check, ChevronDown, Globe2, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import styles from "@/app/home-hero.module.css";

type MenuKey = "product" | "help";
type MenuEntry = { label: string; href: string; description: string };
type MenuSection = { heading: string; entries: MenuEntry[] };

const menuSections: Record<MenuKey, MenuSection[]> = {
  product: [
    { heading: "探索产品", entries: [
      { label: "产品概览", href: "/", description: "了解 AeraNexa 全球网络服务" },
      { label: "全球节点", href: "/node", description: "查看可用的网络节点" },
    ] },
    { heading: "开始使用", entries: [
      { label: "套餐价格", href: "/plan", description: "选择适合自己的连接方案" },
      { label: "创建账户", href: "/register", description: "注册并开始使用 AeraNexa" },
    ] },
  ],
  help: [
    { heading: "支持资源", entries: [
      { label: "使用文档", href: "/knowledge", description: "查找设置与使用说明" },
    ] },
    { heading: "账户服务", entries: [
      { label: "登录账户", href: "/login", description: "返回你的 AeraNexa 账户" },
      { label: "创建账户", href: "/register", description: "开始使用全球网络服务" },
    ] },
  ],
};

const locales = ["简体中文", "English"] as const;

function DesktopMenuPanel({ menu, onNavigate }: { menu: MenuKey; onNavigate: () => void }) {
  return (
    <div className={styles.navPanel}>
      {menuSections[menu].map((section) => (
        <div className={styles.navPanelColumn} key={section.heading}>
          <p className={styles.navPanelHeading}>{section.heading}</p>
          <ul className={styles.navPanelEntries}>
            {section.entries.map((entry) => (
              <li key={entry.href}>
                <NavigationMenu.Link render={<Link href={entry.href} />} className={styles.navPanelLink} onClick={onNavigate}>
                  <span className={styles.navPanelLinkTitle}>{entry.label}<ArrowRight size={15} aria-hidden="true" /></span>
                  <span className={styles.navPanelLinkDescription}>{entry.description}</span>
                </NavigationMenu.Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MobileMenuSection({ title, menu, open, onOpenChange, onNavigate }: {
  title: string;
  menu: MenuKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className={styles.mobileSection}>
      <Collapsible.Trigger className={styles.mobileSectionTrigger}>
        {title}<ChevronDown size={18} aria-hidden="true" />
      </Collapsible.Trigger>
      <Collapsible.Panel className={styles.mobileSectionPanel}>
        {menuSections[menu].map((section) => (
          <div className={styles.mobileLinkGroup} key={section.heading}>
            <p>{section.heading}</p>
            {section.entries.map((entry) => (
              <Link href={entry.href} key={entry.href} onClick={onNavigate} className={styles.mobileSubLink}>
                {entry.label}<ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function HomeHeader() {
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<MenuKey | null>(null);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [locale, setLocale] = useState<(typeof locales)[number]>("简体中文");
  const localeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 8);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    if (!localeOpen) return;
    const close = (event: PointerEvent) => {
      if (!localeRef.current?.contains(event.target as Node)) setLocaleOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLocaleOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [localeOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1230px)");
    const handleBreakpoint = () => {
      if (media.matches) {
        setActiveMenu(null);
      } else {
        setMobileOpen(false);
        setMobileGroup(null);
      }
      setLocaleOpen(false);
    };
    media.addEventListener("change", handleBreakpoint);
    return () => media.removeEventListener("change", handleBreakpoint);
  }, []);

  const closeMobile = () => {
    setMobileOpen(false);
    setMobileGroup(null);
  };

  return (
    <Dialog.Root open={mobileOpen} onOpenChange={(open) => {
      setMobileOpen(open);
      if (!open) setMobileGroup(null);
    }}>
      <header className={styles.header} data-scrolled={scrolled || undefined}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="AeraNexa 首页" onClick={() => setActiveMenu(null)}>
            <BrandMark size={28} />
            <span>AeraNexa</span>
          </Link>

          <NavigationMenu.Root value={activeMenu} onValueChange={setActiveMenu} delay={0} closeDelay={80}
            className={styles.desktopNavigation} aria-label="网站导航">
            <NavigationMenu.List className={styles.desktopNavList}>
              <NavigationMenu.Item value="product">
                <NavigationMenu.Trigger className={styles.navTrigger}>
                  产品<NavigationMenu.Icon className={styles.navChevron}><ChevronDown size={15} aria-hidden="true" /></NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted>
                  <DesktopMenuPanel menu="product" onNavigate={() => setActiveMenu(null)} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
              <NavigationMenu.Item>
                <NavigationMenu.Link render={<Link href="/node" />} className={styles.navDirectLink}>节点</NavigationMenu.Link>
              </NavigationMenu.Item>
              <NavigationMenu.Item>
                <NavigationMenu.Link render={<Link href="/plan" />} className={styles.navDirectLink}>价格</NavigationMenu.Link>
              </NavigationMenu.Item>
              <NavigationMenu.Item value="help">
                <NavigationMenu.Trigger className={styles.navTrigger}>
                  帮助<NavigationMenu.Icon className={styles.navChevron}><ChevronDown size={15} aria-hidden="true" /></NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted>
                  <DesktopMenuPanel menu="help" onNavigate={() => setActiveMenu(null)} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
            </NavigationMenu.List>
            <NavigationMenu.Portal className={styles.navPortal} keepMounted>
              <NavigationMenu.Backdrop className={styles.navBackdrop} />
              <NavigationMenu.Positioner sideOffset={10} align="start" className={styles.navPositioner}>
                <NavigationMenu.Popup className={styles.navPopup}>
                  <NavigationMenu.Viewport />
                </NavigationMenu.Popup>
              </NavigationMenu.Positioner>
            </NavigationMenu.Portal>
          </NavigationMenu.Root>

          <div className={styles.headerActions}>
            <div className={styles.locale} ref={localeRef}>
              <button type="button" className={styles.localeButton} aria-haspopup="menu"
                aria-expanded={localeOpen} onClick={() => setLocaleOpen((open) => !open)}>
                <Globe2 size={17} strokeWidth={1.8} aria-hidden="true" /> {locale} <ChevronDown size={14} aria-hidden="true" />
              </button>
              {localeOpen && (
                <ul className={styles.localeMenu} role="menu" aria-label="选择语言">
                  {locales.map((option) => (
                    <li key={option} role="none">
                      <button type="button" role="menuitemradio" aria-checked={option === locale}
                        className={styles.localeOption} onClick={() => { setLocale(option); setLocaleOpen(false); }}>
                        {option}{option === locale && <Check size={15} strokeWidth={2} aria-hidden="true" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link className={styles.loginButton} href="/login">登录</Link>
            <Link className={styles.headerPrimary} href="/register">立即开始 <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" /></Link>
            <Dialog.Trigger className={styles.mobileMenuButton} aria-label="打开导航菜单"><Menu size={21} aria-hidden="true" /></Dialog.Trigger>
          </div>
        </div>
      </header>

      <Dialog.Portal className={styles.mobileMenuPortal}>
        <Dialog.Backdrop className={styles.mobileBackdrop} />
        <Dialog.Popup className={styles.mobileMenuPopup}>
          <div className={styles.mobileMenuHeading}>
            <Dialog.Title>菜单</Dialog.Title>
            <Dialog.Close className={styles.mobileCloseButton} aria-label="关闭导航菜单"><X size={21} aria-hidden="true" /></Dialog.Close>
          </div>
          <nav aria-label="手机网站导航" className={styles.mobileNavigation}>
            <MobileMenuSection title="产品" menu="product" open={mobileGroup === "product"}
              onOpenChange={(open) => setMobileGroup(open ? "product" : null)} onNavigate={closeMobile} />
            <Link href="/node" onClick={closeMobile} className={styles.mobileDirectLink}>节点</Link>
            <Link href="/plan" onClick={closeMobile} className={styles.mobileDirectLink}>价格</Link>
            <MobileMenuSection title="帮助" menu="help" open={mobileGroup === "help"}
              onOpenChange={(open) => setMobileGroup(open ? "help" : null)} onNavigate={closeMobile} />
            <div className={styles.mobileMenuActions}>
              <Link href="/login" onClick={closeMobile}>登录</Link>
              <Link href="/register" onClick={closeMobile}>立即开始 <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
