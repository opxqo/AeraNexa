"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RotateCcw, Save, XCircle } from "lucide-react";
import type { AdminEditorData } from "@/lib/server/admin-editor";
import {
  saveNodeAction,
  savePaymentMethodAction,
  savePlanAction,
  saveTicketAction,
  saveUserAction,
  updateOrderStatusAction,
} from "@/app/admin/actions";
import { Modal, useToast } from "@/components/v2-modal";

type Result = { ok: boolean; message: string };

function useSubmit() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const submit = (action: (data: FormData) => Promise<Result>, form: HTMLFormElement, close: () => void) => {
    startTransition(async () => {
      const result = await action(new FormData(form));
      showToast(result.message, result.ok ? "success" : "error");
      if (result.ok) {
        close();
        router.refresh();
      }
    });
  };
  return { pending, submit };
}

function EditButton({ onClick, label = "编辑" }: { onClick: () => void; label?: string }) {
  return <button type="button" className="admin-action-button" onClick={onClick}><Pencil size={14} />{label}</button>;
}

function EditorModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal open={open} title={title} onClose={onClose} footer={null} width={560}>{children}</Modal>;
}

function FormFooter({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return <div className="admin-form-footer"><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>取消</button><button type="submit" className="button button-primary" disabled={pending}><Save size={15} />{pending ? "保存中..." : "保存更改"}</button></div>;
}

function RoleBadge({ role }: { role: "admin" | "user" }) {
  return <span className={`v2-badge ${role === "admin" ? "admin-role-badge" : "user-role-badge"}`}>{role === "admin" ? "管理员" : "普通用户"}</span>;
}

function UsersEditor({ rows }: { rows: Extract<AdminEditorData, { section: "users" }> ["rows"] }) {
  const [selected, setSelected] = useState<(typeof rows)[number] | null>(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  return <>
    <section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>用户</th><th>身份</th><th>套餐</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.nickname}<small>{row.email}</small></td><td><RoleBadge role={row.role} /></td><td>{row.planName}</td><td><span className={`v2-badge ${row.isActive ? "badge-success" : "badge-danger"}`}>{row.isActive ? "正常" : "停用"}</span></td><td>{row.createdAt}</td><td><EditButton onClick={() => setSelected(row)} /></td></tr>)}</tbody></table></div></section>
    <EditorModal open={selected !== null} title="编辑用户" onClose={close}>{selected ? <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveUserAction, event.currentTarget, close); }}><input name="id" type="hidden" value={selected.id} /><label className="v2-field"><span>邮箱</span><input value={selected.email} disabled /></label><label className="v2-field"><span>昵称</span><input name="nickname" defaultValue={selected.nickname} required maxLength={50} /></label><label className="v2-field"><span>身份标签</span><select name="role" defaultValue={selected.role}><option value="user">普通用户</option><option value="admin">管理员</option></select><small>管理员可访问 /admin 并执行后台操作。</small></label><label className="admin-check-row"><input name="isActive" type="checkbox" defaultChecked={selected.isActive} /><span>账户正常启用</span></label><FormFooter pending={pending} onClose={close} /></form> : null}</EditorModal>
  </>;
}

function PlansEditor({ rows }: { rows: Extract<AdminEditorData, { section: "plans" }> ["rows"] }) {
  const [selected, setSelected] = useState<(typeof rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null);
  const item = selected === "new" ? null : selected;
  return <><div className="admin-section-actions"><button type="button" className="button button-primary" onClick={() => setSelected("new")}><Plus size={15} />新建套餐</button></div><section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>套餐</th><th>流量</th><th>限速</th><th>月付</th><th>售卖状态</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.transferEnable} GB</td><td>{row.speedLimit === null ? "不限速" : `${row.speedLimit} Mbps`}</td><td>{row.monthPrice === null ? "—" : `¥${(row.monthPrice / 100).toFixed(2)}`}</td><td><span className={`v2-badge ${row.isVisible ? "badge-success" : ""}`}>{row.isVisible ? "展示中" : "已隐藏"}</span></td><td><EditButton onClick={() => setSelected(row)} /></td></tr>)}</tbody></table></div></section><EditorModal open={selected !== null} title={item ? "编辑套餐" : "新建套餐"} onClose={close}><form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(savePlanAction, event.currentTarget, close); }}><input name="id" type="hidden" value={item?.id ?? ""} /><label className="v2-field"><span>套餐名称</span><input name="name" defaultValue={item?.name ?? ""} required /></label><div className="admin-form-grid"><label className="v2-field"><span>流量（GB）</span><input name="transferEnable" type="number" min="0" defaultValue={item?.transferEnable ?? 100} required /></label><label className="v2-field"><span>限速（Mbps，留空不限速）</span><input name="speedLimit" type="number" min="0" defaultValue={item?.speedLimit ?? ""} /></label></div><label className="v2-field"><span>月付价格（元）</span><input name="monthPrice" type="number" min="0" step="0.01" defaultValue={item?.monthPrice === null || item === null ? "0" : (item.monthPrice / 100).toFixed(2)} required /></label><div className="admin-check-list"><label className="admin-check-row"><input name="isVisible" type="checkbox" defaultChecked={item?.isVisible ?? true} /><span>前台展示</span></label><label className="admin-check-row"><input name="isRenewable" type="checkbox" defaultChecked={item?.isRenewable ?? true} /><span>允许续费</span></label></div><FormFooter pending={pending} onClose={close} /></form></EditorModal></>;
}

