"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BookOpen,
  LifeBuoy,
  Rss,
  ShoppingBag,
  RotateCcw,
  Network,
  Loader2,
  LogIn,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { noticeApi } from "@/lib/api/notice";
import type { Notice, ResetTrafficQuote } from "@/lib/api/types";
import { orderApi } from "@/lib/api/order";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";
import { ConfirmModal, Modal, useToast } from "@/components/v2-modal";
import { ErrorState, sanitizeHtml, useAsyncData } from "@/components/api-ui";
import { localApiRequest } from "@/lib/api/client";
import { TelegramIcon } from "@/components/telegram-icon";

export default function ApiDashboardPage() {
  const router = useRouter();
  const { user, subscribe, stat, isLoading, isAuthenticated, refreshUser } = useAuth();

  const [subscribeDrawerOpen, setSubscribeDrawerOpen] = useState(false);
  const { showToast } = useToast();
  const [resetQuote, setResetQuote] = useState<ResetTrafficQuote | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  // 先取报价再弹确认框：价格由服务端按「当前套餐月付价 × 后台比例」计算，没有生效中的套餐会直接提示原因。
  const openResetTraffic = async () => {
    setResetBusy(true);
    try {
      setResetQuote(await orderApi.fetchResetQuote());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "暂时无法购买流量重置", "warning");
    } finally {
      setResetBusy(false);
    }
  };
  const confirmResetTraffic = async () => {
    if (!resetQuote) return;
    setResetBusy(true);
    try {
      const tradeNo = await orderApi.saveOrder({ plan_id: resetQuote.plan_id, period: resetQuote.period });
      setResetQuote(null);
      router.push(`/order/${encodeURIComponent(tradeNo)}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "创建流量重置订单失败", "error");
    } finally {
      setResetBusy(false);
    }
  };
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const openTelegramBinding = async () => {
    setTelegramModalOpen(true); setTelegramError(null);
    try { const data = await localApiRequest<{ enabled: boolean; username: string }>("user/telegram/bind-code"); setTelegramUsername(data.username); if (!data.enabled) setTelegramError("Telegram Bot 当前未启用，请联系管理员。"); }
    catch (error) { setTelegramError(error instanceof Error ? error.message : "无法读取 Telegram Bot 配置"); }
  };
  const createTelegramCode = async () => { setTelegramBusy(true); setTelegramError(null); try { const data = await localApiRequest<{ code: string; username: string }>("user/telegram/bind-code", { method: "POST" }); setTelegramCode(data.code); setTelegramUsername(data.username); } catch (error) { setTelegramError(error instanceof Error ? error.message : "生成绑定码失败，请稍后重试"); } finally { setTelegramBusy(false); } };

  useEffect(() => {
    if (user?.telegram_id) return;
    const refreshTelegramStatus = () => { void refreshUser(); };
    window.addEventListener("focus", refreshTelegramStatus);
    return () => window.removeEventListener("focus", refreshTelegramStatus);
  }, [refreshUser, user?.telegram_id]);

  const noticesState = useAsyncData<Notice[]>(
    async () => {
      const data = await noticeApi.fetchNotices();
      return Array.isArray(data) ? data : [];
    },
    [],
    { enabled: isAuthenticated, fallbackMessage: "公告加载失败，请稍后重试" },
  );

  const notices = noticesState.data ?? [];
  const noticesLoading = noticesState.loading;

  // 计算订阅与流量数据。优先使用服务端下发的聚合值，避免前后端口径不一致。
  const planName = subscribe?.plan?.name || "尚未订阅套餐";
  const u = subscribe?.u ?? 0;
  const d = subscribe?.d ?? 0;
  const totalBytes = subscribe?.transfer_enable ?? 0;
  const usedBytes = subscribe?.used_bytes ?? u + d;

  const usedGB = (usedBytes / 1073741824).toFixed(2);
  const totalGB = (totalBytes / 1073741824).toFixed(2);
  const usagePercent =
    subscribe?.usage_percent ??
    (totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0);
  const remainGB = ((subscribe?.remain_bytes ?? Math.max(0, totalBytes - usedBytes)) / 1073741824).toFixed(2);

  const expiredDateStr = subscribe?.expired_at
    ? new Date(subscribe.expired_at * 1000).toLocaleDateString()
    : "长期有效";

  const daysLeft = subscribe?.days_remaining ?? null;

  const unpaidOrders = stat?.unpaid_orders ?? 0;
  const pendingTickets = stat?.open_tickets ?? 0;

  return (
    <div className="v2-dashboard">
      {/* 未登录友好提示卡片 */}
      {!isLoading && !isAuthenticated && (
        <div
          style={{
            padding: "16px 20px",
            background: "var(--v2-surface)",
            border: "1px solid var(--v2-border)",
            borderRadius: 4,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertCircle size={20} style={{ color: "var(--v2-primary)" }} />
            <div>
              <strong style={{ display: "block", color: "var(--v2-heading)" }}>
                API 生产模式运行中（未检测到有效登录态）
              </strong>
              <small style={{ color: "var(--v2-muted)" }}>
                请登入您的 V2Board 账户以同步真实数据；您也可随时前往 Demo 路由查看 1:1 演示页面。
              </small>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/login" className="btn btn-primary btn-sm">
              <LogIn size={14} />
              <span>登录账户</span>
            </Link>
            <Link href="/demo/dashboard" className="btn btn-secondary btn-sm">
              <span>查看 Demo 演示</span>
            </Link>
          </div>
        </div>
      )}

      {/* 顶部系统状态提示横幅 */}
      {(!user?.telegram_id || unpaidOrders > 0 || pendingTickets > 0) && <div className="v2-alert-container">
        {/* Telegram 绑定提示 */}
        {!user?.telegram_id && (
          <div className="v2-alert-bar v2-alert-telegram">
            <div className="v2-alert-left">
              <TelegramIcon size={17} />
              <span>绑定 Telegram 获取更多服务</span>
            </div>
            <button type="button" className="v2-alert-action" onClick={() => { void openTelegramBinding(); }} style={{ background: "transparent", border: 0, color: "inherit" }}>
              点击这里进行绑定
            </button>
          </div>
        )}

        {/* 未支付订单告警 */}
        {unpaidOrders > 0 && (
          <div className="v2-alert-bar v2-alert-warning">
            <div className="v2-alert-left">
              <AlertTriangle size={16} />
              <span>您有 {unpaidOrders} 笔待支付的订单</span>
            </div>
            <Link href="/order" className="v2-alert-action">
              立即支付
            </Link>
          </div>
        )}

        {/* 正在处理工单提示 */}
        {pendingTickets > 0 && (
          <div className="v2-alert-bar v2-alert-info">
            <div className="v2-alert-left">
              <AlertCircle size={16} />
              <span>{pendingTickets} 条工单正在处理中</span>
            </div>
            <Link href="/ticket" className="v2-alert-action">
              立即查看
            </Link>
          </div>
        )}
      </div>}

      {/* 公告板块 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={18} style={{ color: "var(--v2-primary)" }} />
            <h2>公告</h2>
          </div>
        </header>
        <div style={{ padding: "18px 20px", fontSize: 14, color: "var(--v2-text)", lineHeight: 1.7 }}>
          {noticesLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--v2-muted)" }}>
              <Loader2 size={16} className="animate-spin" />
              <span>正在加载最新公告...</span>
            </div>
          ) : noticesState.error ? (
            <ErrorState message={noticesState.error} onRetry={noticesState.reload} minHeight={80} />
          ) : notices.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {notices.map((item) => (
                <div key={item.id}>
                  <strong style={{ color: "var(--v2-heading)" }}>{item.title}</strong>
                  <div
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
                    style={{ marginTop: 4, color: "var(--v2-text)" }}
                  />
                  <small style={{ color: "var(--v2-muted)" }}>
                    发布于 {new Date(item.created_at * 1000).toLocaleString()}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--v2-muted)" }}>暂无已发布公告。</p>
          )}
        </div>
      </section>

      {/* 我的订阅 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>我的订阅</h2>
        </header>
        <div className="v2-subscription">
          {isLoading ? (
            <div style={{ padding: "10px 0", color: "var(--v2-muted)" }}>
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : (
            <>
              <h3>{planName}</h3>
              <p>
                {subscribe?.expired_at
                  ? `于 ${expiredDateStr} 到期${daysLeft !== null ? `，距离到期还有 ${daysLeft} 天` : ""}。已用流量将在 ${subscribe?.reset_day || 1} 日后重置`
                  : "长期有效订阅，流量按计划自动重置"}
              </p>
              <div className="v2-progress" aria-label={`已使用 ${usagePercent}% 流量`}>
                <span style={{ width: `${usagePercent}%` }} />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 10,
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <strong>
                  已用 {usedGB} GB / 剩余 {remainGB} GB / 总计 {totalGB} GB
                </strong>
                <div style={{ display: "flex", gap: 10 }}>
                  <Link href="/node" className="btn btn-secondary btn-sm">
                    <Network size={14} />
                    <span>查看节点状态</span>
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void openResetTraffic()}
                    disabled={resetBusy}
                  >
                    {resetBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    <span>购买流量重置</span>
                  </button>
                </div>
              </div>
              {subscribe?.queued_plans?.length ? (
                <div className="dashboard-queued-plans">
                  <span>排队中的套餐（当前套餐到期后按顺序生效）：</span>
                  <ol>
                    {subscribe.queued_plans.map((item) => (
                      <li key={item.trade_no}>
                        <Link href={`/order/${encodeURIComponent(item.trade_no)}`}>{item.plan_name}</Link>
                        <small>{item.period_label}</small>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* 捷径 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>捷径</h2>
        </header>
        <div className="shortcut-list">
          {/* 查看教程 */}
          <Link className="shortcut-row" href="/knowledge">
            <span>
              <strong>查看教程</strong>
              <small>学习如何使用 AeraNexa</small>
            </span>
            <BookOpen size={34} strokeWidth={1.15} aria-hidden="true" />
          </Link>

          {/* 一键订阅 */}
          <div
            className="shortcut-row"
            onClick={() => setSubscribeDrawerOpen(true)}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
          >
            <span>
              <strong>一键订阅</strong>
              <small>快速将节点导入对应客户端进行使用</small>
            </span>
            <Rss size={34} strokeWidth={1.15} aria-hidden="true" />
          </div>

          {/* 购买订阅 / 续费订阅 */}
          <Link className="shortcut-row" href="/plan">
            <span>
              <strong>续费订阅</strong>
              <small>对您当前的订阅进行购买或续费</small>
            </span>
            <ShoppingBag size={34} strokeWidth={1.15} aria-hidden="true" />
          </Link>

          {/* 遇到问题 */}
          <Link className="shortcut-row" href="/ticket">
            <span>
              <strong>遇到问题</strong>
              <small>遇到问题可以通过工单与我们沟通</small>
            </span>
            <LifeBuoy size={34} strokeWidth={1.15} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 一键订阅侧边抽屉 */}
      <OneClickSubscribeDrawer
        open={subscribeDrawerOpen}
        onClose={() => setSubscribeDrawerOpen(false)}
        subscribeUrl={subscribe?.subscribe_url}
      />

      {/* 重置流量确认弹窗 */}
      <ConfirmModal
        open={resetQuote !== null}
        title="购买流量重置？"
        content={
          resetQuote
            ? `将为「${resetQuote.plan_name}」重置已用流量，价格 ¥${(resetQuote.price / 100).toFixed(2)}（月付价的 ${resetQuote.percent}%）。确定后前往支付，支付完成立即生效，到期时间不变。`
            : ""
        }
        okText={resetBusy ? "正在创建订单…" : "去支付"}
        cancelText="取消"
        onOk={() => void confirmResetTraffic()}
        onCancel={() => setResetQuote(null)}
      />

      {/* 绑定 Telegram 模态框向导 */}
      <Modal
        open={telegramModalOpen}
        title="绑定 Telegram"
        onClose={() => setTelegramModalOpen(false)}
        width={480}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTelegramModalOpen(false)}
            >
              完成并关闭
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 14, fontSize: 14, color: "var(--v2-text)" }}>
          <p style={{ margin: 0 }}>第一步：在 Telegram 中搜索并私聊机器人 <code>@{telegramUsername || "AeraNexaBot"}</code></p>
          <p style={{ margin: 0 }}>第二步：生成一次性绑定码后，向机器人发送以下绑定指令：</p>
          <div
            style={{
              padding: "10px 14px",
              background: "var(--v2-header)",
              border: "1px solid var(--v2-border)",
              borderRadius: 4,
              fontFamily: "monospace",
              color: "var(--v2-primary)",
              fontWeight: 600,
              userSelect: "all",
            }}
          >
            /bind {user?.telegram_id ? `已绑定 ID: ${user.telegram_id}` : (telegramCode ?? "请生成绑定码")}
          </div>
          {!user?.telegram_id ? <button type="button" className="btn btn-primary" disabled={telegramBusy} onClick={() => { void createTelegramCode(); }}>{telegramBusy ? "正在生成…" : "生成 10 分钟有效绑定码"}</button> : null}
          {telegramError ? <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--v2-danger, #c53030)" }}>{telegramError}</p> : null}
          <p style={{ margin: 0, fontSize: 12, color: "var(--v2-muted)" }}>
            * 绑定码只可使用一次；绑定成功后可在 Bot 内查询订阅、流量、余额、订单与工单。
          </p>
        </div>
      </Modal>
    </div>
  );
}
