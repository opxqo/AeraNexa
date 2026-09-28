"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Binary, FileCode, Fingerprint, Gauge, Link2, Network, ScanSearch, Server } from "lucide-react";
import { featureCopy, type FeatureCardCopy } from "@/lib/feature-copy";
import type { HomeLocale } from "@/lib/home-copy";
import styles from "./feature-tabs.module.css";

// Tabbed feature explainer, laid out after the pricing block on
// cloudflare.com's home page (see feature-tabs.module.css for the measured
// values). Three tabs explain subscriptions, nodes and traffic; every claim
// maps to code (see the notes by each tab), and made-up numbers are marked
// as samples.

function Ticks({ accent = false }: { accent?: boolean }) {
  return (
    <span className={`${styles.ticks} ${accent ? styles.accentTicks : ""}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

type TabId = "subscription" | "nodes" | "traffic";
const TABS: { id: TabId; icon: ReactNode }[] = [
  { id: "subscription", icon: <Link2 strokeWidth={1.7} /> },
  { id: "nodes", icon: <Server strokeWidth={1.7} /> },
  { id: "traffic", icon: <Gauge strokeWidth={1.7} /> },
];

function Intro({ title, children, diagram, diagramClass = "" }: { title: string; children: ReactNode; diagram: ReactNode; diagramClass?: string }) {
  return (
    <div className={styles.intro}>
      <div className={styles.introCopy}>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      <div className={`${styles.diagram} ${diagramClass}`}>
        <Ticks />
        {diagram}
      </div>
    </div>
  );
}

type CardData = FeatureCardCopy;

function Cards({ cards, columns }: { cards: CardData[]; columns: "four" | "three" }) {
  return (
    <>
      <div className={`${styles.cards} ${styles[columns]}`}>
        {cards.map((card) => (
          <div key={card.name} className={styles.card}>
            <p className={styles.cardName}><strong>{card.name}</strong><br /><span>{card.note}</span></p>
            <div className={styles.figure}><div><strong>{card.figure}</strong><small>{card.unit}</small></div></div>
            <div className={styles.chips}>{card.chips.map((chip) => <span key={chip} className={styles.chip}>{chip}</span>)}</div>
            <Link className={styles.cta} href={card.href}>{card.cta}</Link>
          </div>
        ))}
      </div>
      <div className={styles.dots} aria-hidden="true" />
    </>
  );
}

// ① Subscriptions. Formats follow wantsClash() (src/lib/server/panel/clash.ts);
// devices are registered by HWID (/api/user/devices); the link can be reset
// (/api/user/resetSecurity). Each pull is built from the current nodes.
const STEP_ICONS = [<ScanSearch key="detect" />, <FileCode key="clash" />, <Binary key="base64" />, <Fingerprint key="device" />, <Network key="nodes" />];

function SubscriptionFlow({ copy }: { copy: { steps: string[]; client: string; nodes: string; note: string } }) {
  return (
    <div className={styles.flow}>
      <div className={styles.flowEnds}><span>{copy.client}</span><b>{copy.nodes}</b></div>
      <div className={styles.flowSteps}>
        {copy.steps.map((label, index) => <div key={label} className={styles.step}>{STEP_ICONS[index]}{label}</div>)}
      </div>
      <div className={styles.flowNote}>{copy.note}</div>
    </div>
  );
}

// ② Nodes. Protocols: SYNC_PROTOCOLS (vless / vmess / trojan, REALITY via
// panel/reality.ts); live status: /api/monitor/stream; seats: /api/user/devices.
const NODES = [
  { name: "HK-01", proto: "VLESS·REALITY", load: 42 },
  { name: "JP-02", proto: "VMess", load: 57 },
  { name: "SG-01", proto: "Trojan", load: 33 },
  { name: "US-03", proto: "VLESS·REALITY", load: 68 },
];

function NodeRows({ sample }: { sample: string }) {
  return (
    <div className={styles.nodes}>
      {NODES.map((node) => (
        <div key={node.name} className={styles.nodeRow}>
          <span className={styles.online} aria-hidden="true" />
          <span className={styles.nodeName}>{node.name}</span>
          <span className={styles.proto}>{node.proto}</span>
          <span className={styles.track}><i style={{ width: `${node.load}%` }} /></span>
          <span className={styles.pct}>{node.load}%</span>
        </div>
      ))}
      <span className={styles.sample}>{sample}</span>
    </div>
  );
}

// ③ Traffic. Usage is counted from bytes each node reports
// (panel/collect-traffic.ts), so idle time costs nothing. A traffic reset
// zeroes the used bytes once paid, is priced at the monthly price times the
// admin's reset percentage, and leaves the expiry date alone (fulfillOrder
// and resetTrafficPrice in src/lib/server/client-portal.ts).
function Used({ value }: { value: string }) {
  return <div className={styles.used}><b>{value}</b></div>;
}

function Idle({ label, word }: { label: string; word: string }) {
  return (
    <div className={styles.idle}>
      <div className={styles.idleBody}>
        <div className={styles.idleWords} aria-hidden="true">
          {[0, 1, 2, 3].map((row) => <span key={row}>{`${word}  `.repeat(24)}</span>)}
        </div>
      </div>
      <small>{label}</small>
    </div>
  );
}

function TrafficTimeline({ copy }: { copy: { idleWord: string; idleHours: string; idleNight: string; counted: string; notCounted: string } }) {
  return (
    <>
      <div className={styles.timeline}>
        <div className={styles.lead} />
        <Used value="1.2 GB" />
        <Idle label={copy.idleHours} word={copy.idleWord} />
        <Used value="80 MB" />
        <Idle label={copy.idleNight} word={copy.idleWord} />
        <Used value="600 MB" />
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span><i />{copy.counted}</span>
        <span><i />{copy.notCounted}</span>
      </div>
    </>
  );
}

type Tile = { value: string; label: string };

function PlanBox({ tabs, accent = false }: { tabs: { name: string; tiles: Tile[] }[]; accent?: boolean }) {
  const [index, setIndex] = useState(0);
  return (
    <div className={styles.planBox}>
      <Ticks accent={accent} />
      <div className={styles.miniTabs} role="tablist">
        {tabs.map((tab, tabIndex) => (
          <button key={tab.name} type="button" role="tab" aria-selected={tabIndex === index} className={styles.miniTab} onClick={() => setIndex(tabIndex)}>
            {tab.name}
          </button>
        ))}
      </div>
      {tabs[index].tiles.map((tile) => (
        <div key={`${index}-${tile.label}`} className={styles.tile}>
          <strong>{tile.value}</strong>
          <span>/ {tile.label}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ active, id, children }: { active: boolean; id: TabId; children: ReactNode }) {
  return (
    <div id={`feature-panel-${id}`} role="tabpanel" aria-labelledby={`feature-tab-${id}`} aria-hidden={!active} className={styles.panel} data-active={active ? "" : undefined} inert={!active}>
      {children}
    </div>
  );
}

export function FeatureTabs({ locale }: { locale: HomeLocale }) {
  const copy = featureCopy[locale].tabs;
  const [active, setActive] = useState<TabId>("subscription");
  const tabsRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ subscription: null, nodes: null, traffic: null });

  // Slide the thumb under the selected tab and clip the white labels to it.
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const place = () => {
      const button = buttonRefs.current[active];
      if (!tabs || !button || !thumbRef.current || !litRef.current) return;
      const left = button.offsetLeft;
      const width = button.offsetWidth;
      thumbRef.current.style.left = `${4 + left}px`;
      thumbRef.current.style.width = `${width}px`;
      litRef.current.style.clipPath = `inset(0 ${tabs.offsetWidth - left - width}px 0 ${left}px round 999px)`;
    };
    place();
    const observer = new ResizeObserver(place);
    if (tabs) observer.observe(tabs);
    return () => observer.disconnect();
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === active);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setActive(next);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div className={styles.section}>
      <div className={styles.barRow}>
        <div className={styles.bar}>
          <span ref={thumbRef} className={styles.thumb} aria-hidden="true" />
          <div ref={tabsRef} className={styles.tabs} role="tablist" aria-label={copy.tablistLabel} onKeyDown={onKeyDown}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(element) => { buttonRefs.current[tab.id] = element; }}
                id={`feature-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={tab.id === active}
                aria-controls={`feature-panel-${tab.id}`}
                tabIndex={tab.id === active ? 0 : -1}
                className={styles.tab}
                onClick={() => setActive(tab.id)}
              >
                {tab.icon}{copy.tabs[tab.id]}
              </button>
            ))}
          </div>
          <div ref={litRef} className={styles.tabsLit} aria-hidden="true">
            {TABS.map((tab) => <span key={tab.id} className={styles.tab}>{tab.icon}{copy.tabs[tab.id]}</span>)}
          </div>
        </div>
      </div>

      <div className={styles.frame}>
        <Ticks />
        <div className={styles.box}>
          <div className={styles.stack}>
            <Panel id="subscription" active={active === "subscription"}>
              <Intro title={copy.subscription.title} diagram={<SubscriptionFlow copy={copy.subscription} />}>
                {copy.subscription.body}
              </Intro>
              <Cards cards={copy.subscription.cards} columns="four" />
            </Panel>

            <Panel id="nodes" active={active === "nodes"}>
              <Intro title={copy.nodes.title} diagram={<NodeRows sample={copy.sample} />}>
                {copy.nodes.body}
              </Intro>
              <Cards cards={copy.nodes.cards} columns="three" />
            </Panel>

            <Panel id="traffic" active={active === "traffic"}>
              <Intro title={copy.traffic.title} diagram={<TrafficTimeline copy={copy.traffic} />} diagramClass={styles.timelineBox}>
                {copy.traffic.body}
              </Intro>
              <div className={styles.plans}>
                <div className={styles.plan}>
                  <div className={styles.planHead}>
                    <div><h4>{copy.traffic.planTitle}</h4><p>{copy.traffic.planLead} · <span className={styles.sample}>{copy.traffic.samplePlan}</span></p></div>
                    <Link className={styles.cta} href="/plan">{copy.traffic.planCta}</Link>
                  </div>
                  <PlanBox tabs={copy.traffic.planTabs} />
                </div>
                <div className={`${styles.plan} ${styles.planAccent}`}>
                  <div className={styles.planHead}>
                    <div><h4>{copy.traffic.resetTitle}</h4><p>{copy.traffic.resetLead}</p></div>
                    <Link className={styles.cta} href="/login">{copy.traffic.resetCta}</Link>
                  </div>
                  <PlanBox tabs={copy.traffic.resetTabs} accent />
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