function PaymentsEditor({ rows }: { rows: Extract<AdminEditorData, { section: "payments" }> ["rows"] }) {
  const [selected, setSelected] = useState<(typeof rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit();
  const close = () => setSelected(null); const item = selected === "new" ? null : selected;
  return <><div className="admin-section-actions"><button type="button" className="button button-primary" onClick={() => setSelected("new")}><Plus size={15} />新建支付渠道</button></div><section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>渠道</th><th>Provider</th><th>固定手续费</th><th>比例手续费</th><th>启用状态</th><th>操作</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td>{row.name}</td><td className="mono">{row.provider}</td><td>¥{(row.handlingFeeFixed / 100).toFixed(2)}</td><td>{row.handlingFeePercent}%</td><td><span className={`v2-badge ${row.isEnabled ? "badge-success" : ""}`}>{row.isEnabled ? "已启用" : "已停用"}</span></td><td><EditButton onClick={() => setSelected(row)} /></td></tr>) : <tr><td colSpan={6} className="admin-empty">尚未配置支付渠道，可在此创建测试渠道</td></tr>}</tbody></table></div></section><EditorModal open={selected !== null} title={item ? "编辑支付渠道" : "新建支付渠道"} onClose={close}><form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(savePaymentMethodAction, event.currentTarget, close); }}><input name="id" type="hidden" value={item?.id ?? ""} /><div className="admin-form-grid"><label className="v2-field"><span>渠道名称</span><input name="name" defaultValue={item?.name ?? ""} required /></label><label className="v2-field"><span>Provider 标识</span><input name="provider" defaultValue={item?.provider ?? "epay"} required /></label></div><div className="admin-form-grid"><label className="v2-field"><span>固定手续费（元）</span><input name="handlingFeeFixed" type="number" step="0.01" min="0" defaultValue={item ? (item.handlingFeeFixed / 100).toFixed(2) : "0"} required /></label><label className="v2-field"><span>比例手续费（%）</span><input name="handlingFeePercent" type="number" step="0.01" min="0" max="100" defaultValue={item?.handlingFeePercent ?? "0"} required /></label></div><label className="v2-field"><span>回调域名（可选）</span><input name="notifyDomain" type="url" defaultValue={item?.notifyDomain ?? ""} placeholder="https://pay.example.com" /></label><label className="admin-check-row"><input name="isEnabled" type="checkbox" defaultChecked={item?.isEnabled ?? false} /><span>启用此支付渠道</span></label><p className="admin-form-help">支付密钥不会显示或写入该表单，后续对接网关时单独配置。</p><FormFooter pending={pending} onClose={close} /></form></EditorModal></>;
}

function NodesEditor({ rows }: { rows: Extract<AdminEditorData, { section: "nodes" }> ["rows"] }) {
  const [selected, setSelected] = useState<(typeof rows)[number] | null | "new">(null);
  const { pending, submit } = useSubmit(); const close = () => setSelected(null); const item = selected === "new" ? null : selected;
  return <><div className="admin-section-actions"><button type="button" className="button button-primary" onClick={() => setSelected("new")}><Plus size={15} />新建节点</button></div><section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>节点</th><th>协议</th><th>地址</th><th>倍率</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td>{row.name}<small>{row.externalPanel}</small></td><td>{row.protocol.toUpperCase()}</td><td className="mono">{row.host}:{row.port}</td><td>{row.rate.toFixed(2)}x</td><td><span className={`v2-badge ${row.isOnline ? "badge-success" : "badge-danger"}`}>{row.isOnline ? "在线" : "离线"}</span></td><td><EditButton onClick={() => setSelected(row)} /></td></tr>) : <tr><td colSpan={6} className="admin-empty">暂无节点，可先添加 3x-ui 映射节点</td></tr>}</tbody></table></div></section><EditorModal open={selected !== null} title={item ? "编辑节点" : "新建节点"} onClose={close}><form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveNodeAction, event.currentTarget, close); }}><input name="id" type="hidden" value={item?.id ?? ""} /><div className="admin-form-grid"><label className="v2-field"><span>节点名称</span><input name="name" defaultValue={item?.name ?? ""} required /></label><label className="v2-field"><span>协议</span><input name="protocol" defaultValue={item?.protocol ?? "vless"} required /></label></div><div className="admin-form-grid"><label className="v2-field"><span>主机</span><input name="host" defaultValue={item?.host ?? ""} required /></label><label className="v2-field"><span>端口</span><input name="port" type="number" min="1" max="65535" defaultValue={item?.port ?? "443"} required /></label></div><div className="admin-form-grid"><label className="v2-field"><span>倍率</span><input name="rate" type="number" min="0.01" max="100" step="0.01" defaultValue={item?.rate ?? "1"} required /></label><label className="v2-field"><span>来源面板</span><input name="externalPanel" defaultValue={item?.externalPanel ?? "3x-ui"} required /></label></div><div className="admin-check-list"><label className="admin-check-row"><input name="isVisible" type="checkbox" defaultChecked={item?.isVisible ?? true} /><span>用户端显示</span></label><label className="admin-check-row"><input name="isOnline" type="checkbox" defaultChecked={item?.isOnline ?? false} /><span>标记为在线</span></label></div><FormFooter pending={pending} onClose={close} /></form></EditorModal></>;
}

