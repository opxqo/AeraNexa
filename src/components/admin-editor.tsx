"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCheck, ChevronDown, ChevronUp, Download, Loader2, Network, Pencil, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, Upload, XCircle } from "lucide-react";
import type { AdminEditorData, AdminKnowledgeArticle, AdminTicketMessage, EditorAccessGroup } from "@/lib/server/admin-editor";
import {
  deleteAccessGroupAction,
  deleteCouponAction,
  deleteKnowledgeAction,
  deleteNoticeAction,
  disableRechargeCardAction,
  enableRechargeCardAction,
  deleteNodeAction,
  deletePaymentMethodAction,
  deletePlanAction,
  fulfillOrderAction,
  getKnowledgeArticleAction,
  getTicketMessagesAction,
  importInboundsAction,
  replyTicketAction,
  saveSystemSettingsAction,
  testPanelConnectionAction,
  saveAccessGroupAction,
  saveCouponAction,
  saveKnowledgeAction,
  saveNodeAction,
  saveNoticeAction,
  saveOrderAction,
  saveOrderRemarkAction,
  savePaymentMethodAction,
  savePlanAction,
  saveTicketAction,
  saveUserAction,
  saveSmtpSettingsAction,
  testSmtpSettingsAction,
  clearUserDevicesAction,
  createRechargeCardsAction,
  getRechargeCardBatchDetailsAction,
  updateOrderStatusAction,
  refundBalanceOrderAction,
  importReconciliationCsvAction,
  resolveReconciliationRowAction,
  sendSandboxPaymentCallbackAction,
} from "@/app/admin/actions";
import { ConfirmModal, Modal, useToast } from "@/components/v2-modal";
import { AdminListPager, AdminListToolbar } from "@/components/admin-pagination";

type Result = { ok: boolean; message: string };
type FormAction = (data: FormData) => Promise<Result>;

const ORDER_STATUS_LABELS = ["待支付", "开通中", "已取消", "已完成", "已折抵", "已退款"];
/** 订阅曾经开通过的状态：已完成 / 已折抵 / 已退款。用于区分「没记录来源」和「真的没履约」。 */
const FULFILLED_ORDER_STATUSES = new Set([3, 4, 5]);
const ORDER_TYPE_LABELS: Record<number, string> = { 1: "新购", 2: "续费", 3: "升级", 4: "流量重置" };
const PERIOD_LABELS: Record<string, string> = {
  month_price: "月付", quarter_price: "季付", half_year_price: "半年付", year_price: "年付",
  two_year_price: "两年付", three_year_price: "三年付", onetime_price: "一次性", reset_price: "流量重置",
};
const TICKET_LEVELS = ["低", "中", "高"];

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 流量字节数转人类可读单位。
 *
 * 用 1024 进制（与代理面板惯例一致），因此 1 GB 实际指 1 GiB。
 * 小于 1 KB 的值直接返回字节数，避免出现 "0.00 KB" 这种丢失信息又难读的结果。
 */
