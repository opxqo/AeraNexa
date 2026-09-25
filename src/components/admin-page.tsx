import Link from "next/link";

/**
 * 管理端页面骨架：紧凑页头（标题 + 一行说明 + 右侧操作）、可选标签页、正文纵向堆叠。
 * 顶栏只显示分组名，页面标题只在这里出现一次。
 */
export function AdminPage({ title, description, actions, tabs, children }: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div className="admin-page-title">
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="admin-page-actions">{actions}</div> : null}
      </header>
      {tabs}
      {children}
    </div>
  );
}

export type AdminTab = { key: string; label: string; href: string };

/** 页面内标签页；窄屏横向滚动而不是换行。 */
export function AdminTabs({ tabs, active, label }: { tabs: readonly AdminTab[]; active: string; label: string }) {
  return (
    <nav className="admin-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? "active" : undefined}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
