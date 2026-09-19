import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

type SectionQuery = {
  section: string;
  q: string;
};

function buildHref(section: string, q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/${section}${query ? `?${query}` : ""}`;
}

/**
 * 列表页顶部工具栏：搜索框。
 * 与各板块自己的「新建 X」按钮同处一排（靠 .admin-editor 的两列网格对齐），
 * 使用原生 GET 表单，无需客户端 JS，刷新与分享链接都能保持查询状态。
 */
export function AdminListToolbar({ section, q }: SectionQuery) {
  const placeholders: Record<string, string> = {
    "recharge-cards": "搜索批次名称或编号…",
    traffic: "按节点名称筛选…",
  };
  const placeholder = placeholders[section] ?? "按关键词筛选…";
  return (
    <form className="admin-list-toolbar" action={`/admin/${section}`} method="get">
      <span className="admin-search-box">
        <Search size={15} aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="筛选当前列表"
          maxLength={100}
        />
      </span>
      <button type="submit" className="admin-action-button">筛选</button>
      {q ? <Link href={`/admin/${section}`} className="admin-action-button">清除</Link> : null}
    </form>
  );
}

/**
 * 列表页底部页码条：左侧统计、右侧翻页。
 */
export function AdminListPager({ section, q, page, pageSize, total }: SectionQuery & {
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <section className="admin-list-pager">
      <span className="admin-pager-summary">
        共 {total} 条{q ? "（已筛选）" : ""}，当前 {from}-{to}
      </span>
      <div className="admin-pager">
        <Link
          href={buildHref(section, q, page - 1)}
          className="admin-action-button"
          aria-disabled={atFirst}
          tabIndex={atFirst ? -1 : undefined}
          style={atFirst ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          <ChevronLeft size={14} />上一页
        </Link>
        <span className="admin-pager-page">
          {page} / {totalPages}
        </span>
        <Link
          href={buildHref(section, q, page + 1)}
          className="admin-action-button"
          aria-disabled={atLast}
          tabIndex={atLast ? -1 : undefined}
          style={atLast ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          下一页<ChevronRight size={14} />
        </Link>
      </div>
    </section>
  );
}
