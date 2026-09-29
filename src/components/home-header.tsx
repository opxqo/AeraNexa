"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { ArrowRight, Check, ChevronDown, Globe2, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { setHomeLocale } from "@/app/home-locale-action";
import { homeCopy, type HomeLocale } from "@/lib/home-copy";
import styles from "@/app/home-hero.module.css";

type MenuKey = "product" | "help";
type MenuSection = (typeof homeCopy)[HomeLocale]["header"]["menus"][MenuKey][number];

// Each option is shown in its own language.
const locales: { value: HomeLocale; label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

function DesktopMenuPanel({ sections, onNavigate }: { sections: MenuSection[]; onNavigate: () => void }) {
  return (
    <div className={styles.navPanel}>
      {sections.map((section) => (
        <div className={styles.navPanelColumn} key={section.heading}>
          <p className={styles.navPanelHeading}>{section.heading}</p>
          <ul className={styles.navPanelEntries}>
            {section.entries.map((entry) => (
              <li key={entry.href}>
                <NavigationMenu.Link render={<Link href={entry.href} />} className={styles.navPanelLink} onClick={onNavigate}>
                  {entry.label}
                </NavigationMenu.Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MobileMenuSection({ title, sections, open, onOpenChange, onNavigate }: {
  title: string;
  sections: MenuSection[];
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
        {sections.map((section) => (
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

export function HomeHeader({ locale }: { locale: HomeLocale }) {
  const copy = homeCopy[locale].header;
  const [, startTransition] = useTransition();
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<MenuKey | null>(null);
  const [localeOpen, setLocaleOpen] = useState(false);
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

  // Keep the document language in step with the page (the root layout's
  // <html lang> is static).
  useEffect(() => {
    document.documentElement.lang = homeCopy[locale].lang;
  }, [locale]);

  // The server action stores the choice and re-renders the page in it.
  const chooseLocale = (next: HomeLocale) => {
    setLocaleOpen(false);
    if (next === locale) return;
    startTransition(async () => {
      await setHomeLocale(next);
    });
  };

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
          <Link className={styles.brand} href="/" aria-label={copy.homeLabel} onClick={() => setActiveMenu(null)}>
            <BrandMark size={28} />
            <span>AeraNexa</span>
          </Link>

          <NavigationMenu.Root value={activeMenu} onValueChange={setActiveMenu} delay={0} closeDelay={80}
            className={styles.desktopNavigation} aria-label={copy.navLabel}>
            <NavigationMenu.List className={styles.desktopNavList}>
              <NavigationMenu.Item value="product">
                <NavigationMenu.Trigger className={styles.navTrigger}>
                  {copy.product}<NavigationMenu.Icon className={styles.navChevron}><ChevronDown size={18} aria-hidden="true" /></NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted>
                  <DesktopMenuPanel sections={copy.menus.product} onNavigate={() => setActiveMenu(null)} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
              <NavigationMenu.Item>
                <NavigationMenu.Link render={<Link href="/node" />} className={styles.navDirectLink}>{copy.nodes}</NavigationMenu.Link>
              </NavigationMenu.Item>
              <NavigationMenu.Item>
                <NavigationMenu.Link render={<Link href="/pricing" />} className={styles.navDirectLink}>{copy.pricing}</NavigationMenu.Link>
              </NavigationMenu.Item>
              <NavigationMenu.Item value="help">
                <NavigationMenu.Trigger className={styles.navTrigger}>
                  {copy.help}<NavigationMenu.Icon className={styles.navChevron}><ChevronDown size={18} aria-hidden="true" /></NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted>
                  <DesktopMenuPanel sections={copy.menus.help} onNavigate={() => setActiveMenu(null)} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
            </NavigationMenu.List>
            <NavigationMenu.Portal className={styles.navPortal} keepMounted>
              <NavigationMenu.Positioner sideOffset={6} align="start" className={styles.navPositioner}>
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
                <Globe2 size={17} strokeWidth={1.8} aria-hidden="true" /> {locales.find((option) => option.value === locale)?.label} <ChevronDown size={14} aria-hidden="true" />
              </button>
              {localeOpen && (
                <ul className={styles.localeMenu} role="menu" aria-label={copy.languageLabel}>
                  {locales.map((option) => (
                    <li key={option.value} role="none">
                      <button type="button" role="menuitemradio" aria-checked={option.value === locale} lang={homeCopy[option.value].lang}
                        className={styles.localeOption} onClick={() => chooseLocale(option.value)}>
                        {option.label}{option.value === locale && <Check size={15} strokeWidth={2} aria-hidden="true" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link className={styles.loginButton} href="/login">{copy.login}</Link>
            <Link className={styles.headerPrimary} href="/register">{copy.getStarted} <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" /></Link>
            <span className={styles.headerDivider} aria-hidden="true" />
            <Link className={styles.headerOutline} href="/node">{copy.viewNodes}<span aria-hidden="true">→</span></Link>
            <Dialog.Trigger className={styles.mobileMenuButton} aria-label={copy.openMenu}><Menu size={21} aria-hidden="true" /></Dialog.Trigger>
          </div>
        </div>
      </header>

      <Dialog.Portal className={styles.mobileMenuPortal}>
        <Dialog.Backdrop className={styles.mobileBackdrop} />
        <Dialog.Popup className={styles.mobileMenuPopup}>
          <div className={styles.mobileMenuHeading}>
            <Dialog.Title>{copy.menuTitle}</Dialog.Title>
            <Dialog.Close className={styles.mobileCloseButton} aria-label={copy.closeMenu}><X size={21} aria-hidden="true" /></Dialog.Close>
          </div>
          <nav aria-label={copy.mobileNavLabel} className={styles.mobileNavigation}>
            <MobileMenuSection title={copy.product} sections={copy.menus.product} open={mobileGroup === "product"}
              onOpenChange={(open) => setMobileGroup(open ? "product" : null)} onNavigate={closeMobile} />
            <Link href="/node" onClick={closeMobile} className={styles.mobileDirectLink}>{copy.nodes}</Link>
            <Link href="/pricing" onClick={closeMobile} className={styles.mobileDirectLink}>{copy.pricing}</Link>
            <MobileMenuSection title={copy.help} sections={copy.menus.help} open={mobileGroup === "help"}
              onOpenChange={(open) => setMobileGroup(open ? "help" : null)} onNavigate={closeMobile} />
            <div className={styles.mobileMenuActions}>
              <Link href="/login" onClick={closeMobile}>{copy.login}</Link>
              <Link href="/register" onClick={closeMobile}>{copy.getStarted} <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