function TicketsEditor({ rows }: { rows: Extract<AdminEditorData, { section: "tickets" }> ["rows"] }) {
  const [selected, setSelected] = useState<(typeof rows)[number] | null>(null); const { pending, submit } = useSubmit(); const close = () => setSelected(null);
  return <><section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>主题</th><th>用户</th><th>优先级</th><th>回复</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td>{row.subject}</td><td>{row.email}</td><td>{["低", "中", "高"][row.level] ?? "中"}</td><td>{row.replyStatus ? "已回复" : "待回复"}</td><td><span className={`v2-badge ${row.status ? "" : "badge-warning"}`}>{row.status ? "已关闭" : "处理中"}</span></td><td>{row.updatedAt}</td><td><EditButton onClick={() => setSelected(row)} /></td></tr>) : <tr><td colSpan={7} className="admin-empty">暂无工单</td></tr>}</tbody></table></div></section><EditorModal open={selected !== null} title="处理工单" onClose={close}>{selected ? <form className="admin-editor-form" onSubmit={(event) => { event.preventDefault(); submit(saveTicketAction, event.currentTarget, close); }}><input name="id" type="hidden" value={selected.id} /><label className="v2-field"><span>工单主题</span><input value={selected.subject} disabled /></label><label className="v2-field"><span>优先级</span><select name="level" defaultValue={selected.level}><option value="0">低</option><option value="1">中</option><option value="2">高</option></select></label><label className="v2-field"><span>处理状态</span><select name="status" defaultValue={selected.status}><option value="0">处理中</option><option value="1">关闭工单</option></select></label><FormFooter pending={pending} onClose={close} /></form> : null}</EditorModal></>;
}

function OrdersEditor({ rows }: { rows: Extract<AdminEditorData, { section: "orders" }> ["rows"] }) {
  const { pending, submit } = useSubmit();
  return <section className="v2-block"><div className="table-wrap"><table className="v2-table"><thead><tr><th>订单号</th><th>用户</th><th>套餐</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td className="mono">{row.tradeNo}</td><td>{row.email}</td><td>{row.planName}</td><td>¥{(row.totalAmount / 100).toFixed(2)}</td><td><span className={`v2-badge ${row.status === 3 ? "badge-success" : row.status === 0 ? "badge-warning" : ""}`}>{["待支付", "开通中", "已取消", "已完成", "已折抵", "已退款"][row.status] ?? "未知"}</span></td><td>{row.status === 0 || row.status === 2 ? <form onSubmit={(event) => { event.preventDefault(); submit(updateOrderStatusAction, event.currentTarget, () => {}); }}><input name="id" type="hidden" value={row.id} /><input name="status" type="hidden" value={row.status === 0 ? "2" : "0"} /><button type="submit" className="admin-action-button" disabled={pending}>{row.status === 0 ? <><XCircle size={14} />取消订单</> : <><RotateCcw size={14} />恢复待支付</>}</button></form> : <span className="admin-muted">支付履约管理</span>}</td></tr>) : <tr><td colSpan={6} className="admin-empty">暂无订单</td></tr>}</tbody></table></div><p className="admin-audit-note">已支付订单只能通过支付回调完成履约，后台不会直接伪造支付成功状态。</p></section>;
}

export function AdminEditor({ data }: { data: AdminEditorData }) {
  if (data.section === "users") return <UsersEditor rows={data.rows} />;
  if (data.section === "plans") return <PlansEditor rows={data.rows} />;
  if (data.section === "payments") return <PaymentsEditor rows={data.rows} />;
  if (data.section === "nodes") return <NodesEditor rows={data.rows} />;
  if (data.section === "tickets") return <TicketsEditor rows={data.rows} />;
  return <OrdersEditor rows={data.rows} />;
}
