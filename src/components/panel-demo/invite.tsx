"use client";

import { useState } from "react";
import { Ban, CirclePlay, Copy, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/aera/data-table";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { StatCard } from "@/components/aera/stat-card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COMMISSIONS, INVITE, PANEL_ACCOUNT, PANEL_NOW, REFERRALS, type Commission, type InviteCode, type Referral } from "@/lib/demo/panel-mock";
import { formatTime, yuan } from "./order-status";
import { usePanelState } from "./state";
import { copy } from "./telegram-dialog";

const linkOf = (code: string) => `${window.location.origin}/register?code=${code}`;

/** Why a code can or cannot be used right now. */
function codeState(code: InviteCode) {
  const expired = code.expiresAt !== null && code.expiresAt < PANEL_NOW.getTime();
  const exhausted = code.maxUses !== null && code.used >= code.maxUses;
  return { expired, exhausted, usable: code.status === 0 && !expired && !exhausted, canEnable: code.status === 1 && !expired && !exhausted };
}

export function InvitePage() {
  const { commission, transferCommission, inviteCodes, generateCode, toggleCode } = usePanelState();
  const [generating, setGenerating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [toggling, setToggling] = useState<InviteCode | null>(null);

  const earned = COMMISSIONS.reduce((sum, item) => sum + item.amount, 0);
  const pending = COMMISSIONS.filter((item) => !item.settled).reduce((sum, item) => sum + item.amount, 0);
  const transferred = INVITE.transferred + (PANEL_ACCOUNT.commission - commission);

  const codeColumns: Column<InviteCode>[] = [
    { key: "code", header: "邀请码", cell: (code) => code.code, className: "font-mono text-[13px] font-medium" },
    { key: "pv", header: "访问次数", hideBelow: "xl", align: "right", cell: (code) => code.pv, className: "tabular-nums" },
    { key: "used", header: "使用情况", cell: (code) => `${code.used} / ${code.maxUses ?? "不限"}`, className: "tabular-nums" },
    { key: "expires", header: "有效期", hideBelow: "2xl", cell: (code) => (code.expiresAt ? formatTime(code.expiresAt) : "长期有效"), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    {
      key: "status",
      header: "状态",
      cell: (code) => {
        const { expired, exhausted, usable } = codeState(code);
        return (
          <Badge variant={usable ? "secondary" : "outline"} className={usable ? undefined : "text-muted-foreground"}>
            {expired ? "已过期" : exhausted ? "已用尽" : code.status === 0 ? "有效" : "已停用"}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      align: "right",
      cell: (code) => {
        const { canEnable } = codeState(code);
        return (
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" aria-label="复制链接" onClick={() => void copy(linkOf(code.code), "推广注册链接已复制")}>
              <Copy className="sm:hidden" />
              <span className="max-sm:hidden">复制链接</span>
            </Button>
            <Button variant="ghost" size="sm" aria-label={code.status === 0 ? "停用" : "启用"} disabled={code.status === 1 && !canEnable} title={code.status === 1 && !canEnable ? "邀请码已过期或达到使用上限，不能重新启用" : undefined} onClick={() => setToggling(code)}>
              {code.status === 0 ? <Ban className="sm:hidden" /> : <CirclePlay className="sm:hidden" />}
              <span className="max-sm:hidden">{code.status === 0 ? "停用" : canEnable ? "启用" : "不可启用"}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  const referralColumns: Column<Referral>[] = [
    { key: "email", header: "用户", cell: (item) => item.email },
    { key: "code", header: "使用邀请码", hideBelow: "xl", cell: (item) => item.code, className: "font-mono text-[13px]" },
    { key: "orders", header: "完成订单", hideBelow: "xl", align: "right", cell: (item) => item.orders, className: "tabular-nums" },
    { key: "paid", header: "实付总额", align: "right", cell: (item) => yuan(item.paid), className: "tabular-nums" },
    { key: "commission", header: "贡献佣金", align: "right", cell: (item) => yuan(item.commission), className: "font-medium tabular-nums" },
    { key: "joined", header: "注册时间", hideBelow: "2xl", cell: (item) => formatTime(item.joinedAt), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    { key: "active", header: "状态", hideBelow: "xl", cell: (item) => <Badge variant={item.active ? "secondary" : "outline"}>{item.active ? "正常" : "停用"}</Badge> },
  ];

  const commissionColumns: Column<Commission>[] = [
    { key: "invitee", header: "被邀请人", cell: (item) => item.invitee },
    { key: "order", header: "订单金额", hideBelow: "sm", align: "right", cell: (item) => yuan(item.orderAmount), className: "tabular-nums" },
    { key: "amount", header: "获得佣金", align: "right", cell: (item) => yuan(item.amount), className: "font-medium tabular-nums" },
    {
      key: "settled",
      header: "结算状态",
      cell: (item) => (
        <Badge variant={item.settled ? "secondary" : "outline"}>
          {!item.settled && <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />}
          {item.settled ? "已结算" : "待结算"}
        </Badge>
      ),
    },
    { key: "at", header: "时间", hideBelow: "md", cell: (item) => formatTime(item.at), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
  ];

  const description =
    INVITE.rate > 0
      ? `返佣 ${INVITE.rate}%，好友完成支付${INVITE.availableAfterDays > 0 ? ` ${INVITE.availableAfterDays} 天后可划转` : "确认后即可划转"} · 累计已划转 ${yuan(transferred)}`
      : "当前返佣已关闭，邀请码仍可用于统计邀请关系";

  return (
    <Page>
      <PageHeader
        title="我的邀请"
        description={description}
        actions={
          <>
            <Button variant="outline" disabled={commission <= 0} title={commission <= 0 ? "当前没有可划转佣金" : undefined} onClick={() => setTransferring(true)}>
              <Wallet data-icon="inline-start" />
              划转至余额
            </Button>
            <Button onClick={() => setGenerating(true)}>
              <Plus data-icon="inline-start" />
              生成邀请码
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="累计邀请人数" value={REFERRALS.length} />
        <StatCard label="产生佣金总计" value={yuan(earned)} />
        <StatCard label="可划转佣金" value={yuan(commission)} />
        <StatCard label="待结算佣金" value={yuan(pending)} />
      </div>

      <Tabs defaultValue="codes" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="codes">我的邀请码</TabsTrigger>
          <TabsTrigger value="referrals">受邀用户</TabsTrigger>
          <TabsTrigger value="commissions">佣金明细</TabsTrigger>
        </TabsList>
        <TabsContent value="codes">
          <DataTable
            columns={codeColumns}
            rows={inviteCodes}
            rowKey={(code) => String(code.id)}
            empty={
              <Empty className="border-0 py-6">
                <EmptyHeader>
                  <EmptyTitle>您还没有邀请码</EmptyTitle>
                  <EmptyDescription>点击右上角「生成邀请码」开始推广。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
        </TabsContent>
        <TabsContent value="referrals">
          <DataTable columns={referralColumns} rows={REFERRALS} rowKey={(item) => String(item.id)} empty="暂无受邀用户，复制推广链接邀请好友注册。" />
        </TabsContent>
        <TabsContent value="commissions">
          <DataTable columns={commissionColumns} rows={COMMISSIONS} rowKey={(item) => String(item.id)} empty="暂无佣金记录，邀请好友下单后即可在此查看。" />
        </TabsContent>
      </Tabs>

      {generating && (
        <GenerateDialog
          onClose={() => setGenerating(false)}
          onGenerate={(options) => {
            const code = generateCode(options);
            setGenerating(false);
            toast.success("已生成新的邀请码");
            void copy(linkOf(code), "推广注册链接已复制");
          }}
        />
      )}
      {transferring && (
        <TransferDialog
          available={commission}
          onClose={() => setTransferring(false)}
          onTransfer={(cents) => {
            transferCommission(cents);
            setTransferring(false);
            toast.success("划转成功，已存入账户可用余额");
          }}
        />
      )}

      <AlertDialog open={toggling !== null} onOpenChange={(open) => !open && setToggling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toggling?.status === 0 ? "停用邀请码？" : "重新启用邀请码？"}</AlertDialogTitle>
            <AlertDialogDescription>{toggling?.status === 0 ? "停用后该推广链接将不能用于新用户注册，已有邀请关系不受影响。" : "启用后推广链接将恢复使用。"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={toggling?.status === 0 ? "destructive" : "default"}
              onClick={() => {
                if (toggling) toggleCode(toggling.id);
                toast.success(toggling?.status === 0 ? "邀请码已停用" : "邀请码已启用");
                setToggling(null);
              }}
            >
              {toggling?.status === 0 ? "确认停用" : "确认启用"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function GenerateDialog({ onClose, onGenerate }: { onClose: () => void; onGenerate: (options: { maxUses?: number; days?: number }) => void }) {
  const [maxUses, setMaxUses] = useState("");
  const [days, setDays] = useState("");
  const [errors, setErrors] = useState<{ maxUses?: string; days?: string }>({});

  const submit = () => {
    const next: typeof errors = {};
    const uses = maxUses.trim() ? Number(maxUses) : undefined;
    const valid = days.trim() ? Number(days) : undefined;
    if (uses !== undefined && (!Number.isInteger(uses) || uses < 1 || uses > 10000)) next.maxUses = "请输入 1 到 10000 的整数";
    if (valid !== undefined && (!Number.isInteger(valid) || valid < 1 || valid > 365)) next.days = "请输入 1 到 365 的整数";
    setErrors(next);
    if (!Object.keys(next).length) onGenerate({ maxUses: uses, days: valid });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成邀请码</DialogTitle>
          <DialogDescription>生成后可随时停用；重新启用时仍会检查有效期和使用上限。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={errors.maxUses ? true : undefined}>
            <FieldLabel htmlFor="max-uses">最多使用次数</FieldLabel>
            <Input id="max-uses" type="number" inputMode="numeric" min={1} max={10000} placeholder="不填表示不限" value={maxUses} aria-invalid={errors.maxUses ? true : undefined} onChange={(event) => setMaxUses(event.target.value)} />
            {errors.maxUses && <FieldError>{errors.maxUses}</FieldError>}
          </Field>
          <Field data-invalid={errors.days ? true : undefined}>
            <FieldLabel htmlFor="valid-days">有效天数</FieldLabel>
            <Input id="valid-days" type="number" inputMode="numeric" min={1} max={365} placeholder="不填表示长期有效" value={days} aria-invalid={errors.days ? true : undefined} onChange={(event) => setDays(event.target.value)} />
            {errors.days && <FieldError>{errors.days}</FieldError>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>生成并复制链接</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ available, onClose, onTransfer }: { available: number; onClose: () => void; onTransfer: (cents: number) => void }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("请输入大于 0 的划转金额");
    const cents = Math.round(value * 100);
    if (cents > available) return setError(`当前可划转佣金为 ${yuan(available)}，无法超额划转`);
    setError(null);
    onTransfer(cents);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>划转佣金至余额</DialogTitle>
          <DialogDescription>当前可划转 {yuan(available)}。划转后金额将进入可用余额，可用于支付订单。</DialogDescription>
        </DialogHeader>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="transfer-amount">划转金额（元）</FieldLabel>
          <InputGroup>
            <InputGroupAddon>¥</InputGroupAddon>
            <InputGroupInput
              id="transfer-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => event.key === "Enter" && submit()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="outline" onClick={() => setAmount((available / 100).toFixed(2))}>
                全部划转
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {error ? <FieldError>{error}</FieldError> : <FieldDescription>不超过当前可划转佣金。</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>确定划转</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
