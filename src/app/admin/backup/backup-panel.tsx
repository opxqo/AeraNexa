"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightLeft, CircleAlert, Copy, Download, KeyRound, TriangleAlert, Upload } from "lucide-react";
import type { RestoreResult } from "@/lib/server/backup";
import { createMigrationCodeAction, revokeMigrationCodesAction } from "./actions";

const CONFIRM_WORD = "覆盖";

function envLines(result: RestoreResult) {
  return result.envDiff.map((item) => `${item.key}=${item.value}`).join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 数据迁移：
 * - 在线迁移（推荐）：旧面板生成一次性迁移码，新面板粘贴后直接拉取整站数据；
 * - 文件方式：下载备份文件，再在新面板上传。
 * 两种恢复共用同一个结果区。
 */
export function BackupPanel({ envKeys, logTables, origin, activeCodes }: {
  envKeys: string[];
  logTables: string[];
  origin: string;
  activeCodes: number;
}) {
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [running, setRunning] = useState(false);

  // 所有恢复都走这里：成功时展示结果；失败时把原因交给调用方显示在对应卡片里
  const restore = async (request: () => Promise<Response>): Promise<string | null> => {
    setResult(null);
    setRunning(true);
    try {
      const response = await request();
      const body = await response.json().catch(() => ({ error: `恢复失败（HTTP ${response.status}）` }));
      if (!response.ok) return body.error ?? "恢复失败";
      setResult(body as RestoreResult);
      return null;
    } catch (reason) {
      return reason instanceof Error ? reason.message : "恢复失败";
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h2 className="backup-section-title"><ArrowRightLeft size={16} /> 在线迁移<span className="v2-badge badge-success">推荐</span></h2>
      <div className="backup-grid">
        <MigrationCodeCard origin={origin} activeCodes={activeCodes} logTables={logTables} />
        <RemoteRestoreCard running={running} restore={restore} />
      </div>

      <h2 className="backup-section-title"><Download size={16} /> 文件方式</h2>
      <div className="backup-grid">
        <ExportCard envKeys={envKeys} logTables={logTables} />
        <UploadRestoreCard running={running} restore={restore} />
      </div>

      {result ? <RestoreResultView result={result} /> : null}
    </>
  );
}

/** 旧面板：生成迁移码 */
function MigrationCodeCard({ origin, activeCodes, logTables }: { origin: string; activeCodes: number; logTables: string[] }) {
  const [panelOrigin, setPanelOrigin] = useState(origin);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [active, setActive] = useState(activeCodes);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const generate = () => startTransition(async () => {
    setError(""); setMessage("");
    const outcome = await createMigrationCodeAction(panelOrigin, includeLogs);
    if (!outcome.ok) { setError(outcome.error); return; }
    setCode({ value: outcome.data.code, expiresAt: Date.now() + outcome.data.expiresInSeconds * 1000 });
    setActive(outcome.data.active);
  });

  const revoke = () => startTransition(async () => {
    setError(""); setMessage("");
    const outcome = await revokeMigrationCodesAction();
    if (!outcome.ok) { setError(outcome.error); return; }
    setCode(null); setActive(0);
    setMessage(`已作废 ${outcome.data.revoked} 个未使用的迁移码`);
  });

  const expiresAt = code ? new Date(code.expiresAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section className="v2-block backup-card">
      <header className="v2-block-header">
        <div>
          <h2><KeyRound size={17} /> 在旧面板：生成迁移码</h2>
          <p className="admin-audit-note">新面板凭迁移码直接从本站拉取整站数据，不经过你的电脑。迁移码 30 分钟内有效，只能使用一次。</p>
        </div>
      </header>
      <div className="backup-body">
        <label className="v2-field">
          <span>本站对外地址</span>
          <input value={panelOrigin} onChange={(event) => setPanelOrigin(event.target.value)} placeholder="https://panel.example.com" aria-label="本站对外地址" />
          <small>新面板会连接这个地址，必须是 https。已自动识别，一般不用改。</small>
        </label>
        <label className="backup-check">
          <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />
          <span>包含日志（<span className="mono">{logTables.join("、")}</span>），传输量会大很多</span>
        </label>
        <button type="button" className="button button-primary backup-action" disabled={pending || !panelOrigin.trim()} onClick={generate}>
          <KeyRound size={15} /> 生成迁移码
        </button>
        {code ? (
          <div className="backup-code">
            <textarea className="mono" readOnly rows={3} value={code.value} aria-label="迁移码" onFocus={(event) => event.currentTarget.select()} />
            <div className="backup-code-actions">
              <button type="button" className="button button-secondary" onClick={async () => setMessage(await copyText(code.value) ? "迁移码已复制" : "复制失败，请手动选择复制")}>
                <Copy size={15} /> 复制
              </button>
              <span className="admin-audit-note">{expiresAt} 前有效 · 粘贴到新面板或安装脚本</span>
            </div>
            <p className="backup-warning"><TriangleAlert size={15} /><span>迁移码等同于整站数据的一次性下载权限，只发给自己。</span></p>
          </div>
        ) : null}
        {active > 0 ? (
          <p className="backup-inline-note">
            <span>当前有 {active} 个未使用的迁移码</span>
            <button type="button" className="admin-danger-button" disabled={pending} onClick={revoke}>全部作废</button>
          </p>
        ) : null}
        {message ? <p className="admin-audit-note backup-note">{message}</p> : null}
        {error ? <p className="admin-error-text backup-error" role="alert"><CircleAlert size={14} /> {error}</p> : null}
      </div>
    </section>
  );
}

type RestoreRunner = (request: () => Promise<Response>) => Promise<string | null>;

function ConfirmField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="v2-field">
      <span>输入「{CONFIRM_WORD}」确认清空当前数据</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={CONFIRM_WORD} aria-label="确认覆盖" />
    </label>
  );
}

