"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";
import { ConfirmModal, Modal } from "@/components/v2-modal";

export default function DemoDashboardPage() {
  const router = useRouter();
  const [subscribeDrawerOpen, setSubscribeDrawerOpen] = useState(false);
  const [resetTrafficModalOpen, setResetTrafficModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);

  return (
    <div className="v2-dashboard">
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
        <div className="v2-alert-bar v2-alert-warning">
          <div className="v2-alert-left">
            <AlertTriangle size={16} />
            <span>还有没支付的订单</span>
          </div>
          <Link href="/demo/order/ANX202609190001" className="v2-alert-action">
            立即支付
          </Link>
        </div>

        {/* 正在处理工单提示 */}
        <div className="v2-alert-bar v2-alert-info">
          <div className="v2-alert-left">
            <AlertCircle size={16} />
            <span>1 条工单正在处理中</span>
          </div>
          <Link href="/demo/ticket/1024" className="v2-alert-action">
            立即查看
          </Link>
        </div>
      </div>

      {/* 公告板块 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={18} style={{ color: "var(--v2-primary)" }} />
            <h2>公告 (Demo 模拟)</h2>
          </div>
        </header>
        <div style={{ padding: "18px 20px", fontSize: 14, color: "#495057", lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            欢迎使用 AeraNexa 服务。近期新增多条原生流媒体专线，支持 4K 超高清解锁。如遇到客户端订阅更新失败，请进入「使用文档」查看对应客户端配置或提交技术支持工单。
          </p>
        </div>
      </section>

      {/* 我的订阅 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>我的订阅</h2>
        </header>
        <div className="v2-subscription">
          <h3>标准订阅</h3>
          <p>于 2026/10/19 到期，距离到期还有 30 天。已用流量将在 12 日后重置</p>
          <div className="v2-progress" aria-label="已使用 20% 流量">
            <span style={{ width: "20%" }} />
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
            <strong>已用 20.00 GB / 总计 100.00 GB</strong>
            <div style={{ display: "flex", gap: 10 }}>
              <Link href="/demo/node" className="btn btn-secondary btn-sm">
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
        </div>
      </section>

      {/* 捷径 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>捷径</h2>
        </header>
        <div className="shortcut-list">
          {/* 查看教程 */}
          <Link className="shortcut-row" href="/demo/knowledge">
            <span>
              <strong>查看教程</strong>
              <small>学习如何使用 AeraNexa</small>
            </span>
            <BookOpen size={34} strokeWidth={1.15} aria-hidden="true" />
          </Link>

          {/* 一键订阅（直接呼出一键订阅抽屉） */}
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
          <Link className="shortcut-row" href="/demo/plan">
            <span>
              <strong>续费订阅</strong>
              <small>对您当前的订阅进行购买或续费</small>
            </span>
            <ShoppingBag size={34} strokeWidth={1.15} aria-hidden="true" />
          </Link>

          {/* 遇到问题 */}
          <Link className="shortcut-row" href="/demo/ticket">
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
      />

      {/* 重置流量确认弹窗 */}
      <ConfirmModal
        open={resetTrafficModalOpen}
        title="确定重置当前已用流量？"
        content="点击「确定」将会跳转到收银台，支付订单后系统将会清空您当月已使用流量。"
        okText="确定"
        cancelText="取消"
        onOk={() => {
          setResetTrafficModalOpen(false);
          router.push("/demo/order/ANX202609190001");
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
            /bind tg_token_88ab92e104
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--v2-muted)" }}>
            * 发送成功后机器人将自动同步您的订阅到期提醒与节点变动通知。
          </p>
        </div>
      </Modal>
    </div>
  );
}
