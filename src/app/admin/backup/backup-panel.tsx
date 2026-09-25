"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, Copy, Download, TriangleAlert, Upload } from "lucide-react";
import type { RestoreResult } from "@/lib/server/backup";

const CONFIRM_WORD = "覆盖";

function envLines(result: RestoreResult) {
  return result.envDiff.map((item) => `${item.key}=${item.value}`).join("\n");
}

/** 数据迁移：下载备份 / 上传备份覆盖当前库。 */
export function BackupPanel({ envKeys, logTables }: { envKeys: string[]; logTables: string[] }) {
  const [includeLogs, setIncludeLogs] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [copied, setCopied] = useState(false);

  const restore = async () => {
    if (!file) return;
    setError("");
    setResult(null);
    setRunning(true);
    try {
      const response = await fetch("/api/admin/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: file,
      });
      const body = await response.json().catch(() => ({ error: `恢复失败（HTTP ${response.status}）` }));
      if (!response.ok) throw new Error(body.error ?? "恢复失败");
      setResult(body as RestoreResult);
      setConfirm("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
    } finally {
      setRunning(false);
    }
  };

  const copyEnv = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(envLines(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  };

  const totalRows = result?.tables.reduce((sum, item) => sum + item.rows, 0) ?? 0;

  return (
    <div className="backup-grid">
      <section className="v2-block backup-card">
        <header className="v2-block-header">
          <div>
            <h2><Download size={17} /> 导出备份</h2>
            <p className="admin-audit-note">导出全部业务数据（用户、订单、套餐、节点、卡密、支付渠道、系统设置等）和下列环境变量。登录会话、验证码等临时数据不导出。</p>
          </div>
        </header>
        <div className="backup-body">
          <p className="backup-warning">
            <TriangleAlert size={15} />
            <span>文件<b>不加密</b>，包含全部用户数据和加密主密钥，拿到文件就等于拿到整站。只保存在自己的设备上，迁移完成后删除。</span>
          </p>
          <div>
            <p className="backup-label">一起导出的环境变量（{envKeys.length}）</p>
            {envKeys.length ? (
              <p className="backup-keys">{envKeys.map((key) => <span key={key} className="mono">{key}</span>)}</p>
            ) : <p className="admin-audit-note">当前进程没有设置任何需要迁移的环境变量。</p>}
          </div>
          <label className="backup-check">
            <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />
            <span>包含日志（<span className="mono">{logTables.join("、")}</span>），文件会大很多</span>
          </label>
          <a className="button button-primary backup-action" href={`/api/admin/backup/export${includeLogs ? "?logs=1" : ""}`} download>
            <Download size={15} /> 下载备份
          </a>
        </div>
      </section>

      <section className="v2-block backup-card">
        <header className="v2-block-header">
          <div>
            <h2><Upload size={17} /> 从备份恢复</h2>
            <p className="admin-audit-note">用备份文件<b>覆盖</b>当前数据库：除迁移记录外的所有表会先被清空。请先停止 worker 和 bot，恢复后当前登录会失效，需要用旧站的管理员账号重新登录。</p>
          </div>
        </header>
        <div className="backup-body">
          <label className="v2-field">
            <span>备份文件（.ndjson.gz）</span>
            <input type="file" accept=".gz,application/gzip" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(""); }} />
          </label>
          <label className="v2-field">
            <span>输入「{CONFIRM_WORD}」确认清空当前数据</span>
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder={CONFIRM_WORD} aria-label="确认覆盖" />
          </label>
          <button type="button" className="button button-danger backup-action" disabled={!file || confirm.trim() !== CONFIRM_WORD || running} onClick={restore}>
            <Upload size={15} /> {running ? "恢复中，请勿关闭页面…" : "开始恢复"}
          </button>
          {error ? <p className="admin-error-text backup-error" role="alert"><CircleAlert size={14} /> {error}</p> : null}
        </div>

        {result ? (
          <div className="backup-result">
            <p className="epay-live-result">
              {result.complete ? <span className="v2-badge badge-success">恢复完成</span> : <span className="v2-badge badge-warning">文件不完整</span>}
              <span>{result.tables.length} 张表、{totalRows} 行 · 备份时间 {new Date(result.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
            </p>
            {!result.complete ? <p className="admin-error-text backup-error"><CircleAlert size={14} /> 备份文件末尾缺失，可能下载中断，部分数据可能没有恢复。</p> : null}

            {result.envDiff.length ? (
              <div className="backup-env">
                <p className="backup-warning">
                  <TriangleAlert size={15} />
                  <span>以下 {result.envDiff.length} 个环境变量与本服务器不同或缺失。请把它们设到服务器环境变量（Zeabur 在服务设置 → 环境变量），然后<b>重启 web、worker、bot</b>。不设置的话，3x-ui Token、SMTP、支付密钥将无法解密，已发放的卡密会失效。</span>
                </p>
                <pre className="backup-env-lines mono">{envLines(result)}</pre>
                <button type="button" className="button button-secondary" onClick={copyEnv}><Copy size={15} /> {copied ? "已复制" : "复制为 .env 格式"}</button>
              </div>
            ) : <p className="admin-audit-note backup-note">环境变量与备份一致，无需调整。</p>}

            <details className="backup-tables">
              <summary>各表行数</summary>
              <ul>{result.tables.map((item) => <li key={item.name}><span className="mono">{item.name}</span><b>{item.rows}</b></li>)}</ul>
            </details>
            <Link className="button button-primary backup-action" href="/login">重新登录</Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