function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(scaled >= 100 ? 1 : 2)} ${units[unitIndex]}`;
}

/** 与服务端 traffic.ts 的 RECORD_TYPES 保持一致。 */
const RECORD_TYPE_LABELS: Record<string, string> = { hour: "小时", day: "日", month: "月" };

/** 统一的表单提交：调用 Server Action、提示结果、成功后关闭并刷新。 */
function useSubmit() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const submit = useCallback(
    (action: FormAction, form: HTMLFormElement, close: () => void) => {
      startTransition(async () => {
        try {
          const result = await action(new FormData(form));
          showToast(result.message, result.ok ? "success" : "error");
          if (result.ok) {
            close();
            router.refresh();
          }
        } catch {
          showToast("操作失败，请稍后重试", "error");
        }
      });
    },
    [router, showToast],
  );

  return { pending, submit };
}

function EditButton({ onClick, label = "编辑" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="admin-action-button" onClick={onClick}>
      <Pencil size={14} />
      {label}
    </button>
  );
}

function EditorModal({ open, title, onClose, children, width = 600 }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  return <Modal open={open} title={title} onClose={onClose} footer={null} width={width}>{children}</Modal>;
}

function FormFooter({ pending, onClose, submitLabel = "保存更改" }: {
  pending: boolean; onClose: () => void; submitLabel?: string;
}) {
  return (
    <div className="admin-form-footer">
      <button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>取消</button>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {pending ? "保存中…" : submitLabel}
      </button>
    </div>
  );
}

function RoleBadge({ role }: { role: "admin" | "user" }) {
  return (
    <span className={`v2-badge ${role === "admin" ? "admin-role-badge" : "user-role-badge"}`}>
      {role === "admin" ? "管理员" : "普通用户"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 邮件服务
// ---------------------------------------------------------------------------

function MailEditor({ settings }: { settings: Extract<AdminEditorData, { section: "mail" }>['page']['rows'][number] }) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const { pending, submit } = useSubmit();
  const { showToast } = useToast();
  const close = () => setEditing(false);

  const runTest = () => {
    if (!testEmail.trim()) {
      showToast("请先输入测试收件邮箱", "error");
      return;
    }
    setTesting(true);
    const form = new FormData();
    form.set("to", testEmail.trim());
    void testSmtpSettingsAction(form).then((result) => showToast(result.message, result.ok ? "success" : "error")).catch(() => showToast("SMTP 测试失败", "error")).finally(() => setTesting(false));
  };

  return (
    <>
      <section className="v2-block">
        <header className="v2-block-header">
          <div>
            <h2>SMTP 邮件验证码</h2>
            <p className="admin-audit-note">服务关闭时，注册与找回密码都会安全拒绝，不会降级为固定验证码。</p>
          </div>
          <div className="admin-inline-actions">
            <span className={`v2-badge ${settings.enabled ? "badge-success" : "badge-warning"}`}>{settings.enabled ? "服务已启用" : "服务已停用"}</span>
            <EditButton label="配置服务" onClick={() => setEditing(true)} />
          </div>
        </header>
        <div className="table-wrap">
          <table className="v2-table">
            <tbody>
              <tr><th>配置状态</th><td><span className={`v2-badge ${settings.configured ? "badge-success" : "badge-warning"}`}>{settings.configured ? "配置完整" : "待补充"}</span></td><th>加密密钥</th><td><span className={`v2-badge ${settings.encryptionReady ? "badge-success" : "badge-danger"}`}>{settings.encryptionReady ? "就绪" : "服务器缺失"}</span></td></tr>
              <tr><th>SMTP 主机</th><td className="mono">{settings.host || "—"}</td><th>端口 / TLS</th><td>{settings.port || "—"}{settings.port ? ` / ${settings.secure ? "SSL/TLS" : "STARTTLS/明文"}` : ""}</td></tr>
              <tr><th>登录账号</th><td>{settings.username || "—"}</td><th>密码</th><td>{settings.hasPassword ? "已安全保存" : "未配置"}</td></tr>
              <tr><th>发件人</th><td>{settings.fromName || "—"}{settings.fromEmail ? ` <${settings.fromEmail}>` : ""}</td><th>最后更新</th><td>{settings.updatedAt}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="v2-block">
        <header className="v2-block-header"><h2>发送测试邮件</h2></header>
        <div className="admin-inline-form">
          <input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="测试收件邮箱" aria-label="测试收件邮箱" />
          <button type="button" className="button button-secondary" disabled={testing || !settings.configured || !settings.encryptionReady} onClick={runTest}>
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {testing ? "发送中…" : "发送测试邮件"}
          </button>
        </div>
        <p className="admin-audit-note">测试不要求先启用客户服务；配置密码不会显示、返回或写入审计日志。</p>
      </section>

      <EditorModal open={editing} title="配置 SMTP 邮件服务" onClose={close} width={680}>
        <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveSmtpSettingsAction, event.currentTarget, close); }}>
          <label className="v2-field checkbox-field"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} /><span>启用客户邮件验证码服务</span><small>启用前必须填写全部 SMTP 字段，且服务器已配置加密主密钥。</small></label>
          <div className="admin-form-grid">
            <label className="v2-field"><span>SMTP 主机</span><input name="host" defaultValue={settings.host} placeholder="smtp.example.com" maxLength={255} /></label>
            <label className="v2-field"><span>端口</span><input name="port" type="number" min={1} max={65535} defaultValue={settings.port || ""} placeholder="587" /></label>
          </div>
          <label className="v2-field checkbox-field"><input name="secure" type="checkbox" defaultChecked={settings.secure} /><span>使用 SSL/TLS（通常为 465 端口）</span></label>
          <label className="v2-field"><span>SMTP 登录账号</span><input name="username" defaultValue={settings.username} autoComplete="off" maxLength={255} /></label>
          <label className="v2-field"><span>SMTP 密码 / 应用专用密码</span><input name="password" type="password" autoComplete="new-password" placeholder={settings.hasPassword ? "留空则保留当前密码" : "首次配置必填"} maxLength={1000} /><small>仅保存 AES-256-GCM 密文，后台不会再次显示明文。</small></label>
          <div className="admin-form-grid">
            <label className="v2-field"><span>发件人名称</span><input name="fromName" defaultValue={settings.fromName} placeholder="AeraNexa" maxLength={100} /></label>
            <label className="v2-field"><span>发件邮箱</span><input name="fromEmail" type="email" defaultValue={settings.fromEmail} placeholder="no-reply@example.com" maxLength={255} /></label>
          </div>
          <FormFooter pending={pending} onClose={close} submitLabel="保存 SMTP 配置" />
        </form>
      </EditorModal>
    </>
  );
}

/** 危险操作统一走二次确认，避免误删。 */
function DeleteButton({ label, onConfirm, pending, disabled }: {
  label: string; onConfirm: () => void; pending: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="admin-danger-button" onClick={() => setOpen(true)} disabled={disabled || pending}>
        <Trash2 size={14} />删除
      </button>
      <ConfirmModal
        open={open}
        title={`确认删除${label}？`}
        content="删除后不可恢复。若该记录已被业务引用，系统会拒绝删除并建议改为隐藏/停用。"
        okText="确认删除"
        okType="danger"
        onOk={() => { setOpen(false); onConfirm(); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

function UsersEditor({ page }: { page: Extract<AdminEditorData, { section: "users" }>["page"] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null>(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);

  return (
    <>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>用户</th><th>身份</th><th>套餐</th><th>到期时间</th>
                <th>已用 / 额度</th><th>余额</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.nickname}<small>{row.email}</small></td>
                  <td><RoleBadge role={row.role} /></td>
                  <td>{row.planName}</td>
                  <td>{row.expiredAt}</td>
                  <td>{row.usedGb} / {row.transferEnableGb} GB</td>
                  <td>{money(row.balance)}</td>
                  <td>
                    <span className={`v2-badge ${row.isActive ? "badge-success" : "badge-danger"}`}>
                      {row.isActive ? "正常" : "停用"}
                    </span>
                  </td>
                  <td><EditButton onClick={() => setSelected(row)} /></td>
                </tr>
              )) : <tr><td colSpan={8} className="admin-empty">没有匹配的用户</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <EditorModal open={selected !== null} title="编辑用户" onClose={close}>
        {selected ? (
          <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveUserAction, event.currentTarget, close); }}>
            <input name="id" type="hidden" value={selected.id} />
            <label className="v2-field"><span>邮箱（不可修改）</span><input value={selected.email} disabled /></label>
            <label className="v2-field"><span>昵称</span><input name="nickname" defaultValue={selected.nickname} required maxLength={50} /></label>
            <label className="v2-field">
              <span>身份标签</span>
              <select name="role" defaultValue={selected.role}>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <small>管理员可访问 /admin 并执行后台操作；系统始终保留至少一个管理员。</small>
            </label>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>订阅额度（GB）</span>
                <input name="transferEnableGb" type="number" min="0" step="1" defaultValue={selected.transferEnableGb} required />
              </label>
              <label className="v2-field">
                <span>到期日期（留空为长期有效）</span>
                <input name="expiredAt" type="date" defaultValue={toDateInput(selected.expiredAt)} />
              </label>
            </div>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>账户余额（元）</span>
                <input name="balance" type="number" min="0" step="0.01" defaultValue={(selected.balance / 100).toFixed(2)} required />
              </label>
              <label className="v2-field">
                <span>佣金余额（元）</span>
                <input name="commissionBalance" type="number" min="0" step="0.01" defaultValue={(selected.commissionBalance / 100).toFixed(2)} required />
              </label>
            </div>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>设备数（留空跟随套餐，0 不限）</span>
                <input name="deviceLimitOverride" type="number" min="0" max="1000" step="1" defaultValue={selected.deviceLimitOverride ?? ""} placeholder="跟随套餐" />
              </label>
              <div className="v2-field">
                <span>已登记设备（订阅层 HWID）</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong>{selected.deviceCount} 台</strong>
                  <button
                    type="button"
                    className="admin-action-button"
                    disabled={pending || selected.deviceCount === 0}
                    onClick={() => submit(clearUserDevicesAction, buildForm({ id: selected.id }), close)}
                  >
                    清空设备
                  </button>
                </div>
              </div>
            </div>
            <small className="admin-hint">已用流量 {selected.usedGb} GB，由节点 worker 每分钟从 3x-ui 采集累加。</small>
            <label className="admin-check-row">
              <input name="isActive" type="checkbox" defaultChecked={selected.isActive} />
              <span>账户正常启用（取消勾选将禁止登录）</span>
            </label>
            <FormFooter pending={pending} onClose={close} />
          </form>
        ) : null}
      </EditorModal>
    </>
  );
}

/** 后台展示的是本地化日期串，回填到 date 输入框需要 YYYY-MM-DD。 */
function toDateInput(display: string): string {
  if (!display || display === "—" || display === "长期有效") return "";
  const match = display.match(/(\d{4})\/(\d{2})\/(\d{2})/) ?? display.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

// ---------------------------------------------------------------------------
// 套餐
// ---------------------------------------------------------------------------

const PLAN_PRICE_INPUTS = [
  { name: "monthPrice", label: "月付" },
  { name: "quarterPrice", label: "季付" },
  { name: "halfYearPrice", label: "半年付" },
  { name: "yearPrice", label: "年付" },
  { name: "twoYearPrice", label: "两年付" },
  { name: "threeYearPrice", label: "三年付" },
  { name: "onetimePrice", label: "一次性" },
  { name: "resetPrice", label: "流量重置" },
] as const;

function PlansEditor({ page, groups }: { page: Extract<AdminEditorData, { section: "plans" }>["page"]; groups: EditorAccessGroup[] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={() => setSelected("new")}>
          <Plus size={15} />新建套餐
        </button>
      </div>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>套餐</th><th>流量</th><th>限速</th><th>月付</th>
                <th>可售周期</th><th>售卖状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => {
                const periods = PLAN_PRICE_INPUTS
                  .filter((input) => row[input.name] !== null)
                  .map((input) => input.label);
                return (
                  <tr key={row.id}>
                    <td>
                      {row.name}
                      <small>排序 {row.sortOrder} · {row.groupId === null ? "未分配节点" : `权限组：${groups.find((group) => group.id === row.groupId)?.name ?? row.groupId}`}</small>
                    </td>
                    <td>{row.transferEnable} GB</td>
                    <td>
                      {row.speedLimit === null ? "不限速" : `${row.speedLimit} Mbps`}
                      <small>{row.deviceLimit ? `${row.deviceLimit} 台设备` : "设备不限"}</small>
                    </td>
                    <td>{money(row.monthPrice)}</td>
                    <td>{periods.length ? periods.join(" / ") : <span className="admin-muted">未配置</span>}</td>
                    <td>
                      <span className={`v2-badge ${row.isVisible ? "badge-success" : ""}`}>
                        {row.isVisible ? "展示中" : "已隐藏"}
                      </span>
                      {!row.isRenewable ? <span className="v2-badge badge-warning">禁止续费</span> : null}
                    </td>
                    <td className="admin-row-actions">
                      <EditButton onClick={() => setSelected(row)} />
                      <DeleteButton
                        label={`套餐「${row.name}」`}
                        pending={pending}
                        onConfirm={() => submit(deletePlanAction, buildForm({ id: row.id }), () => {})}
                      />
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={7} className="admin-empty">没有匹配的套餐</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <EditorModal open={selected !== null} title={item ? "编辑套餐" : "新建套餐"} onClose={close} width={640}>
        <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(savePlanAction, event.currentTarget, close); }}>
          <input name="id" type="hidden" value={item?.id ?? ""} />
          <div className="admin-form-grid">
            <label className="v2-field"><span>套餐名称</span><input name="name" defaultValue={item?.name ?? ""} required maxLength={255} /></label>
            <label className="v2-field">
              <span>节点权限组（决定可用节点）</span>
              <select name="groupId" defaultValue={item?.groupId ?? ""}>
                <option value="">不分配节点</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}（{group.nodeCount} 个节点）</option>)}
              </select>
            </label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>流量（GB）</span><input name="transferEnable" type="number" min="0" step="1" defaultValue={item?.transferEnable ?? 100} required /></label>
            <label className="v2-field"><span>限速（Mbps，留空不限速）</span><input name="speedLimit" type="number" min="0" step="1" defaultValue={item?.speedLimit ?? ""} /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>人数上限（留空不限）</span><input name="capacityLimit" type="number" min="0" step="1" defaultValue={item?.capacityLimit ?? ""} /></label>
            <label className="v2-field"><span>设备数上限（留空或 0 不限）</span><input name="deviceLimit" type="number" min="0" max="1000" step="1" defaultValue={item?.deviceLimit ?? ""} /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>排序（越小越靠前）</span><input name="sortOrder" type="number" min="0" step="1" defaultValue={item?.sortOrder ?? 0} required /></label>
          </div>

          <fieldset className="admin-fieldset">
            <legend>各付款周期价格（元，留空表示不售卖该周期）</legend>
            <div className="admin-form-grid">
              {PLAN_PRICE_INPUTS.map((input) => (
                <label className="v2-field" key={input.name}>
                  <span>{input.label}</span>
                  <input
                    name={input.name}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="留空"
                    defaultValue={item?.[input.name] === null || item === null || item === undefined ? "" : ((item[input.name] as number) / 100).toFixed(2)}
                  />
                </label>
              ))}
            </div>
            <small className="admin-hint">至少需要配置一个周期，否则套餐无法在前台下单。</small>
          </fieldset>

          <label className="v2-field"><span>套餐说明（可选）</span><textarea name="content" rows={3} maxLength={5000} defaultValue={item?.content ?? ""} /></label>

          <div className="admin-check-list">
            <label className="admin-check-row"><input name="isVisible" type="checkbox" defaultChecked={item?.isVisible ?? true} /><span>前台展示</span></label>
            <label className="admin-check-row"><input name="isRenewable" type="checkbox" defaultChecked={item?.isRenewable ?? true} /><span>允许续费</span></label>
          </div>
          <FormFooter pending={pending} onClose={close} />
        </form>
      </EditorModal>
    </>
  );
}

/** 把普通对象打包成 FormData，供 DeleteButton 这类单字段操作复用提交链路。 */
function buildForm(values: Record<string, string | number>): HTMLFormElement {
  const form = document.createElement("form");
  for (const [key, value] of Object.entries(values)) {
    const input = document.createElement("input");
    input.name = key;
    input.value = String(value);
    form.appendChild(input);
  }
  return form;
}

// ---------------------------------------------------------------------------
// 支付渠道
// ---------------------------------------------------------------------------

function PaymentsEditor({ page }: { page: Extract<AdminEditorData, { section: "payments" }>["page"] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={() => setSelected("new")}>
          <Plus size={15} />新建支付渠道
        </button>
      </div>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>渠道</th><th>Provider</th><th>固定手续费</th><th>比例手续费</th>
                <th>交易笔数</th><th>启用状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="mono">{row.provider}</td>
                  <td>{money(row.handlingFeeFixed)}</td>
                  <td>{row.handlingFeePercent}%</td>
                  <td>{row.transactionCount}</td>
                  <td>
                    <span className={`v2-badge ${row.isEnabled ? "badge-success" : ""}`}>
                      {row.isEnabled ? "已启用" : "已停用"}
                    </span>
                  </td>
                  <td className="admin-row-actions">
                    {row.provider === "balance" ? <span className="admin-muted">系统内置</span> : <>
                      <EditButton onClick={() => setSelected(row)} />
                      <DeleteButton
                        label={`渠道「${row.name}」`}
                        pending={pending}
                        onConfirm={() => submit(deletePaymentMethodAction, buildForm({ id: row.id }), () => {})}
                      />
                    </>}
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="admin-empty">尚未配置支付渠道</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="admin-audit-note">
          <span className="mono">balance</span> 为系统内置零手续费渠道；<span className="mono">mock</span> 用于本地测试，其他 provider 仍待接入真实网关。
        </p>
      </section>

      <EditorModal open={selected !== null} title={item ? "编辑支付渠道" : "新建支付渠道"} onClose={close}>
        <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(savePaymentMethodAction, event.currentTarget, close); }}>
          <input name="id" type="hidden" value={item?.id ?? ""} />
          <div className="admin-form-grid">
            <label className="v2-field"><span>渠道名称</span><input name="name" defaultValue={item?.name ?? ""} required maxLength={255} /></label>
            <label className="v2-field">
              <span>Provider 标识</span>
              <input name="provider" defaultValue={item?.provider ?? "epay"} required pattern="[a-z0-9_-]{2,50}" />
              <small>小写字母、数字、下划线、短横线，用于对接支付适配器。</small>
            </label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>固定手续费（元）</span><input name="handlingFeeFixed" type="number" step="0.01" min="0" defaultValue={item ? (item.handlingFeeFixed / 100).toFixed(2) : "0"} required /></label>
            <label className="v2-field"><span>比例手续费（%）</span><input name="handlingFeePercent" type="number" step="0.01" min="0" max="100" defaultValue={item?.handlingFeePercent ?? 0} required /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>回调域名（可选）</span><input name="notifyDomain" type="url" defaultValue={item?.notifyDomain ?? ""} placeholder="https://example.com" /></label>
            <label className="v2-field"><span>排序</span><input name="sortOrder" type="number" min="0" step="1" defaultValue={item?.sortOrder ?? 0} required /></label>
          </div>
          <label className="v2-field"><span>回调签名密钥（可选）</span><input name="callbackSecret" type="password" autoComplete="new-password" placeholder="留空则保持当前密钥" maxLength={1000} /><small>使用 PAYMENT_CONFIG_ENCRYPTION_KEY 加密保存，后台不会回显。</small></label>
          <label className="admin-check-row"><input name="isEnabled" type="checkbox" defaultChecked={item?.isEnabled ?? true} /><span>启用该渠道</span></label>
          <FormFooter pending={pending} onClose={close} />
        </form>
      </EditorModal>

      <section className="v2-block">
        <header className="v2-block-header"><div><h2>签名回调沙箱</h2><p className="admin-audit-note">仅处理待支付的 mock 交易；会通过与真实网关相同的 HMAC 回调链路履约。</p></div></header>
        <form className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); submit(sendSandboxPaymentCallbackAction, event.currentTarget, () => {}); }}>
          <input name="transactionId" type="number" min="1" required placeholder="待支付 mock 交易编号" aria-label="待支付 mock 交易编号" />
          <button type="submit" className="button button-secondary" disabled={pending}><Send size={15} />投递签名回调</button>
        </form>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

/** 节点权限组管理：新建、重命名、删除。套餐选一个权限组，节点可属于多个权限组。 */
function AccessGroupsModal({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: EditorAccessGroup[] }) {
  const { pending, submit } = useSubmit();
  const keepOpen = () => {};
  return (
    <EditorModal open={open} title="节点权限组" onClose={onClose} width={560}>
      <div className="admin-editor-form">
        <p className="admin-hint">用户能用的节点 = 其套餐所选权限组内、已启用的节点。一个节点可以同时属于多个权限组。</p>
        {groups.length ? groups.map((group) => (
          <form
            key={group.id}
            className="admin-form-grid"
            onSubmit={(event) => { event.preventDefault(); submit(saveAccessGroupAction, event.currentTarget, keepOpen); }}
          >
            <input name="id" type="hidden" value={group.id} />
            <label className="v2-field">
              <span>{group.nodeCount} 个节点 · {group.planCount} 个套餐</span>
              <input name="name" defaultValue={group.name} required maxLength={100} />
            </label>
            <div className="admin-row-actions" style={{ alignSelf: "end" }}>
              <button type="submit" className="admin-action-button" disabled={pending}><Save size={14} />重命名</button>
              <DeleteButton
                label={`权限组「${group.name}」`}
                pending={pending}
                disabled={group.planCount > 0}
                onConfirm={() => submit(deleteAccessGroupAction, buildForm({ id: group.id }), keepOpen)}
              />
            </div>
          </form>
        )) : <p className="admin-muted">还没有权限组。</p>}
        <form
          className="admin-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            submit(saveAccessGroupAction, form, () => form.reset());
          }}
        >
          <label className="v2-field"><span>新建权限组</span><input name="name" required maxLength={100} placeholder="例如：标准线路" /></label>
          <div style={{ alignSelf: "end" }}>
            <button type="submit" className="button button-primary" disabled={pending}><Plus size={15} />新建</button>
          </div>
        </form>
      </div>
    </EditorModal>
  );
}

function NodesEditor({ page, groups }: { page: Extract<AdminEditorData, { section: "nodes" }>["page"]; groups: EditorAccessGroup[] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const { pending, submit } = useSubmit();
  const [importing, startImport] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;
  const locked = Boolean(item?.imported);

  const importFromPanel = () => {
    startImport(async () => {
      try {
        const result = await importInboundsAction();
        showToast(result.message, result.ok ? "success" : "error");
        if (result.ok) router.refresh();
      } catch {
        showToast("同步失败，请稍后重试", "error");
      }
    });
  };

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={importFromPanel} disabled={importing}>
          {importing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {importing ? "同步中…" : "从 3x-ui 同步入站"}
        </button>
        <button type="button" className="button button-secondary" onClick={() => setGroupsOpen(true)}>
          <Network size={15} />权限组（{groups.length}）
        </button>
        <button type="button" className="button button-secondary" onClick={() => setSelected("new")}>
          <Plus size={15} />手动新建
        </button>
      </div>
      <AccessGroupsModal open={groupsOpen} onClose={() => setGroupsOpen(false)} groups={groups} />
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>节点</th><th>协议</th><th>地址</th><th title="节点倍率暂未参与计费">倍率（未生效）</th>
                <th>账号数</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <small>
                      {row.externalPanel}{row.externalInboundId ? ` · 入站 ${row.externalInboundId}` : ""}
                      {" · "}
                      {row.groupIds.length
                        ? groups.filter((group) => row.groupIds.includes(group.id)).map((group) => group.name).join("、")
                        : "未加入权限组"}
                    </small>
                  </td>
                  <td>{row.protocol.toUpperCase()}</td>
                  <td className="mono">{row.host}:{row.port}</td>
                  <td>{row.rate.toFixed(2)}x</td>
                  <td>{row.accountCount}</td>
                  <td>
                    <span className={`v2-badge ${row.isOnline ? "badge-success" : "badge-danger"}`}>
                      {row.isOnline ? "在线" : "离线"}
                    </span>
                    {row.missingSince ? <span className="v2-badge badge-danger" title={`自 ${row.missingSince} 起`}>3x-ui 中已不存在</span> : null}
                    {!row.isEnabled ? <span className="v2-badge">未启用</span> : null}
                    {!row.isVisible ? <span className="v2-badge">已隐藏</span> : null}
                  </td>
                  <td className="admin-row-actions">
                    <EditButton onClick={() => setSelected(row)} />
                    <DeleteButton
                      label={`节点「${row.name}」`}
                      pending={pending}
                      onConfirm={() => submit(deleteNodeAction, buildForm({ id: row.id }), () => {})}
                    />
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="admin-empty">暂无节点，请先在 3x-ui 建好入站，再点「从 3x-ui 同步入站」</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="admin-audit-note">
          入站在 3x-ui 中创建，同步后以「未启用、隐藏」导入；填好对外地址并启用后才会分配给用户。同步只读取 3x-ui，不会修改面板。
        </p>
      </section>

      <EditorModal open={selected !== null} title={item ? "编辑节点" : "新建节点"} onClose={close} width={640}>
        <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveNodeAction, event.currentTarget, close); }}>
          <input name="id" type="hidden" value={item?.id ?? ""} />
          <div className="admin-form-grid">
            <label className="v2-field"><span>节点名称</span><input name="name" defaultValue={item?.name ?? ""} required maxLength={255} /></label>
            <label className="v2-field"><span>协议{locked ? "（以 3x-ui 为准）" : ""}</span><input name="protocol" defaultValue={item?.protocol ?? "vless"} required pattern="[a-z0-9_-]{2,32}" readOnly={locked} /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>对外主机 / 域名</span><input name="host" defaultValue={item?.host ?? ""} required maxLength={255} /></label>
            <label className="v2-field"><span>对外端口</span><input name="port" type="number" min="1" max="65535" defaultValue={item?.port ?? 443} required /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>服务端口{locked ? "（以 3x-ui 为准）" : "（留空同端口）"}</span><input name="serverPort" type="number" min="1" max="65535" defaultValue={item?.serverPort ?? ""} readOnly={locked} /></label>
            <label className="v2-field"><span>倍率（暂未参与计费）</span><input name="rate" type="number" min="0.01" max="100" step="0.01" defaultValue={item?.rate ?? 1} required /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>来源面板</span><input name="externalPanel" defaultValue={item?.externalPanel ?? "3x-ui"} maxLength={50} readOnly={locked} /></label>
            <label className="v2-field"><span>入站 ID{locked ? "" : "（可选）"}</span><input name="externalInboundId" defaultValue={item?.externalInboundId ?? ""} maxLength={128} readOnly={locked} /></label>
          </div>
          <div className="admin-form-grid">
            <label className="v2-field"><span>标签（逗号分隔）</span><input name="tags" defaultValue="" placeholder="香港, 流媒体" maxLength={255} /></label>
            <label className="v2-field"><span>排序</span><input name="sortOrder" type="number" min="0" step="1" defaultValue={item?.sortOrder ?? 0} required /></label>
          </div>
          <fieldset className="admin-fieldset">
            <legend>所属权限组</legend>
            {groups.length ? (
              <div className="admin-check-list">
                {groups.map((group) => (
                  <label className="admin-check-row" key={group.id}>
                    <input name="groupIds" type="checkbox" value={group.id} defaultChecked={item?.groupIds.includes(group.id) ?? false} />
                    <span>{group.name}</span>
                  </label>
                ))}
              </div>
            ) : <small className="admin-hint">还没有权限组，请先在「权限组」中新建。</small>}
          </fieldset>
          <div className="admin-check-list">
            <label className="admin-check-row"><input name="isEnabled" type="checkbox" defaultChecked={item?.isEnabled ?? true} /><span>启用（分配给有权限的用户）</span></label>
            <label className="admin-check-row"><input name="isVisible" type="checkbox" defaultChecked={item?.isVisible ?? true} /><span>前台展示</span></label>
            <label className="admin-check-row"><input name="isOnline" type="checkbox" defaultChecked={item?.isOnline ?? true} /><span>标记为在线</span></label>
          </div>
          <FormFooter pending={pending} onClose={close} />
        </form>
      </EditorModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

function TicketsEditor({ page }: { page: Extract<AdminEditorData, { section: "tickets" }>["page"] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null>(null);
  const [thread, setThread] = useState<AdminTicketMessage[] | null>(null);
  const [threadError, setThreadError] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const { pending, submit } = useSubmit();
  const router = useRouter();
  const { showToast } = useToast();

  const openTicket = async (row: (typeof page.rows)[number]) => {
    setSelected(row);
    setThread(null);
    setThreadError("");
    setReply("");
    setLoadingThread(true);
    try {
      const detail = await getTicketMessagesAction(row.id);
      setThread(detail.messages);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : "会话加载失败");
    } finally {
      setLoadingThread(false);
    }
  };

  const close = () => { setSelected(null); setThread(null); setReply(""); };

  const sendReply = async () => {
    if (!selected) return;
    const message = reply.trim();
    if (!message) { showToast("回复内容不能为空", "error"); return; }
    setSending(true);
    try {
      const form = new FormData();
      form.set("id", String(selected.id));
      form.set("message", message);
      const result = await replyTicketAction(form);
      showToast(result.message, result.ok ? "success" : "error");
      if (result.ok) {
        setReply("");
        const detail = await getTicketMessagesAction(selected.id);
        setThread(detail.messages);
        router.refresh();
      }
    } catch {
      showToast("回复失败，请稍后重试", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>主题</th><th>用户</th><th>优先级</th><th>回复</th>
                <th>状态</th><th>消息数</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.subject}<small>{row.lastMessage}</small></td>
                  <td>{row.email}</td>
                  <td>{TICKET_LEVELS[row.level] ?? "中"}</td>
                  <td>
                    <span className={`v2-badge ${row.replyStatus ? "badge-success" : "badge-warning"}`}>
                      {row.replyStatus ? "已回复" : "待回复"}
                    </span>
                  </td>
                  <td>
                    <span className={`v2-badge ${row.status ? "" : "badge-warning"}`}>
                      {row.status ? "已关闭" : "处理中"}
                    </span>
                  </td>
                  <td>{row.messageCount}</td>
                  <td>{row.updatedAt}</td>
                  <td className="admin-row-actions">
                    <EditButton label="处理" onClick={() => { void openTicket(row); }} />
                  </td>
                </tr>
              )) : <tr><td colSpan={8} className="admin-empty">暂无工单</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <EditorModal open={selected !== null} title="处理工单" onClose={close} width={720}>
        {selected ? (
          <div className="admin-ticket-panel">
            <label className="v2-field"><span>工单主题</span><input value={selected.subject} disabled /></label>

            <div className="admin-ticket-thread">
              {loadingThread ? (
                <div className="admin-empty"><Loader2 size={16} className="animate-spin" /> 正在加载会话…</div>
              ) : threadError ? (
                <div className="admin-empty admin-error-text">{threadError}</div>
              ) : thread && thread.length ? thread.map((message) => (
                <article key={message.id} className={`admin-ticket-message ${message.senderRole === "staff" ? "from-staff" : "from-user"}`}>
                  <header>
                    <span>{message.senderRole === "staff" ? "客服" : "用户"}</span>
                    <time>{message.createdAt}</time>
                  </header>
                  <p>{message.message}</p>
                </article>
              )) : <div className="admin-empty">该工单暂无消息</div>}
            </div>

            <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveTicketAction, event.currentTarget, () => {}); }}>
              <input name="id" type="hidden" value={selected.id} />
              <div className="admin-form-grid">
                <label className="v2-field">
                  <span>优先级</span>
                  <select name="level" defaultValue={selected.level}>
                    <option value="0">低</option><option value="1">中</option><option value="2">高</option>
                  </select>
                </label>
                <label className="v2-field">
                  <span>处理状态</span>
                  <select name="status" defaultValue={selected.status}>
                    <option value="0">处理中</option><option value="1">关闭工单</option>
                  </select>
                </label>
              </div>
              <div className="admin-form-footer">
                <button type="button" className="button button-secondary" onClick={close} disabled={pending}>关闭面板</button>
                <button type="submit" className="button button-primary" disabled={pending}>
                  {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  保存状态
                </button>
              </div>
            </form>

            <div className="admin-ticket-reply">
              <label className="v2-field">
                <span>回复用户</span>
                <textarea
                  rows={3}
                  maxLength={10000}
                  value={reply}
                  placeholder={selected.status ? "工单已关闭，请先恢复为「处理中」再回复" : "输入回复内容…"}
                  onChange={(event) => setReply(event.target.value)}
                  disabled={Boolean(selected.status) || sending}
                />
              </label>
              <button
                type="button"
                className="button button-primary"
                onClick={() => { void sendReply(); }}
                disabled={Boolean(selected.status) || sending || !reply.trim()}
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                发送回复
              </button>
            </div>
          </div>
        ) : null}
      </EditorModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// 订单
// ---------------------------------------------------------------------------

type OrderRow = Extract<AdminEditorData, { section: "orders" }>["page"]["rows"][number];
type OrderPlanOption = Extract<AdminEditorData, { section: "orders" }>["plans"][number];

/** 履约来源徽标：人工补单必须一眼可辨，避免与真实网关收款混淆。 */
/**
 * 履约来源。
 *
 * `fulfillment_source` 是迁移里后加的列，加列之前就流转完的订单是 NULL。
 * 那不是「尚未履约」，而是「开通过了，但没记录是谁开的」——一律显示成「—」
 * 会让管理员把早已开通的早期订单误判成没开通，甚至重复补单。
 * 所以按订单状态区分：确实开通过的显示为「早期订单」，其余才是「—」。
 */
function FulfillmentBadge({ source, fulfilled }: { source: string | null; fulfilled: boolean }) {
  if (source === "gateway") return <span className="v2-badge badge-success">网关回调</span>;
  if (source === "admin") return <span className="v2-badge admin-role-badge">人工补单</span>;
  if (fulfilled) {
    return (
      <span className="v2-badge" title="订阅已开通，但早于记录履约来源的迁移，来源无从追溯">
        早期订单
      </span>
    );
  }
  return <span className="admin-muted">—</span>;
}

function OrdersEditor({ page, plans }: {
  page: Extract<AdminEditorData, { section: "orders" }>["page"];
  plans: OrderPlanOption[];
}) {
  const { pending, submit } = useSubmit();
  const [mode, setMode] = useState<null | "edit" | "fulfill" | "remark" | "refund">(null);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [planId, setPlanId] = useState(0);
  const [period, setPeriod] = useState("");

  const close = () => {
    setMode(null);
    setSelected(null);
  };

  const openEdit = (row: OrderRow) => {
    setSelected(row);
    setPlanId(row.planId);
    setPeriod(row.period);
    setMode("edit");
  };

  const openFulfill = (row: OrderRow) => {
    setSelected(row);
    setMode("fulfill");
  };

  const openRemark = (row: OrderRow) => {
    setSelected(row);
    setMode("remark");
  };
  const openRefund = (row: OrderRow) => { setSelected(row); setMode("refund"); };

  const activePlan = plans.find((plan) => plan.id === planId);
  const periodOptions = activePlan?.periods ?? [];

  /** 换套餐后若当前周期在新套餐不可售，自动落到第一个可售周期，避免提交必然失败的组合。 */
  const handlePlanChange = (nextPlanId: number) => {
    setPlanId(nextPlanId);
    const nextPeriods = plans.find((plan) => plan.id === nextPlanId)?.periods ?? [];
    if (!nextPeriods.includes(period)) setPeriod(nextPeriods[0] ?? "");
  };

  return (
    <section className="v2-block">
      <div className="table-wrap">
        <table className="v2-table">
          <thead>
            <tr>
              <th>订单号</th><th>用户</th><th>套餐</th><th>类型</th>
              <th>周期</th><th>原价</th><th>应付</th><th>状态</th><th>履约</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length ? page.rows.map((row) => (
              <tr key={row.id}>
                <td className="mono">
                  {row.tradeNo}
                  <small>{row.createdAt}</small>
                  {row.adminRemark ? <small className="admin-order-remark">备注：{row.adminRemark}</small> : null}
                </td>
                <td>{row.email}</td>
                <td>{row.planName}</td>
                <td>{ORDER_TYPE_LABELS[row.orderType] ?? "新购"}</td>
                <td>{PERIOD_LABELS[row.period] ?? row.period}</td>
                <td>{money(row.subtotalAmount)}</td>
                <td>
                  {money(row.totalAmount)}
                  {row.discountAmount > 0 ? <small>已优惠 {money(row.discountAmount)}</small> : null}
                </td>
                <td>
                  <span className={`v2-badge ${row.status === 3 ? "badge-success" : row.status === 0 ? "badge-warning" : ""}`}>
                    {ORDER_STATUS_LABELS[row.status] ?? "未知"}
                  </span>
                  {row.refunded ? <small><span className="v2-badge badge-warning">已退款</span></small> : null}
                </td>
                <td><FulfillmentBadge source={row.fulfillmentSource} fulfilled={FULFILLED_ORDER_STATUSES.has(row.status)} /></td>
                <td>
                  <div className="admin-row-actions">
                    {row.status === 0 ? (
                      <>
                        <button type="button" className="admin-action-button" onClick={() => openEdit(row)} disabled={pending}>
                          <Pencil size={14} />改单
                        </button>
                        <button type="button" className="admin-action-button" onClick={() => openFulfill(row)} disabled={pending}>
                          <CheckCheck size={14} />补单
                        </button>
                        <form onSubmit={(event) => { event.preventDefault(); submit(updateOrderStatusAction, event.currentTarget, () => {}); }}>
                          <input name="id" type="hidden" value={row.id} />
                          <input name="status" type="hidden" value="2" />
                          <button type="submit" className="admin-action-button" disabled={pending}>
                            <XCircle size={14} />取消订单
                          </button>
                        </form>
                      </>
                    ) : null}

                    {row.status === 2 ? (
                      <>
                        <form onSubmit={(event) => { event.preventDefault(); submit(updateOrderStatusAction, event.currentTarget, () => {}); }}>
                          <input name="id" type="hidden" value={row.id} />
                          <input name="status" type="hidden" value="0" />
                          <button type="submit" className="admin-action-button" disabled={pending}>
                            <RotateCcw size={14} />恢复待支付
                          </button>
                        </form>
                        <button type="button" className="admin-action-button" onClick={() => openRemark(row)} disabled={pending}>
                          <Pencil size={14} />备注
                        </button>
                      </>
                    ) : null}

                    {row.status !== 0 && row.status !== 2 ? (
                      <>
                        <button type="button" className="admin-action-button" onClick={() => openRemark(row)} disabled={pending}>
                          <Pencil size={14} />备注
                        </button>
                        {row.status === 3 && row.paymentProvider === "balance" && !row.refunded ? <button type="button" className="admin-action-button" onClick={() => openRefund(row)} disabled={pending}><RotateCcw size={14} />退款</button> : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={10} className="admin-empty">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="admin-audit-note">
        待支付订单可改套餐与周期，金额按与用户下单同一套价格链重算。已支付订单的金额是对账依据，不可修改。
        线下转账、回调丢失等场景可用「补单」开通，补单必须填写原因，并会在订单上标记为人工履约以区别于网关回调。
      </p>

      <EditorModal open={mode === "edit"} title="修改订单" onClose={close} width={640}>
        {selected ? (
          <form
            key={selected.id}
            className="admin-editor-form"
            onSubmit={(event) => { event.preventDefault(); submit(saveOrderAction, event.currentTarget, close); }}
          >
            <input name="id" type="hidden" value={selected.id} />
            <div className="admin-readonly-row">
              <span>订单号 <code>{selected.tradeNo}</code></span>
              <span>用户 <code>{selected.email}</code></span>
            </div>

            <label className="v2-field">
              <span>套餐</span>
              <select name="planId" value={planId} onChange={(event) => handlePlanChange(Number(event.target.value))} required>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </label>

            <label className="v2-field">
              <span>付款周期</span>
              <select name="period" value={period} onChange={(event) => setPeriod(event.target.value)} required>
                {periodOptions.map((option) => (
                  <option key={option} value={option}>{PERIOD_LABELS[option] ?? option}</option>
                ))}
              </select>
            </label>
            {periodOptions.length === 0 ? (
              <small className="admin-hint">该套餐未配置任何可售周期，请先在套餐管理里补价格。</small>
            ) : null}

            <label className="v2-field">
              <span>优惠码（留空表示不使用）</span>
              <input name="couponCode" defaultValue={selected.couponCode} maxLength={64} placeholder="留空不使用优惠券" />
            </label>
            <small className="admin-hint">
              改单会按新参数重新校验优惠券并重算金额；若原券已失效或不再适用于新套餐，请清空此项再保存。
            </small>

            <FormFooter pending={pending} onClose={close} submitLabel="保存并重算金额" />
          </form>
        ) : null}
      </EditorModal>

      <EditorModal open={mode === "fulfill"} title="人工补单" onClose={close} width={560}>
        {selected ? (
          <form
            key={selected.id}
            className="admin-editor-form"
            onSubmit={(event) => { event.preventDefault(); submit(fulfillOrderAction, event.currentTarget, close); }}
          >
            <input name="id" type="hidden" value={selected.id} />
            <div className="admin-readonly-row">
              <span>订单号 <code>{selected.tradeNo}</code></span>
              <span>应付 <code>{money(selected.totalAmount)}</code></span>
            </div>
            <p className="admin-warn-note">
              补单会立即开通订阅，并把该订单标记为「人工补单」。请确认款项确实已收到（线下转账、现金等），
              否则会造成未收款先开通。此操作会写入审计日志。
            </p>
            <label className="v2-field">
              <span>补单原因（必填，便于事后对账）</span>
              <textarea name="reason" rows={3} maxLength={500} required placeholder="例如：客户微信转账，流水号 XXX，财务已确认" />
            </label>
            <FormFooter pending={pending} onClose={close} submitLabel="确认补单并开通" />
          </form>
        ) : null}
      </EditorModal>

      <EditorModal open={mode === "remark"} title="订单备注" onClose={close} width={560}>
        {selected ? (
          <form
            key={selected.id}
            className="admin-editor-form"
            onSubmit={(event) => { event.preventDefault(); submit(saveOrderRemarkAction, event.currentTarget, close); }}
          >
            <input name="id" type="hidden" value={selected.id} />
            <label className="v2-field">
              <span>内部备注（仅后台可见）</span>
              <textarea name="remark" rows={4} maxLength={500} defaultValue={selected.adminRemark} placeholder="留空表示清空备注" />
            </label>
            <FormFooter pending={pending} onClose={close} submitLabel="保存备注" />
          </form>
        ) : null}
      </EditorModal>
      <EditorModal open={mode === "refund"} title="余额退款" onClose={close} width={560}>
        {selected ? <form key={selected.id} className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(refundBalanceOrderAction, event.currentTarget, close); }}>
          <input name="orderId" type="hidden" value={selected.id} />
          <div className="admin-readonly-row"><span>订单号 <code>{selected.tradeNo}</code></span><span>退款金额 <code>{money(selected.totalAmount)}</code></span></div>
          <p className="admin-warn-note">退款将全额退回用户站内余额，已开通订阅权益保持不变。每笔余额交易只能退款一次。</p>
          <label className="v2-field"><span>退款原因（必填）</span><textarea name="reason" required rows={4} maxLength={500} placeholder="例如：重复付款，已核实" /></label>
          <label className="admin-check-row"><input name="confirmed" type="checkbox" required /><span>我已确认：该退款不可撤销，且不会回滚套餐权益</span></label>
          <FormFooter pending={pending} onClose={close} submitLabel="确认全额退回余额" />
        </form> : null}
      </EditorModal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 优惠券
// ---------------------------------------------------------------------------

/** 与后端 discount_type 对应：1 = 固定金额（元），2 = 百分比。 */
const COUPON_TYPES = [
  { value: 1, label: "固定金额抵扣（元）" },
  { value: 2, label: "百分比折扣（%）" },
];

/** 表单里用「逗号分隔的套餐 ID / 周期」表达 json 数组，留空表示不限。 */
function CouponsEditor({
  page,
  plans,
}: {
  page: Extract<AdminEditorData, { section: "coupons" }>["page"];
  plans: Array<{ id: number; name: string }>;
}) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;

  const [planIds, setPlanIds] = useState<string[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);

  const openEditor = (row: (typeof page.rows)[number] | "new") => {
    setSelected(row);
    if (row === "new") {
      setPlanIds([]);
      setPeriods([]);
    } else {
      setPlanIds((row.planIds ?? []).map(String));
      setPeriods(row.periods ?? []);
    }
  };

  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  };

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={() => openEditor("new")}>
          <Plus size={15} />新建优惠券
        </button>
      </div>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>优惠码</th><th>名称</th><th>折扣</th><th>适用范围</th>
                <th>核销 / 发行</th><th>有效期</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => {
                const unlimited = row.maxUses === null;
                const exhausted = !unlimited && row.usedCount >= (row.maxUses ?? 0);
                return (
                  <tr key={row.id}>
                    <td className="mono">{row.code}<small>{row.createdAt}</small></td>
                    <td>{row.name}</td>
                    <td>{row.discountType === 2 ? `${row.discountValue}%` : money(row.discountValue)}</td>
                    <td>
                      {row.planIds ? `${row.planIds.length} 个套餐` : "全部套餐"}
                      <small>{row.periods ? row.periods.map((period) => PERIOD_LABELS[period] ?? period).join("、") : "全部周期"}</small>
                    </td>
                    <td>
                      {row.usedCount} / {unlimited ? "不限" : row.maxUses}
                      {row.maxUsesPerUser !== null ? <small>每人限 {row.maxUsesPerUser} 次</small> : null}
                    </td>
                    <td>
                      {row.startsAt}
                      <small>至 {row.endsAt}</small>
                    </td>
                    <td>
                      <span className={`v2-badge ${!row.isActive ? "badge-danger" : exhausted ? "badge-warning" : "badge-success"}`}>
                        {!row.isActive ? "已停用" : exhausted ? "已领完" : "生效中"}
                      </span>
                      {!row.isVisible ? <small>前台不可见</small> : null}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <EditButton onClick={() => openEditor(row)} />
                        <DeleteButton
                          label={`优惠券 ${row.code}`}
                          pending={pending}
                          disabled={row.usedCount > 0}
                          onConfirm={() => submit(deleteCouponAction, buildForm({ id: row.id }), () => {})}
                        />
                      </div>
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={8} className="admin-empty">暂无优惠券</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="admin-audit-note">
          核销次数以 coupon_usages 记录为准，不可手工改写。已有核销记录的优惠券不能删除，请改为「停用」。
        </p>
      </section>

      <EditorModal open={selected !== null} title={item ? `编辑优惠券 · ${item.code}` : "新建优惠券"} onClose={close} width={680}>
        {selected !== null ? (
          <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveCouponAction, event.currentTarget, close); }}>
            {item ? <input name="id" type="hidden" value={item.id} /> : null}
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>优惠码</span>
                <input
                  name="code"
                  defaultValue={item?.code ?? ""}
                  required
                  maxLength={64}
                  placeholder="例如 SUMMER2026"
                  style={{ textTransform: "uppercase" }}
                />
                <small>3-64 位大写字母、数字、下划线或连字符。</small>
              </label>
              <label className="v2-field">
                <span>名称（仅后台可见）</span>
                <input name="name" defaultValue={item?.name ?? ""} required maxLength={255} placeholder="例如 夏季促销 5 元券" />
              </label>
            </div>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>折扣类型</span>
                <select name="discountType" defaultValue={item?.discountType ?? 1}>
                  {COUPON_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </label>
              <label className="v2-field">
                <span>折扣值</span>
                <input
                  name="discountValue"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={item?.discountValue ?? ""}
                  required
                  placeholder="固定金额填「分」，百分比填 1-100"
                />
                <small>固定金额单位为「分」（500 = ¥5.00）；百分比填 1-100。</small>
              </label>
            </div>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>总发行量（留空为不限）</span>
                <input name="maxUses" type="number" min="1" step="1" defaultValue={item?.maxUses ?? ""} />
              </label>
              <label className="v2-field">
                <span>每人限用次数（留空为不限）</span>
                <input name="maxUsesPerUser" type="number" min="1" step="1" defaultValue={item?.maxUsesPerUser ?? ""} />
              </label>
            </div>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>开始日期（留空立即生效）</span>
                <input name="startsAt" type="date" defaultValue={item?.startsAtInput ?? ""} />
              </label>
              <label className="v2-field">
                <span>结束日期（留空长期有效）</span>
                <input name="endsAt" type="date" defaultValue={item?.endsAtInput ?? ""} />
              </label>
            </div>

            <fieldset className="admin-fieldset">
              <legend>适用套餐</legend>
              <div className="admin-check-list">
                {plans.map((plan) => (
                  <label key={plan.id} className="admin-check-row">
                    <input
                      type="checkbox"
                      checked={planIds.includes(String(plan.id))}
                      onChange={() => toggle(planIds, String(plan.id), setPlanIds)}
                    />
                    <span>{plan.name}</span>
                  </label>
                ))}
              </div>
              <input name="planIds" type="hidden" value={planIds.join(",")} />
              <small className="admin-form-help">全部不勾选表示该券适用于所有套餐。</small>
            </fieldset>

            <fieldset className="admin-fieldset">
              <legend>适用付款周期</legend>
              <div className="admin-check-list">
                {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                  <label key={key} className="admin-check-row">
                    <input
                      type="checkbox"
                      checked={periods.includes(key)}
                      onChange={() => toggle(periods, key, setPeriods)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <input name="periods" type="hidden" value={periods.join(",")} />
              <small className="admin-form-help">全部不勾选表示该券适用于所有付款周期。</small>
            </fieldset>

            <label className="admin-check-row">
              <input name="isActive" type="checkbox" defaultChecked={item ? item.isActive : true} />
              <span>启用该优惠券（取消勾选后无法再被使用）</span>
            </label>
            <label className="admin-check-row">
              <input name="isVisible" type="checkbox" defaultChecked={item ? item.isVisible : true} />
              <span>在前台可见</span>
            </label>

            <FormFooter pending={pending} onClose={close} />
          </form>
        ) : null}
      </EditorModal>
    </>
  );
}

function downloadCards(batchNo: string, amount: number, cards: string[]) {
  const csv = ["batch_no,amount_yuan,code", ...cards.map((card) => `${batchNo},${(amount / 100).toFixed(2)},${card}`)].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `aeranexa-recharge-cards-${batchNo}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function RechargeCardsEditor({ page, q }: { page: Extract<AdminEditorData, { section: "recharge-cards" }>["page"]; q: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [generating, startGenerating] = useTransition();
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getRechargeCardBatchDetailsAction>> | null>(null);
  const [detailError, setDetailError] = useState("");
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [requestedBatchId, setRequestedBatchId] = useState<number | null>(null);
  const [detailsPending, startDetails] = useTransition();
  const detailsPanelRef = useRef<HTMLElement>(null);
  const { showToast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (activeBatchId === null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => detailsPanelRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" }));
  }, [activeBatchId]);

  const createBatch = (form: HTMLFormElement) => {
    startGenerating(async () => {
      const result = await createRechargeCardsAction(new FormData(form));
      showToast(result.message, result.ok ? "success" : "error");
      if (result.ok && result.cards && result.batchNo && result.amount !== undefined) {
        downloadCards(result.batchNo, result.amount, result.cards);
        setCreateOpen(false);
        window.location.reload();
      }
    });
  };

  const loadBatchDetails = (batchId: number, detailPage = 1) => {
    setActiveBatchId(batchId);
    setRequestedBatchId(batchId);
    if (details?.batch.id !== batchId) setDetails(null);
    startDetails(async () => {
      try {
        setDetailError("");
        setDetails(await getRechargeCardBatchDetailsAction(batchId, detailPage));
      } catch {
        setDetailError("卡密明细加载失败，请稍后重试");
      } finally {
        setRequestedBatchId(null);
      }
    });
  };

  const toggleBatchDetails = (batchId: number) => {
    if (activeBatchId === batchId && details) {
      setActiveBatchId(null);
      setDetails(null);
      setDetailError("");
      return;
    }
    loadBatchDetails(batchId);
  };

  const updateCardStatus = (action: FormAction, cardId: number) => {
    startDetails(async () => {
      try {
        const result = await action(new FormData(buildForm({ id: cardId })));
        showToast(result.message, result.ok ? "success" : "error");
        if (result.ok && details) {
          loadBatchDetails(details.batch.id, details.page.page);
          router.refresh();
        }
      } catch {
        showToast("操作失败，请稍后重试", "error");
      }
    });
  };

  return <>
    <div className="admin-section-actions">
      <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />批量生成卡密</button>
    </div>
    <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
          <thead><tr><th>批次</th><th>面额</th><th>发放数量</th><th>状态统计</th><th>有效期</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>{page.rows.length ? page.rows.map((row) => {
            const expanded = activeBatchId === row.id;
            const loading = requestedBatchId === row.id && detailsPending;
            return (
            <tr key={row.id} className={expanded ? "recharge-batch-row is-active" : "recharge-batch-row"}>
              <td><span className="mono">{row.batchNo}</span><small>{row.name}</small></td>
              <td>{money(row.amount)}</td><td>{row.totalCount} / {row.quantity}</td>
              <td><div className="recharge-status-strip"><span className="v2-badge badge-success">未使用 {row.unusedCount}</span><span className="v2-badge badge-warning">已停用 {row.disabledCount}</span><span className="v2-badge">已兑换 {row.redeemedCount}</span></div></td>
              <td>{row.expiresAt}</td><td>{row.createdAt}</td>
              <td><button type="button" className={expanded ? "admin-action-button is-active" : "admin-action-button"} disabled={loading} aria-expanded={expanded} aria-controls="recharge-card-details" onClick={() => toggleBatchDetails(row.id)}>{loading ? <Loader2 size={14} className="animate-spin" /> : expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{loading ? "加载中" : expanded ? "收起卡密" : "查看卡密"}</button></td>
            </tr>
          );}) : <tr><td colSpan={7} className="admin-empty">暂无卡密批次</td></tr>}</tbody>
        </table>
      </div>
      <p className="admin-audit-note">明文卡密仅在生成时写入浏览器下载的 CSV；系统后续只显示尾号，无法找回完整卡密。</p>
    </section>
    <AdminListPager section="recharge-cards" q={q} page={page.page} pageSize={page.pageSize} total={page.total} />
    {activeBatchId !== null ? <section ref={detailsPanelRef} id="recharge-card-details" className="v2-block recharge-detail-panel" aria-busy={detailsPending}>
      <div className="recharge-detail-header">
        <div className="recharge-detail-heading"><span className="recharge-detail-eyebrow">批次明细</span><strong>{details?.batch.name ?? "正在读取卡密…"}</strong>{details ? <span className="mono">{details.batch.batchNo}</span> : null}</div>
        <div className="recharge-detail-meta">{details ? <><span>共 {details.page.total} 张</span><span>每页 {details.page.pageSize} 张</span></> : null}<button type="button" className="admin-action-button" onClick={() => { setActiveBatchId(null); setDetails(null); setDetailError(""); }}><ChevronUp size={14} />收起</button></div>
      </div>
      {detailError ? <div className="recharge-detail-state"><p className="admin-error-text">{detailError}</p><button type="button" className="admin-action-button" onClick={() => loadBatchDetails(activeBatchId)}>重新加载</button></div> : !details ? <div className="recharge-detail-state"><Loader2 size={18} className="animate-spin" /><span>正在加载卡密明细…</span></div> : <>
        <div className="table-wrap"><table className="v2-table">
          <thead><tr><th>卡密尾号</th><th>面额</th><th>有效期</th><th>状态</th><th>兑换用户</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>{details.page.rows.map((row) => <tr key={row.id}>
            <td className="mono">••••{row.codeTail}</td><td>{money(row.amount)}</td><td>{row.expiresAt}</td>
            <td><span className={`v2-badge ${row.status === "unused" ? "badge-success" : row.status === "redeemed" ? "" : "badge-warning"}`}>{({ unused: "未使用", redeemed: "已兑换", disabled: "已停用", expired: "已过期" } as const)[row.status]}</span></td>
            <td>{row.redeemedBy}<small>{row.redeemedAt}</small></td><td>{row.createdAt}</td>
            <td>{row.status === "unused" ? <button type="button" className="admin-danger-button" disabled={detailsPending} onClick={() => updateCardStatus(disableRechargeCardAction, row.id)}><XCircle size={14} />停用</button> : row.status === "disabled" ? <button type="button" className="admin-action-button" disabled={detailsPending} onClick={() => updateCardStatus(enableRechargeCardAction, row.id)}><RotateCcw size={14} />恢复启用</button> : <span className="admin-muted">不可操作</span>}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="admin-list-pager recharge-detail-pager"><span className="admin-pager-summary">显示 {(details.page.page - 1) * details.page.pageSize + 1}-{Math.min(details.page.page * details.page.pageSize, details.page.total)}，共 {details.page.total} 张</span><div className="admin-pager">
          <button type="button" className="admin-action-button" disabled={detailsPending || details.page.page <= 1} onClick={() => loadBatchDetails(details.batch.id, details.page.page - 1)}>上一页</button>
          <span className="admin-pager-page">{details.page.page} / {Math.max(1, Math.ceil(details.page.total / details.page.pageSize))}</span>
          <button type="button" className="admin-action-button" disabled={detailsPending || details.page.page >= Math.ceil(details.page.total / details.page.pageSize)} onClick={() => loadBatchDetails(details.batch.id, details.page.page + 1)}>下一页</button>
        </div></div>
      </>}
    </section> : null}
    <EditorModal open={createOpen} title="批量生成余额充值卡" onClose={() => setCreateOpen(false)} width={560}>
      <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); createBatch(event.currentTarget); }}>
        <label className="v2-field"><span>批次名称</span><input name="name" required maxLength={100} placeholder="例如 国庆活动 ¥20 充值卡" /></label>
        <div className="admin-form-grid">
          <label className="v2-field"><span>面额（元）</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label className="v2-field"><span>数量</span><input name="quantity" type="number" min="1" max="5000" step="1" defaultValue="10" required /></label>
        </div>
        <label className="v2-field"><span>有效期（留空永久有效）</span><input name="expiresAt" type="date" /><small>到期日当天 23:59:59 前可兑换。</small></label>
        <div className="admin-form-footer">
          <button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)} disabled={generating}>取消</button>
          <button type="submit" className="button button-primary" disabled={generating}>{generating ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{generating ? "生成中…" : "生成并下载 CSV"}</button>
        </div>
      </form>
    </EditorModal>
  </>;
}

