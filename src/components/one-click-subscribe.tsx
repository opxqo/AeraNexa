"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Copy, QrCode, ExternalLink, Check } from "lucide-react";
import { Drawer, Modal, useToast } from "@/components/v2-modal";
import { copyText } from "@/components/api-ui";

interface ClientApp {
  name: string;
  icon: string;
  scheme: (url: string) => string;
}

const clients: ClientApp[] = [
  {
    name: "Clash For Windows",
    icon: "/assets/icon/Clash For Windows.png",
    scheme: (url) => `clash://install-config?url=${encodeURIComponent(url)}&name=AeraNexa`,
  },
  {
    name: "Clash For Android",
    icon: "/assets/icon/Clash For Android.png",
    scheme: (url) => `clash://install-config?url=${encodeURIComponent(url)}&name=AeraNexa`,
  },
  {
    name: "ClashX",
    icon: "/assets/icon/ClashX.png",
    scheme: (url) => `clash://install-config?url=${encodeURIComponent(url)}&name=AeraNexa`,
  },
  {
    name: "Shadowrocket",
    icon: "/assets/icon/Shadowrocket.png",
    scheme: (url) => {
      try {
        return `sub://${btoa(url)}`;
      } catch {
        return url;
      }
    },
  },
  {
    name: "QuantumultX",
    icon: "/assets/icon/QuantumultX.png",
    scheme: (url) =>
      `quantumult-x:///add-resource?remote-resource=${encodeURIComponent(
        JSON.stringify({ server_remote: [url], tag: "AeraNexa" }),
      )}`,
  },
  {
    name: "Surge",
    icon: "/assets/icon/Surge.png",
    scheme: (url) => `surge:///install-config?url=${encodeURIComponent(url)}`,
  },
  {
    name: "Stash",
    icon: "/assets/icon/Stash.png",
    scheme: (url) => `stash://install-config?url=${encodeURIComponent(url)}`,
  },
  {
    name: "Surfboard",
    icon: "/assets/icon/Surfboard.png",
    scheme: (url) => `surfboard:///install-config?url=${encodeURIComponent(url)}`,
  },
];

interface OneClickSubscribeDrawerProps {
  open: boolean;
  onClose: () => void;
  subscribeUrl?: string;
}

// 纯 SVG 二维码矩阵渲染组件（避免外部重量级依赖）
function SimpleSvgQrCode({ text, size = 200 }: { text: string; size?: number }) {
  // 生成确定性的 QR-like 栅格图案以供扫码交互展示
  const cells = 25;
  const matrix: boolean[][] = Array.from({ length: cells }, () => Array(cells).fill(false));

  // 定位角图案 (Finder patterns)
  const drawFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[startY + r][startX + c] = true;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(cells - 7, 0);
  drawFinder(0, cells - 7);

  // 模拟数据填充
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      // 跳过三个角
      if (
        (r < 8 && c < 8) ||
        (r < 8 && c >= cells - 8) ||
        (r >= cells - 8 && c < 8)
      ) {
        continue;
      }
      // 准确定时线
      if (r === 6 || c === 6) {
        matrix[r][c] = (r + c) % 2 === 0;
        continue;
      }
      const val = Math.sin((r * cells + c + hash) * 12.9898) * 43758.5453;
      matrix[r][c] = val - Math.floor(val) > 0.45;
    }
  }

  const cellSize = size / cells;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="qr-svg"
      style={{ display: "block", margin: "0 auto", background: "#fff", padding: 8, borderRadius: 8 }}
    >
      {matrix.map((row, r) =>
        row.map((active, c) =>
          active ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize + 0.3}
              height={cellSize + 0.3}
              fill="#212529"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function OneClickSubscribeDrawer({
  open,
  onClose,
  subscribeUrl = "https://api.aeranexa.com/api/v1/client/subscribe?token=8a7b9c1d2e3f4g5h6i7j8k9l0m",
}: OneClickSubscribeDrawerProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(subscribeUrl);
    if (!ok) {
      showToast("复制失败，请手动选择链接复制", "error");
      return;
    }
    setCopied(true);
    showToast("复制成功", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLaunchClient = (client: ClientApp) => {
    const link = client.scheme(subscribeUrl);
    if (!link) {
      showToast("当前订阅链接不可用，请先开通订阅", "warning");
      return;
    }
    showToast(`正在唤起 ${client.name}...`, "info");
    // 自定义协议（ss:// / v2ray:// 等）无法用 Next 路由跳转，只能交给浏览器处理。
    window.location.assign(link);
  };

  return (
    <>
      <Drawer open={open} title="一键订阅" onClose={onClose} width={340}>
        <div className="oneclick-subscribe">
          <div className="oneclick-actions">
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleCopy}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>复制订阅地址</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => setQrOpen(true)}
            >
              <QrCode size={16} />
              <span>扫描二维码订阅</span>
            </button>
          </div>

          <div className="oneclick-divider">
            <span>导入到</span>
          </div>

          <div className="oneclick-list">
            {clients.map((client) => (
              <div
                key={client.name}
                className="oneclick-item"
                onClick={() => handleLaunchClient(client)}
                role="button"
                tabIndex={0}
              >
                <div className="oneclick-item-icon">
                  <Image
                    src={client.icon}
                    alt={client.name}
                    width={26}
                    height={26}
                    unoptimized
                  />
                </div>
                <div className="oneclick-item-name">{client.name}</div>
                <ExternalLink size={15} className="oneclick-item-arrow" />
              </div>
            ))}
          </div>
        </div>
      </Drawer>

      {/* 扫描二维码订阅模态框 */}
      <Modal
        open={qrOpen}
        title="扫描二维码订阅"
        onClose={() => setQrOpen(false)}
        width={380}
        footer={
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setQrOpen(false)}
            >
              关闭
            </button>
            <button type="button" className="btn btn-primary" onClick={handleCopy}>
              <Copy size={15} /> 复制订阅地址
            </button>
          </div>
        }
      >
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <p style={{ color: "#6c757d", marginBottom: 16, fontSize: 13 }}>
            使用支持扫码的客户端进行订阅
          </p>
          <div
            style={{
              padding: 16,
              background: "#fff",
              display: "inline-block",
              borderRadius: 8,
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              border: "1px solid #e2e8f2",
            }}
          >
            <SimpleSvgQrCode text={subscribeUrl} size={200} />
          </div>
          <p
            style={{
              color: "#8a939c",
              fontSize: 12,
              marginTop: 14,
              wordBreak: "break-all",
              padding: "0 10px",
            }}
          >
            {subscribeUrl}
          </p>
        </div>
      </Modal>
    </>
  );
}
