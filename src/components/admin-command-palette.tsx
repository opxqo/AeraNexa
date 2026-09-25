"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { adminSections, adminSubPages, subPageHref } from "@/lib/admin-navigation";

type Entry = { href: string; title: string; context: string; haystack: string };

/** 所有可跳转的后台页面：导航项 + 页面内的子页（支付测试台、商户保活、各日志视图…） */
function buildEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const section of adminSections) {
    const subs = adminSubPages.filter((page) => page.parent === section.href);
    entries.push({
      href: section.href,
      title: section.label,
      context: section.group ?? "概览",
      haystack: `${section.label} ${section.description} ${section.group ?? ""} ${section.href}`.toLowerCase(),
    });
    for (const page of subs) {
      if (!page.value) continue; // 默认子页就是导航项本身
      entries.push({
        href: subPageHref(page),
        title: page.label,
        context: section.label,
        haystack: `${page.label} ${section.label} ${page.keywords ?? ""}`.toLowerCase(),
      });
    }
  }
  return entries;
}

export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}

/** ⌘K / Ctrl+K 快速跳转：输入页面名搜索，↑↓ 选择，回车跳转，Esc 关闭。只在打开时挂载，每次打开都是全新状态。 */
export function AdminCommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const entries = useMemo(() => buildEntries(), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? entries.filter((entry) => terms.every((term) => entry.haystack.includes(term))) : entries;
  }, [entries, query]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); go(results[active]); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  return (
    <div className="admin-palette-root" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-palette" role="dialog" aria-modal="true" aria-label="快速跳转">
        <div className="admin-palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="搜索页面，例如「订单」「保活」「日志」"
            aria-label="搜索后台页面"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-palette-list"
            aria-activedescendant={results[active] ? `admin-palette-${active}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="admin-palette-list" ref={listRef} className="admin-palette-list" role="listbox">
          {results.length ? results.map((entry, index) => (
            <li
              key={entry.href}
              id={`admin-palette-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={index === active ? "active" : undefined}
              onMouseMove={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); go(entry); }}
            >
              <span className="admin-palette-title">{entry.title}</span>
              <span className="admin-palette-context">{entry.context}</span>
              {index === active ? <CornerDownLeft size={14} aria-hidden="true" /> : null}
            </li>
          )) : <li className="admin-palette-empty">没有匹配的页面</li>}
        </ul>
      </div>
    </div>
  );
}