// ---------------------------------------------------------------------------
// 公告
// ---------------------------------------------------------------------------

/** 与门户语言切换器保持同一套语言码；正文一律按 HTML 白名单过滤后再入库。 */
const KNOWLEDGE_LANGUAGE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文", "zh-TW": "繁體中文", "en-US": "English", "ja-JP": "日本語",
  "vi-VN": "Tiếng Việt", "ko-KR": "한국어", "fa-IR": "فارسی",
};

const RICH_TEXT_HINT =
  "支持 p / h1-h6 / ul / ol / li / blockquote / strong / em / a / img / table 等常用标签；" +
  "script、iframe、style、on* 事件等会在保存时被服务端过滤。";

function NoticesEditor({ page }: { page: Extract<AdminEditorData, { section: "notices" }>["page"] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={() => setSelected("new")}>
          <Plus size={15} />新建公告
        </button>
      </div>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>标题</th><th>标签</th><th>展示状态</th><th>发布时间</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}{row.imageUrl ? <small>封面 {row.imageUrl}</small> : null}</td>
                  <td>
                    {row.tags.length
                      ? row.tags.map((tag) => <span className="v2-badge" key={tag}>{tag}</span>)
                      : <span className="admin-muted">—</span>}
                  </td>
                  <td>
                    <span className={`v2-badge ${row.isVisible ? "badge-success" : ""}`}>
                      {row.isVisible ? "展示中" : "已隐藏"}
                    </span>
                  </td>
                  <td>{row.publishedAt}</td>
                  <td>{row.updatedAt}</td>
                  <td className="admin-row-actions">
                    <EditButton onClick={() => setSelected(row)} />
                    <DeleteButton
                      label={`公告「${row.title}」`}
                      pending={pending}
                      onConfirm={() => submit(deleteNoticeAction, buildForm({ id: row.id }), () => {})}
                    />
                  </td>
                </tr>
              )) : <tr><td colSpan={6} className="admin-empty">还没有公告，点击右侧「新建公告」开始撰写</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <EditorModal open={selected !== null} title={item ? "编辑公告" : "新建公告"} onClose={close} width={720}>
        <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveNoticeAction, event.currentTarget, close); }}>
          <input name="id" type="hidden" value={item?.id ?? ""} />
          <label className="v2-field"><span>标题</span><input name="title" defaultValue={item?.title ?? ""} required maxLength={255} /></label>
          <div className="admin-form-grid">
            <label className="v2-field">
              <span>封面图地址（可选）</span>
              <input name="imageUrl" defaultValue={item?.imageUrl ?? ""} maxLength={255} placeholder="/banner.png 或 https://…" />
            </label>
            <label className="v2-field">
              <span>标签（逗号分隔，最多 20 个）</span>
              <input name="tags" defaultValue={item?.tags.join(", ") ?? ""} maxLength={600} placeholder="维护通知, 活动" />
            </label>
          </div>
          <label className="v2-field">
            <span>发布时间（留空表示立即生效）</span>
            <input name="publishedAt" type="datetime-local" defaultValue={item?.publishedAtInput ?? ""} />
            <small>未到时间的公告不会出现在门户；时间按东八区填写。</small>
          </label>
          <label className="v2-field">
            <span>正文（HTML）</span>
            <textarea name="content" rows={10} maxLength={20000} required defaultValue={item?.content ?? ""} placeholder="&lt;p&gt;支持常用 HTML 标签。&lt;/p&gt;" />
            <small>{RICH_TEXT_HINT}</small>
          </label>
          <label className="admin-check-row">
            <input name="isVisible" type="checkbox" defaultChecked={item ? item.isVisible : true} />
            <span>在门户展示（取消勾选则完全隐藏）</span>
          </label>
          <FormFooter pending={pending} onClose={close} />
        </form>
      </EditorModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// 使用文档
