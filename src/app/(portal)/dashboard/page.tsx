"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BookOpen,
  LifeBuoy,
  Rss,
  Send,
  ShoppingBag,
  RotateCcw,
  Network,
  Loader2,
  LogIn,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { noticeApi } from "@/lib/api/notice";
import type { Notice } from "@/lib/api/types";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";
import { ConfirmModal, Modal } from "@/components/v2-modal";

export default function ApiDashboardPage() {
  const router = useRouter();
  const { user, subscribe, stat, isLoading, isAuthenticated } = useAuth();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [subscribeDrawerOpen, setSubscribeDrawerOpen] = useState(false);
  const [resetTrafficModalOpen, setResetTrafficModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    setNoticesLoading(true);
    noticeApi
      .fetchNotices()
      .then((data) => setNotices(data))
      .catch(() => setNotices([]))
      .finally(() => setNoticesLoading(false));
  }, [isAuthenticated]);

  // 计算订阅与流量数据
  const planName = subscribe?.plan?.name || "尚未订阅套餐";
  const u = subscribe?.u ?? 0;
  const d = subscribe?.d ?? 0;
  const totalBytes = subscribe?.transfer_enable ?? 0;
  const usedBytes = u + d;

  const usedGB = (usedBytes / 1073741824).toFixed(2);
  const totalGB = (totalBytes / 1073741824).toFixed(2);
  const usagePercent = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

  const expiredDateStr = subscribe?.expired_at
    ? new Date(subscribe.expired_at * 1000).toLocaleDateString()
    : "长期有效";

  const daysLeft = subscribe?.expired_at
    ? Math.max(0, Math.ceil((subscribe.expired_at * 1000 - Date.now()) / (86400 * 1000)))
    : null;

  const unpaidOrders = stat ? stat[0] : 0;
  const pendingTickets = stat ? stat[1] : 0;

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
      <div className="v2-alert-container">
        {/* Telegram 绑定提示 */}
        <div className="v2-alert-bar v2-alert-telegram">
          <div className="v2-alert-left">
            <Send size={16} />
            <span>绑定 Telegram 获取更多服务</span>
          </div>
          <button
            type="button"
            className="v2-alert-action"
            onClick={() => setTelegramModalOpen(true)}
            style={{ background: "transparent", border: 0, color: "inherit" }}
          >
            点击这里进行绑定
          </button>
        </div>

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
      </div>

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
          ) : notices.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {notices.map((item) => (
                <div key={item.id}>
                  <strong style={{ color: "var(--v2-heading)" }}>{item.title}</strong>
                  <div
                    dangerouslySetInnerHTML={{ __html: item.content }}
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
                  已用 {usedGB} GB / 总计 {totalGB} GB
                </strong>
                <div style={{ display: "flex", gap: 10 }}>
                  <Link href="/node" className="btn btn-secondary btn-sm">
                    <Network size={14} />
                    <span>查看节点状态</span>
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setResetTrafficModalOpen(true)}
                  >
                    <RotateCcw size={14} />
                    <span>重置当月流量</span>
                  </button>
                </div>
              </div>
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
        open={resetTrafficModalOpen}
        title="确定重置当前已用流量？"
        content="点击「确定」将会前往购买流量重置包，支付订单后系统将清空您当月已使用流量。"
        okText="确定"
        cancelText="取消"
        onOk={() => {
          setResetTrafficModalOpen(false);
          router.push("/plan");
        }}
        onCancel={() => setResetTrafficModalOpen(false)}
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
          <p style={{ margin: 0 }}>第一步：在 Telegram 中搜索并私聊机器人 <code>@AeraNexaBot</code></p>
          <p style={{ margin: 0 }}>第二步：向机器人发送以下绑定指令：</p>
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
            /bind {user?.telegram_id ? `已绑定ID: ${user.telegram_id}` : (subscribe?.token ? `tg_token_${subscribe.token.slice(0, 10)}` : "请先开通订阅")}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--v2-muted)" }}>
            * 发送成功后机器人将自动同步您的订阅到期提醒与节点变动通知。
          </p>
        </div>
      </Modal>
    </div>
  );
}
