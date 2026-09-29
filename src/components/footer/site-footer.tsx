import Link from "next/link";
import { Mail } from "lucide-react";
import { siGithub, siTelegram } from "simple-icons";
import { FooterLogo } from "@/components/footer/footer-logo";
import { FooterMap } from "@/components/footer/footer-map";
import { FooterRoot } from "@/components/footer/footer-root";
import { FooterTicker } from "@/components/footer/footer-ticker";
import { PlanScene } from "@/components/pricing/pricing-scenes";
import { footerCopy, type FooterLink } from "@/lib/footer-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./site-footer.module.css";

const delay = (seconds: number) => ({ "--d": `${seconds}s` }) as React.CSSProperties;

function Label({ children, d = 0 }: { children: React.ReactNode; d?: number }) {
  return <div className={`${styles.mono} ${styles.t10} ${styles.soft} ${styles.rv}`} style={delay(d)}>{children}</div>;
}

// A link whose text rolls up on hover: two copies of it in one cell.
function RollLink({ link, current, d = 0 }: { link: FooterLink; current?: boolean; d?: number }) {
  const external = link.href.startsWith("mailto:") || link.href.startsWith("http");
  const inner = (
    <span className={styles.linkInner}>
      <span className={`${styles.linkTop} ${styles.t16}`}>{link.label}</span>
      <span className={`${styles.linkBottom} ${styles.t16}`} aria-hidden="true">{link.label}</span>
    </span>
  );
  return external || link.href.startsWith("#")
    ? <a className={`${styles.link} ${styles.rv}`} style={delay(d)} href={link.href} aria-current={current ? "page" : undefined}>{inner}</a>
    : <Link className={`${styles.link} ${styles.rv}`} style={delay(d)} href={link.href} aria-current={current ? "page" : undefined}>{inner}</Link>;
}

const brand = (path: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={path} /></svg>
);

/** The site footer (see site-footer.module.css). `current` is the path of the
 *  page it is on, so its menu entry gets the accent colour. */
export function SiteFooter({ locale, current = "/" }: { locale: HomeLocale; current?: string }) {
  const copy = footerCopy[locale];
  const icons = { telegram: brand(siTelegram.path), github: brand(siGithub.path), mail: <Mail strokeWidth={1.6} aria-hidden="true" /> };

  return (
    <FooterRoot lang={copy.lang}>
      <div className={styles.inner}>
        <div className={styles.container}>
          <div className={`${styles.tagline} ${styles.t14} ${styles.soft} ${styles.rv}`}>{copy.tagline[0]}<br />{copy.tagline[1]}</div>

          <div className={styles.socials}>
            <div className={`${styles.rule} ${styles.rvLine}`} />
            <div className={styles.item}>
              <Label>{copy.labels.socials}</Label>
              <div className={styles.socialLinks}>
                {copy.socials.map((social, index) => (
                  <a key={social.name} className={`${styles.social} ${styles.rv}`} style={delay(0.1 + index * 0.04)} href={social.href} aria-label={social.name}>{icons[social.icon]}</a>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.menu}>
            <div className={`${styles.rule} ${styles.rvLine}`} style={delay(0.2)} />
            <div className={styles.menuWrap}>
              <div className={styles.item}>
                <Label d={0.1}>{copy.labels.product}</Label>
                <div className={styles.menuList}>
                  {copy.menu.map((link, index) => <RollLink key={link.href} link={link} current={link.href === current} d={0.1 + index * 0.03} />)}
                </div>
              </div>
              <div className={styles.side}>
                <Label d={0.15}>{copy.labels.worksWith}</Label>
                <div className={styles.sideBody}>
                  <div className={`${styles.t14} ${styles.soft} ${styles.rv}`} style={delay(0.15)}>{copy.worksWith.text[0]}<br />{copy.worksWith.text[1]}</div>
                  <div className={`${styles.clients} ${styles.rv}`} style={delay(0.25)}>
                    {copy.worksWith.clients.map((name) => <span key={name} className={styles.client}>{name}</span>)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.info}>
            <FooterTicker tabs={copy.tabs} />
          </div>

          <div className={styles.thumb}>
            <div className={`${styles.thumbBox} ${styles.rv}`} style={delay(0.1)} aria-hidden="true">
              <PlanScene scene="galaxy" dark className={styles.thumbArt} />
            </div>
          </div>

          <div className={styles.main}>
            <div className={`${styles.rule} ${styles.mainLine} ${styles.rvLine}`} />
            <div className={styles.address}>
              <div className={styles.item}>
                <Label>{copy.labels.network}</Label>
                <div className={`${styles.t16} ${styles.rv}`}>{copy.network.lines[0]}<br />{copy.network.lines[1]}</div>
                <Link className={`${styles.direction} ${styles.rv}`} style={delay(0.1)} href={copy.network.link.href}>
                  <span className={styles.directionIcon} aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none"><path d="M9.49951 13.5L13.4995 9.5L9.49951 5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M12.9995 9.5H2.99951V4.5" stroke="currentColor" strokeWidth="1.3" /></svg>
                  </span>
                  <span className={styles.hoverLine}><span className={styles.t14}>{copy.network.link.label}</span></span>
                </Link>
              </div>
              <div className={styles.item}>
                <Label>{copy.labels.operating}</Label>
                <div className={styles.places}>
                  {copy.operating.map((place) => (
                    <div key={place} className={`${styles.place} ${styles.rv}`}>
                      <span className={styles.t16}>{place}</span>
                      <span className={`${styles.slash} ${styles.t16}`}>/</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.contact}>
              <div className={styles.item}>
                <Label>{copy.labels.email}</Label>
                <RollLink link={copy.contact.email} />
              </div>
              <div className={styles.item}>
                <Label>{copy.labels.telegram}</Label>
                <RollLink link={copy.contact.telegram} />
              </div>
              <div className={styles.item}>
                <Label>{copy.labels.hours}</Label>
                <div className={`${styles.t16} ${styles.rv}`}>{copy.contact.hours}</div>
              </div>
            </div>

            <FooterMap label={copy.labels.operating} />
          </div>

          <div className={styles.bot}>
            <div className={`${styles.rule} ${styles.rvLine}`} />
            <div className={styles.botInner}>
              <p className={`${styles.copyright} ${styles.mono} ${styles.t9} ${styles.soft} ${styles.rv}`} style={delay(0.2)}>{copy.legal.copyright}</p>
              <div className={styles.botWrap}>
                <div className={styles.legalMenu}>
                  {copy.legal.links.map((link) => (
                    <a key={link.label} className={`${styles.legalLink} ${styles.mono} ${styles.t9} ${styles.rv}`} style={delay(0.2)} href={link.href}>{link.label}</a>
                  ))}
                </div>
                <p className={`${styles.legalNote} ${styles.mono} ${styles.t9} ${styles.rv}`} style={delay(0.2)}>{copy.legal.note}</p>
              </div>
            </div>
          </div>

          <div className={styles.logo}>
            <FooterLogo text="AeraNexa" />
          </div>
        </div>
      </div>
    </FooterRoot>
  );
}