// ---------------------------------------------------------------------------

function KnowledgeEditor({ page }: { page: Extract<AdminEditorData, { section: "knowledge" }>["page"] }) {
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null | "new">(null);
  const [article, setArticle] = useState<AdminKnowledgeArticle | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const { pending, submit } = useSubmit();

  const item = selected === "new" ? null : selected;

  // 正文是 MEDIUMTEXT，列表页不携带，点开时再取。
  const openArticle = async (row: (typeof page.rows)[number] | "new") => {
    setSelected(row);
    setArticle(null);
    setLoadError("");
    if (row === "new") return;
    setLoading(true);
    try {
      setArticle(await getKnowledgeArticleAction(row.id));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "正文加载失败");
    } finally {
      setLoading(false);
    }
  };

  const close = () => { setSelected(null); setArticle(null); setLoadError(""); };
  const ready = selected === "new" || article !== null;

  return (
    <>
      <div className="admin-section-actions">
        <button type="button" className="button button-primary" onClick={() => { void openArticle("new"); }}>
          <Plus size={15} />新建文档
        </button>
      </div>
      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>文档</th><th>语言</th><th>篇幅</th><th>排序</th><th>展示状态</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}<small>{row.category}</small></td>
                  <td>{KNOWLEDGE_LANGUAGE_LABELS[row.language] ?? row.language}</td>
                  <td>{row.bodyLength ? `${row.bodyLength} 字` : <span className="admin-muted">空</span>}</td>
                  <td>{row.sortOrder}</td>
                  <td>
                    <span className={`v2-badge ${row.isVisible ? "badge-success" : ""}`}>
                      {row.isVisible ? "展示中" : "已隐藏"}
                    </span>
                  </td>
                  <td>{row.updatedAt}</td>
                  <td className="admin-row-actions">
                    <EditButton onClick={() => { void openArticle(row); }} />
                    <DeleteButton
                      label={`文档「${row.title}」`}
                      pending={pending}
                      onConfirm={() => submit(deleteKnowledgeAction, buildForm({ id: row.id }), () => {})}
                    />
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="admin-empty">还没有文档，点击右侧「新建文档」开始撰写</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="admin-audit-note">
          门户的文档中心目前是简体中文单语言界面，会把所有「展示中」的文档一并列出；语言标签用于多语言站点上线后按语言区分。
        </p>
      </section>

      <EditorModal open={selected !== null} title={item ? "编辑文档" : "新建文档"} onClose={close} width={720}>
        {loading ? (
          <div className="admin-empty"><Loader2 size={16} className="animate-spin" /> 正在加载正文…</div>
        ) : loadError ? (
          <div className="admin-empty admin-error-text">{loadError}</div>
        ) : ready ? (
          <form
            key={article?.id ?? "new"}
            className="admin-editor-form"
            onSubmit={(event) => { event.preventDefault(); submit(saveKnowledgeAction, event.currentTarget, close); }}
          >
            <input name="id" type="hidden" value={article?.id ?? ""} />
            <label className="v2-field"><span>标题</span><input name="title" defaultValue={article?.title ?? ""} required maxLength={255} /></label>
            <div className="admin-form-grid">
              <label className="v2-field">
                <span>分类</span>
                <input name="category" defaultValue={article?.category ?? ""} required maxLength={100} placeholder="快速上手 / 常见问题" />
                <small>分类相同的文档会归到门户文档中心的同一组。</small>
              </label>
              <label className="v2-field">
                <span>语言</span>
                <select name="language" defaultValue={article?.language ?? "zh-CN"}>
                  {Object.entries(KNOWLEDGE_LANGUAGE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="v2-field">
              <span>排序（同分类内越小越靠前）</span>
              <input name="sortOrder" type="number" min="0" step="1" defaultValue={article?.sortOrder ?? 0} required />
            </label>
            <label className="v2-field">
              <span>正文（HTML）</span>
              <textarea name="body" rows={12} maxLength={60000} required defaultValue={article?.body ?? ""} placeholder="&lt;h2&gt;第一步&lt;/h2&gt;&lt;p&gt;…&lt;/p&gt;" />
              <small>{RICH_TEXT_HINT}</small>
            </label>
            <label className="admin-check-row">
              <input name="isVisible" type="checkbox" defaultChecked={article ? article.isVisible : true} />
              <span>在文档中心展示（取消勾选则完全隐藏）</span>
            </label>
            <FormFooter pending={pending} onClose={close} />
          </form>
        ) : null}
      </EditorModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// 流量统计
//
// 只读板块：流量由节点通过 POST /api/node/traffic 上报，后台不提供新建与编辑。
// 曾经 node_traffic_records 全项目零引用——数据存进去了却没有任何地方看得见，
// 这个板块就是为了让写入变得可观测。
// ---------------------------------------------------------------------------

function TrafficEditor({
  page,
  summary,
  q,
}: {
  page: Extract<AdminEditorData, { section: "traffic" }>["page"];
  summary: Extract<AdminEditorData, { section: "traffic" }>["summary"];
  q: string;
}) {
  return (
    <>
      {summary.length ? (
        <div className="stat-grid traffic-stats">
          {summary.map((item) => (
            <article key={item.recordType}>
              {/* 拼成单个字符串：JSX 里相邻的文本节点会被 React 用 <!-- --> 分隔，
                  散着写会让整段文案在 HTML 里断开，既不好读也不好断言。 */}
              <small>{`${RECORD_TYPE_LABELS[item.recordType] ?? item.recordType}粒度汇总`}</small>
              <strong>{formatBytes(item.uploadBytes + item.downloadBytes)}</strong>
              <small>{`上行 ${formatBytes(item.uploadBytes)} · 下行 ${formatBytes(item.downloadBytes)}`}</small>
              <small>{`${item.nodeCount} 个节点 · ${item.recordCount} 条记录`}</small>
            </article>
          ))}
        </div>
      ) : null}

      <section className="v2-block">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>节点</th><th>统计粒度</th><th>统计时间</th>
                <th>上行</th><th>下行</th><th>合计</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? page.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.nodeName}<small>节点 #{row.nodeId}</small></td>
                  <td><span className="v2-badge">{RECORD_TYPE_LABELS[row.recordType] ?? row.recordType}</span></td>
                  <td>{row.recordAt}</td>
                  <td>{formatBytes(row.uploadBytes)}</td>
                  <td>{formatBytes(row.downloadBytes)}</td>
                  <td><strong>{formatBytes(row.uploadBytes + row.downloadBytes)}</strong></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    {q
                      ? `没有匹配「${q}」的流量记录`
                      : "还没有流量记录。节点需通过 POST /api/node/traffic 上报，上报后这里才会出现数据。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {summary.length > 1 ? (
          <p className="admin-audit-note">
            汇总按统计粒度分开计算：小时、日、月三种记录可以同时存在并覆盖同一时段，
            合并相加会导致流量被重复统计。
          </p>
        ) : null}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 退款与对账
// ---------------------------------------------------------------------------

function RefundsEditor({ page }: { page: Extract<AdminEditorData, { section: "refunds" }>['page'] }) {
  return <section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>订单号</th><th>用户</th><th>退款金额</th><th>原因</th><th>操作管理员</th><th>完成时间</th></tr></thead><tbody>
    {page.rows.length ? page.rows.map((row) => <tr key={row.id}><td className="mono">{row.tradeNo}<small>退款 #{row.id}</small></td><td>{row.email}</td><td>{money(row.amount)}</td><td>{row.reason}</td><td>{row.adminEmail}</td><td>{row.completedAt}</td></tr>) : <tr><td colSpan={6} className="admin-empty">暂无退款记录</td></tr>}
  </tbody></table></div><p className="admin-audit-note">退款只退回站内余额，不会自动撤销已经开通的订阅权益。</p></section>;
}

function ReconciliationEditor({ page }: { page: Extract<AdminEditorData, { section: "reconciliation" }>['page'] }) {
  const { pending, submit } = useSubmit();
  const [selected, setSelected] = useState<(typeof page.rows)[number] | null>(null);
  const close = () => setSelected(null);
  return <>
    <section className="v2-block">
      <header className="v2-block-header"><div><h2>导入渠道 CSV 账单</h2><p className="admin-audit-note">固定表头：provider_trade_no,amount_cents,status,paid_at,currency；金额单位为分，仅支持 CNY。</p></div><Link className="admin-action-button" href="/api/admin/reconciliation/template">下载模板</Link></header>
      <form className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); submit(importReconciliationCsvAction, event.currentTarget, () => {}); }}>
        <input name="provider" required pattern="[a-z0-9_-]{2,50}" placeholder="provider，例如 mock" aria-label="支付渠道" />
        <input name="file" required type="file" accept=".csv,text/csv" aria-label="CSV 账单" />
        <button type="submit" className="button button-primary" disabled={pending}><Upload size={15} />导入并核对</button>
      </form>
    </section>
    <section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>渠道 / 批次</th><th>渠道流水号</th><th>金额</th><th>匹配结果</th><th>处理状态</th><th>操作</th></tr></thead><tbody>
      {page.rows.length ? page.rows.map((row) => <tr key={row.id}><td><span className="mono">{row.provider}</span><small>{row.filename} · #{row.batchId}</small></td><td className="mono">{row.providerTradeNo}</td><td>{money(row.amount)}</td><td><span className={`v2-badge ${row.matchStatus === "matched" ? "badge-success" : "badge-warning"}`}>{row.matchStatus}</span></td><td>{row.resolutionStatus === "open" ? "待处理" : row.resolutionStatus === "ignored" ? "已忽略" : "无需处理"}{row.resolutionNote ? <small>{row.resolutionNote}</small> : null}</td><td>{row.resolutionStatus === "open" ? <button type="button" className="admin-action-button" onClick={() => setSelected(row)}>处理</button> : <span className="admin-muted">—</span>}</td></tr>) : <tr><td colSpan={6} className="admin-empty">暂无对账明细</td></tr>}
    </tbody></table></div></section>
    <EditorModal open={selected !== null} title="处理对账差异" onClose={close} width={560}>{selected ? <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(resolveReconciliationRowAction, event.currentTarget, close); }}><input name="rowId" type="hidden" value={selected.id} /><div className="admin-readonly-row"><span>渠道流水 <code>{selected.providerTradeNo}</code></span><span>结果 <code>{selected.matchStatus}</code></span></div><label className="v2-field"><span>处理备注</span><textarea name="note" required rows={4} maxLength={500} placeholder="说明已核实原因；该操作不会自动改账" /></label><FormFooter pending={pending} onClose={close} submitLabel="标记为已处理" /></form> : null}</EditorModal>
  </>;
}

const SETTING_SOURCE_LABELS = { admin: "后台设置", env: "环境变量", default: "默认值" } as const;

/**
 * 系统设置：按分组平铺在一张表单里，一次保存。
 * 敏感项不回显：留空表示保持不变，勾选「清除」后回退到环境变量。
 */
function SettingsEditor({ rows, encryptionReady }: { rows: Extract<AdminEditorData, { section: "settings" }>["page"]["rows"]; encryptionReady: boolean }) {
  const { pending, submit } = useSubmit();
  const [testing, startTesting] = useTransition();
  const { showToast } = useToast();
  const groups = [...new Set(rows.map((row) => row.group))];
  // 保存后 router.refresh() 带回新值；以当前值为 key 重建表单，让 defaultValue 跟上。
  const formKey = rows.map((row) => `${row.key}=${row.value}:${row.source}:${row.updatedAt ?? ""}`).join("|");

  const testPanel = () => {
    startTesting(async () => {
      try {
        const result = await testPanelConnectionAction();
        showToast(result.message, result.ok ? "success" : "error");
      } catch {
        showToast("连接测试失败", "error");
      }
    });
  };

  return (
    <form key={formKey} className="admin-editor-form" style={{ gridColumn: "1 / -1" }} onSubmit={(event) => { event.preventDefault(); submit(saveSystemSettingsAction, event.currentTarget, () => {}); }}>
      {!encryptionReady ? (
        <p className="admin-audit-note" style={{ color: "var(--v2-danger, #d4380d)" }}>
          服务器未配置 SETTINGS_ENCRYPTION_KEY：敏感项（Token、密钥）暂时只能通过环境变量设置，其余设置不受影响。
        </p>
      ) : null}
      {groups.map((group) => (
        <section className="v2-block" key={group}>
          <header className="v2-block-header">
            <h2>{group}</h2>
            {group === "节点" ? (
              <button type="button" className="button button-secondary" onClick={testPanel} disabled={testing}>
                {testing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {testing ? "测试中…" : "测试 3x-ui 连接"}
              </button>
            ) : null}
          </header>
          <div className="admin-form-grid" style={{ padding: "0 16px 16px" }}>
            {rows.filter((row) => row.group === group).map((row) => (
              <label className="v2-field" key={row.key}>
                <span>
                  {row.label}{row.unit ? `（${row.unit}）` : ""}{" "}
                  <span className={`v2-badge ${row.source === "admin" ? "badge-success" : ""}`}>{SETTING_SOURCE_LABELS[row.source]}</span>
                </span>
                {row.kind === "secret" ? (
                  <input
                    name={row.key}
                    type="password"
                    autoComplete="new-password"
                    placeholder={row.configured ? `已配置（来源：${SETTING_SOURCE_LABELS[row.source]}），留空不修改` : "未配置"}
                    disabled={!encryptionReady}
                  />
                ) : (
                  <input
                    name={row.key}
                    type={row.kind === "url" ? "url" : "number"}
                    defaultValue={row.source === "admin" ? row.value : ""}
                    placeholder={row.value ? `当前：${row.value}` : "未配置"}
                    min={row.min ?? undefined}
                    max={row.max ?? undefined}
                    step={row.kind === "number" ? "0.01" : row.kind === "int" ? "1" : undefined}
                  />
                )}
                <small>
                  {row.description}
                  {row.env ? ` 留空则使用环境变量 ${row.env}${row.defaultValue ? `，再没有则用默认值 ${row.defaultValue}` : ""}。` : ""}
                </small>
                {row.kind === "secret" && row.source === "admin" ? (
                  <label className="admin-check-row"><input name={`clear:${row.key}`} type="checkbox" /><span>清除后台值（回退到环境变量）</span></label>
                ) : null}
              </label>
            ))}
          </div>
        </section>
      ))}
      <div className="admin-form-footer">
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {pending ? "保存中…" : "保存设置"}
        </button>
      </div>
    </form>
  );
}

export function AdminEditor({ data, q }: { data: AdminEditorData; q: string }) {
  const section = () => {
    if (data.section === "users") return <UsersEditor page={data.page} />;
    if (data.section === "plans") return <PlansEditor page={data.page} groups={data.groups} />;
    if (data.section === "coupons") return <CouponsEditor page={data.page} plans={data.plans} />;
    if (data.section === "payments") return <PaymentsEditor page={data.page} />;
    if (data.section === "refunds") return <RefundsEditor page={data.page} />;
    if (data.section === "reconciliation") return <ReconciliationEditor page={data.page} />;
    if (data.section === "recharge-cards") return <RechargeCardsEditor page={data.page} q={q} />;
    if (data.section === "nodes") return <NodesEditor page={data.page} groups={data.groups} />;
    if (data.section === "tickets") return <TicketsEditor page={data.page} />;
    if (data.section === "notices") return <NoticesEditor page={data.page} />;
    if (data.section === "knowledge") return <KnowledgeEditor page={data.page} />;
    if (data.section === "traffic") return <TrafficEditor page={data.page} summary={data.summary} q={q} />;
    if (data.section === "mail") return <MailEditor settings={data.page.rows[0]} />;
    if (data.section === "settings") return <SettingsEditor rows={data.page.rows} encryptionReady={data.encryptionReady} />;
    return <OrdersEditor page={data.page} plans={data.plans} />;
  };

  // .admin-editor 是两列网格：搜索框落在第一列，各板块自己的「新建 X」按钮落在第二列，
  // 两者因此在同一排；表格设了 grid-column: 1 / -1，始终整行铺满。
  return (
    <div className="admin-editor">
      {data.section !== "mail" && data.section !== "settings" ? <AdminListToolbar section={data.section} q={q} /> : null}
      {section()}
    </div>
  );
}
