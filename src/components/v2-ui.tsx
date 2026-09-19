import type { ReactNode } from "react";

export function V2Block({ title, action, children, className = "", style }: { title: string; action?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <section className={`v2-block ${className}`} style={style}><header className="v2-block-header"><h2>{title}</h2>{action && <div className="block-actions">{action}</div>}</header>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`v2-badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="v2-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="v2-note">{children}</div>;
}