/** 新面板：粘贴迁移码拉取 */
function RemoteRestoreCard({ running, restore }: { running: boolean; restore: RestoreRunner }) {
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const start = async () => {
    setError("");
    const failure = await restore(() => fetch("/api/admin/backup/restore-remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    }));
    if (failure) setError(failure);
    else { setCode(""); setConfirm(""); }
  };

  return (
    <section className="v2-block backup-card">
      <header className="v2-block-header">
        <div>
          <h2><ArrowRightLeft size={17} /> 在新面板：从旧面板拉取</h2>
          <p className="admin-audit-note">粘贴旧面板生成的迁移码，本站会直接连接旧面板下载并<b>覆盖</b>当前数据库。请先停止本机的 worker 和 bot；新服务器建议直接用安装脚本的「从旧面板迁移」，密钥会自动写好。</p>
        </div>
      </header>
      <div className="backup-body">
        <label className="v2-field">
          <span>迁移码</span>
          <textarea className="mono" rows={3} value={code} onChange={(event) => setCode(event.target.value)} placeholder="anx1.…" aria-label="迁移码" />
        </label>
        <ConfirmField value={confirm} onChange={setConfirm} />
        <button type="button" className="button button-danger backup-action" disabled={!code.trim().startsWith("anx1.") || confirm.trim() !== CONFIRM_WORD || running} onClick={start}>
          <ArrowRightLeft size={15} /> {running ? "迁移中，请勿关闭页面…" : "开始迁移"}
        </button>
        {error ? <p className="admin-error-text backup-error" role="alert"><CircleAlert size={14} /> {error}</p> : null}
      </div>
    </section>
  );
}

function ExportCard({ envKeys, logTables }: { envKeys: string[]; logTables: string[] }) {
  const [includeLogs, setIncludeLogs] = useState(false);
  return (
    <section className="v2-block backup-card">
      <header className="v2-block-header">
        <div>
          <h2><Download size={17} /> 导出备份文件</h2>
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
  );
}

function UploadRestoreCard({ running, restore }: { running: boolean; restore: RestoreRunner }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const start = async () => {
    if (!file) return;
    setError("");
    const failure = await restore(() => fetch("/api/admin/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/gzip" },
      body: file,
    }));
    if (failure) setError(failure);
    else setConfirm("");
  };

  return (
    <section className="v2-block backup-card">
      <header className="v2-block-header">
        <div>
          <h2><Upload size={17} /> 上传备份文件恢复</h2>
          <p className="admin-audit-note">用备份文件<b>覆盖</b>当前数据库：除迁移记录外的所有表会先被清空。请先停止 worker 和 bot，恢复后当前登录会失效，需要用旧站的管理员账号重新登录。</p>
        </div>
      </header>
      <div className="backup-body">
        <label className="v2-field">
          <span>备份文件（.ndjson.gz）</span>
          <input type="file" accept=".gz,application/gzip" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} />
        </label>
        <ConfirmField value={confirm} onChange={setConfirm} />
        <button type="button" className="button button-danger backup-action" disabled={!file || confirm.trim() !== CONFIRM_WORD || running} onClick={start}>
          <Upload size={15} /> {running ? "恢复中，请勿关闭页面…" : "开始恢复"}
        </button>
        {error ? <p className="admin-error-text backup-error" role="alert"><CircleAlert size={14} /> {error}</p> : null}
      </div>
    </section>
  );
}

function RestoreResultView({ result }: { result: RestoreResult }) {
  const [copied, setCopied] = useState(false);
  const totalRows = result.tables.reduce((sum, item) => sum + item.rows, 0);
  return (
    <section className="v2-block backup-result" aria-live="polite">
      <p className="epay-live-result">
        {result.complete ? <span className="v2-badge badge-success">恢复完成</span> : <span className="v2-badge badge-warning">数据不完整</span>}
        <span>{result.tables.length} 张表、{totalRows} 行 · 备份时间 {new Date(result.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
      </p>
      {!result.complete ? <p className="admin-error-text backup-error"><CircleAlert size={14} /> 数据末尾缺失，可能传输中断，部分数据可能没有恢复。建议重新迁移一次。</p> : null}

      {result.envDiff.length ? (
        <div className="backup-env">
          <p className="backup-warning">
            <TriangleAlert size={15} />
            <span>以下 {result.envDiff.length} 个环境变量与本服务器不同或缺失。请把它们设到服务器环境变量（Zeabur 在服务设置 → 环境变量；自建服务器写进 <span className="mono">.env.local</span>），然后<b>重启 web、worker、bot</b>。不设置的话，3x-ui Token、SMTP、支付密钥将无法解密，已发放的卡密会失效。</span>
          </p>
          <pre className="backup-env-lines mono">{envLines(result)}</pre>
          <button type="button" className="button button-secondary" onClick={async () => { setCopied(await copyText(envLines(result))); window.setTimeout(() => setCopied(false), 2000); }}>
            <Copy size={15} /> {copied ? "已复制" : "复制为 .env 格式"}
          </button>
        </div>
      ) : <p className="admin-audit-note backup-note">环境变量与备份一致，无需调整。</p>}

      <details className="backup-tables">
        <summary>各表行数</summary>
        <ul>{result.tables.map((item) => <li key={item.name}><span className="mono">{item.name}</span><b>{item.rows}</b></li>)}</ul>
      </details>
      <Link className="button button-primary backup-action" href="/login">重新登录</Link>
    </section>
  );
}
