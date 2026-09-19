"use client";

/**
 * 前台门户通用交互原语。
 *
 * 目标：把「加载中 / 加载失败可重试 / 空数据」三态、字段级校验、
 * 以及防重复提交这些重复逻辑收敛到一处，避免每个页面各写一套。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";

/* -------------------------------------------------------------------------
   工具
------------------------------------------------------------------------- */

/** 把任意抛出物归一为可展示的文案。 */
export function toErrorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

/**
 * 复制文本。navigator.clipboard 在非安全上下文（http、内嵌 WebView）下不可用，
 * 因此回退到 textarea + execCommand，避免出现「点了没反应」。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走回退方案
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------
   富文本净化
------------------------------------------------------------------------- */

/**
 * 极简 HTML 净化。
 *
 * 公告与知识库正文由管理员录入并以 dangerouslySetInnerHTML 渲染，
 * 这里在客户端用 DOMParser 剥离脚本类节点、内联事件处理器、
 * style 属性与 javascript: 协议，降低存储型 XSS 风险。
 * 注意：这不是完整的净化器（如 DOMPurify）替代品，仅覆盖常见注入面。
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  try {
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = parsed.body.firstElementChild;
    if (!root) return "";
    const blocked = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "STYLE", "FORM", "BASE"]);
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (blocked.has(el.tagName)) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "srcdoc") {
          el.removeAttribute(attr.name);
        } else if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    return root.innerHTML;
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------
   数据加载
------------------------------------------------------------------------- */

export interface AsyncData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** 重新拉取；也可在本地变更后调用，保证与服务端一致。 */
  reload: () => void;
  /** 乐观更新本地数据，不触发请求。 */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * 统一的异步数据读取钩子。
 *
 * 实现要点：
 * - loader 用 ref 持有（在 effect 中更新），因此无需调用方用 useCallback 包裹。
 * - 不记录「loading 布尔值」，而是记录「最近一次完成的请求键」，
 *   由渲染期纯计算得出 loading，避免在 effect 中同步 setState 引发级联渲染。
 * - deps 变化或调用 reload() 时请求键变化，自动重新拉取。
 * - 组件卸载后不再 setState，避免内存泄漏。
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
  options: { fallbackMessage?: string; enabled?: boolean } = {},
): AsyncData<T> {
  const { fallbackMessage = "数据加载失败，请重试", enabled = true } = options;

  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);

  const requestKey = `${deps.map((dep) => String(dep)).join("\u0001")}\u0002${tick}`;

  const loaderRef = useRef(loader);
  const fallbackRef = useRef(fallbackMessage);

  // 先声明先执行：本次提交中 ref 一定在下方请求 effect 之前被更新。
  useEffect(() => {
    loaderRef.current = loader;
    fallbackRef.current = fallbackMessage;
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const key = requestKey;

    loaderRef
      .current()
      .then((value) => {
        if (alive) setResult({ key, data: value, error: null });
      })
      .catch((err: unknown) => {
        // 保留上一次成功的数据，避免请求失败时页面瞬间变空。
        if (alive) {
          setResult((prev) => ({
            key,
            data: prev?.data ?? null,
            error: toErrorMessage(err, fallbackRef.current),
          }));
        }
      });

    return () => {
      alive = false;
    };
  }, [requestKey, enabled]);

  const current = result && result.key === requestKey ? result : null;
  const loading = enabled && current === null;

  const reload = useCallback(() => setTick((value) => value + 1), []);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T | null>>>(
    (action) => {
      setResult((prev) => {
        const base = prev && prev.key === requestKey ? prev.data : null;
        const next =
          typeof action === "function" ? (action as (previous: T | null) => T | null)(base) : action;
        return { key: requestKey, data: next, error: null };
      });
    },
    [requestKey],
  );

  return { data: current?.data ?? null, error: current?.error ?? null, loading, reload, setData };
}

/* -------------------------------------------------------------------------
   三态渲染
------------------------------------------------------------------------- */

export function LoadingState({ text = "加载中...", minHeight = 160 }: { text?: string; minHeight?: number }) {
  return (
    <div className="async-state" style={{ minHeight }} role="status" aria-live="polite">
      <Loader2 size={22} className="animate-spin" />
      <p>{text}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  minHeight = 160,
}: {
  message: string;
  onRetry?: () => void;
  minHeight?: number;
}) {
  return (
    <div className="async-state async-state-error" style={{ minHeight }} role="alert">
      <AlertCircle size={22} />
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RefreshCw size={13} />
          <span>重新加载</span>
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  children,
  minHeight = 140,
}: {
  children: React.ReactNode;
  minHeight?: number;
}) {
  return (
    <div className="async-state async-state-empty" style={{ minHeight }}>
      <Inbox size={22} />
      <p>{children}</p>
    </div>
  );
}

interface AsyncBoundaryProps {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  loadingText?: string;
  minHeight?: number;
  /**
   * 空态内容。传 `undefined` 表示由 children 自行处理空态；
   * 传任意节点（含空字符串）则在 loading/error 之后优先展示空态。
   */
  empty?: React.ReactNode;
  children: React.ReactNode;
}

/** 依次处理 加载中 → 加载失败 → 空数据 → 正常内容。 */
export function AsyncBoundary({
  loading,
  error,
  onRetry,
  loadingText,
  minHeight,
  empty,
  children,
}: AsyncBoundaryProps) {
  if (loading) return <LoadingState text={loadingText} minHeight={minHeight} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} minHeight={minHeight} />;
  if (empty !== undefined) return <EmptyState minHeight={minHeight}>{empty}</EmptyState>;
  return <>{children}</>;
}

/* -------------------------------------------------------------------------
   表单交互
------------------------------------------------------------------------- */

/**
 * 防重复提交。
 *
 * 用 ref 做同步锁而不是只看 state：state 更新是异步的，
 * 快速连点两次时第二次渲染前 pending 仍是 false，会漏判。
 */
export function useSubmitGuard() {
  const [pending, setPending] = useState(false);
  const lockRef = useRef(false);

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setPending(true);
    try {
      return await task();
    } finally {
      lockRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}

/** 字段级错误提示。 */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <small className="field-error">{children}</small>;
}
