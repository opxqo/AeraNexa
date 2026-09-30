"use client";

import { useState } from "react";
import { Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { AVATARS, UserAvatar } from "@/components/aera/avatars";
import { DataTable, type Column } from "@/components/aera/data-table";
import { KeyValueList } from "@/components/aera/key-value-list";
import { Page, PageHeader, Section } from "@/components/aera/page-layout";
import { StatCard } from "@/components/aera/stat-card";
import { UsageMeter } from "@/components/aera/usage-meter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PANEL_ACCOUNT, PULLS, SUBSCRIPTION, type Device, type Pull, type WalletTx } from "@/lib/demo/panel-mock";
import { formatTime, yuan } from "./order-status";
import { usePanelState } from "./state";
import { copy, TelegramDialog } from "./telegram-dialog";

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export function ProfilePage() {
  const { email, telegramBound, setTelegramBound, devices, removeDevice } = usePanelState();
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [confirm, setConfirm] = useState<"unbind" | "removeAll" | null>(null);

  const limit = PANEL_ACCOUNT.deviceLimit;
  const registered: Column<Device>[] = [
    {
      key: "device",
      header: "设备",
      cell: (device) => (
        <div>
          {device.model} · {device.os}
          <div className="text-xs text-muted-foreground">{device.userAgent}</div>
        </div>
      ),
    },
    { key: "first", header: "首次登记", hideBelow: "md", cell: (device) => formatTime(device.firstSeen), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    { key: "last", header: "最近拉取订阅", hideBelow: "sm", cell: (device) => formatTime(device.lastSeen), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    {
      key: "remove",
      header: <span className="sr-only">操作</span>,
      align: "right",
      cell: (device) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            removeDevice(device.id);
            toast.success("设备已移除");
          }}
        >
          移除
        </Button>
      ),
    },
  ];
  const pulls: Column<Pull>[] = [
    {
      key: "client",
      header: "客户端",
      cell: (pull) => (
        <div>
          {pull.client}
          <div className="text-xs text-muted-foreground">{pull.userAgent}</div>
        </div>
      ),
    },
    { key: "ip", header: "网络地址", hideBelow: "sm", cell: (pull) => pull.ip, className: "font-mono text-[13px]" },
    { key: "last", header: "最近拉取订阅", hideBelow: "md", cell: (pull) => formatTime(pull.lastPulled), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    { key: "times", header: "30 天内次数", align: "right", cell: (pull) => pull.times, className: "tabular-nums" },
  ];

  return (
    <Page className="max-w-3xl">
      <PageHeader title="个人中心" description="安全与偏好设置" />

      <Section label="账户">
        <Card>
          <CardContent className="space-y-6">
            <ProfileForm />
            <KeyValueList
              items={[
                { label: "登录邮箱", value: email },
                { label: "账户角色", value: PANEL_ACCOUNT.role },
                { label: "订阅到期", value: `${SUBSCRIPTION.expiredAt.getFullYear()} 年 ${SUBSCRIPTION.expiredAt.getMonth() + 1} 月 ${SUBSCRIPTION.expiredAt.getDate()} 日` },
                {
                  label: "UUID",
                  value: (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono text-xs break-all">{PANEL_ACCOUNT.uuid}</span>
                      <Button variant="ghost" size="icon-xs" aria-label="复制 UUID" onClick={() => void copy(PANEL_ACCOUNT.uuid, "UUID 已复制")}>
                        <Copy />
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </Section>

      <Wallet />

      <Section label="Telegram">
        <Card>
          <CardContent>
            <Item size="default" className="p-0">
              <ItemMedia variant="icon" className="size-9 rounded-lg border bg-background">
                <Send />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Telegram</ItemTitle>
                <ItemDescription>{telegramBound ? `Telegram ID ${PANEL_ACCOUNT.telegramId} · 可通过 AeraNexaBot 查询订阅、流量、余额、订单与工单。` : "尚未绑定。绑定后可在 Bot 内查询订阅、流量、余额、订单与工单。"}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {telegramBound ? (
                  <>
                    <Badge variant="secondary">已绑定</Badge>
                    <Button variant="outline" onClick={() => setConfirm("unbind")}>
                      解绑
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setTelegramOpen(true)}>
                    绑定
                  </Button>
                )}
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
      </Section>

      <Section
        label="我的设备"
        description={limit > 0 ? `当前套餐最多 ${limit} 台设备同时在线（按网络地址计）。` : "当前套餐不限设备数量。"}
        actions={
          devices.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setConfirm("removeAll")}>
              全部移除
            </Button>
          ) : undefined
        }
      >
        {limit > 0 && (
          <Card>
            <CardContent className="space-y-2">
              <UsageMeter label="已登记设备" figure={`${devices.length} / ${limit}`} value={(devices.length / limit) * 100} tone="ink" />
              <p className="text-sm text-muted-foreground text-pretty">上报设备标识的客户端（如 Happ、v2RayTun）会在这里登记并占用设备名额，名额已满时新设备将无法获取节点，可移除不再使用的设备。</p>
            </CardContent>
          </Card>
        )}
        {devices.length > 0 ? (
          <DataTable columns={registered} rows={devices} rowKey={(device) => String(device.id)} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>没有已登记的设备</EmptyTitle>
              <EmptyDescription>设备下次更新订阅时会重新登记并占用名额。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Section>

      <Section label="最近 30 天订阅拉取" description="按客户端和网络地址合并，仅供参考：同一台设备换网络会显示成多条，同一网络下的多台设备可能合并成一条。">
        <DataTable columns={pulls} rows={PULLS} rowKey={(pull) => `${pull.client}|${pull.ip}`} empty="最近 30 天还没有客户端拉取过订阅" />
      </Section>

      <div id="change-password" className="scroll-mt-6">
        <Section label="修改登入密码">
          <Card>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        </Section>
      </div>

      <TelegramDialog open={telegramOpen} onOpenChange={setTelegramOpen} />

      <AlertDialog open={confirm === "unbind"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解除 Telegram 绑定？</AlertDialogTitle>
            <AlertDialogDescription>解绑后 Bot 将不能继续查询该账户或接收提醒；后续可重新绑定。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setTelegramBound(false);
                setConfirm(null);
                toast.success("Telegram 已解绑");
              }}
            >
              确认解绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "removeAll"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除全部设备？</AlertDialogTitle>
            <AlertDialogDescription>移除后，各设备下次更新订阅时会重新登记并占用名额。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                removeDevice();
                setConfirm(null);
                toast.success("已移除全部设备");
              }}
            >
              全部移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/** Nickname (1 to 50 characters) and avatar. */
function ProfileForm() {
  const { nickname, setNickname, avatar, setAvatar } = usePanelState();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? nickname;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed.length < 1 || trimmed.length > 50) return setError("昵称长度需在 1 到 50 个字符之间");
        setError(null);
        setNickname(trimmed);
        setDraft(null);
        toast.success("昵称已更新");
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>头像</FieldLabel>
          <div className="flex items-center gap-4">
            <UserAvatar avatar={avatar} name={nickname} size="lg" className="size-14" />
            <ToggleGroup value={[avatar]} onValueChange={(next) => next[0] && setAvatar(next[0] as typeof avatar)} spacing={2} className="flex-wrap" aria-label="头像">
              {AVATARS.map((item) => (
                <ToggleGroupItem key={item.id} value={item.id} aria-label={item.label} className="size-9 rounded-full p-0.5 data-[pressed]:bg-transparent data-[pressed]:ring-2 data-[pressed]:ring-foreground data-[pressed]:ring-offset-2 data-[pressed]:ring-offset-card aria-pressed:bg-transparent">
                  <UserAvatar avatar={item.id} size="lg" className="size-full" />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </Field>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="nickname">昵称</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="nickname"
              value={value}
              maxLength={50}
              placeholder="设置一个昵称"
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
            />
            <Button type="submit" disabled={value.trim() === nickname}>
              保存
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
    </form>
  );
}

/** Balance, card-code top-up, and the statement. */
function Wallet() {
  const { balance, commission, wallet, redeem } = usePanelState();
  const [code, setCode] = useState("");

  const columns: Column<WalletTx>[] = [
    { key: "time", header: "时间", hideBelow: "sm", cell: (item) => formatTime(item.at), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    { key: "description", header: "说明", cell: (item) => item.description },
    { key: "amount", header: "变动", align: "right", cell: (item) => `${item.amount >= 0 ? "+" : "-"}${yuan(Math.abs(item.amount))}`, className: "tabular-nums" },
    { key: "after", header: "余额", align: "right", hideBelow: "sm", cell: (item) => yuan(item.balanceAfter), className: "tabular-nums text-muted-foreground" },
  ];

  return (
    <Section label="余额" description="输入管理员发放的卡密后，余额即时到账，可在收银台选择「账户余额」支付。">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="可用余额" value={yuan(balance)} />
        <StatCard label="佣金余额" value={yuan(commission)} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!code.trim()) return toast.warning("请输入卡密");
          const credited = redeem(code);
          if (credited === null) return toast.error("卡密无效或已使用");
          setCode("");
          toast.success(`充值成功，已到账 ${yuan(credited)}`);
        }}
      >
        <InputGroup>
          <InputGroupInput aria-label="卡密" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 ANX-ABCD-EFGH-IJKM-NPQR-STUV" autoComplete="off" maxLength={128} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="outline" disabled={!code.trim()}>
              充值
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-1.5 text-xs text-muted-foreground">演示可用卡密：ANX-DEMO-0000-1111-2222-3333</p>
      </form>
      <DataTable columns={columns} rows={wallet} rowKey={(item) => String(item.id)} empty="暂无余额流水" />
    </Section>
  );
}

function PasswordForm() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clear = (key: string) => errors[key] && setErrors((current) => ({ ...current, [key]: "" }));

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const next: Record<string, string> = {};
        if (!oldPassword) next.old = "请输入当前密码";
        if (newPassword.length < PASSWORD_MIN) next.new = `新密码长度不能少于 ${PASSWORD_MIN} 位`;
        else if (newPassword.length > PASSWORD_MAX) next.new = `新密码长度不能超过 ${PASSWORD_MAX} 位`;
        else if (!newPassword.trim()) next.new = "新密码不能为空白字符";
        else if (newPassword === oldPassword) next.new = "新密码不能与旧密码相同";
        if (newPassword !== rePassword) next.re = "两次输入的新密码不一致";
        setErrors(next);
        if (Object.keys(next).length) return;
        setOldPassword("");
        setNewPassword("");
        setRePassword("");
        toast.success("演示：密码已更新。真实环境里所有设备的登录会失效，需要重新登录。");
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.old ? true : undefined}>
          <FieldLabel htmlFor="old-password">当前密码</FieldLabel>
          <Input id="old-password" type="password" autoComplete="current-password" value={oldPassword} aria-invalid={errors.old ? true : undefined} onChange={(event) => { setOldPassword(event.target.value); clear("old"); }} />
          {errors.old && <FieldError>{errors.old}</FieldError>}
        </Field>
        <Field data-invalid={errors.new ? true : undefined}>
          <FieldLabel htmlFor="new-password">新密码</FieldLabel>
          <Input id="new-password" type="password" autoComplete="new-password" placeholder={`至少 ${PASSWORD_MIN} 位`} value={newPassword} aria-invalid={errors.new ? true : undefined} onChange={(event) => { setNewPassword(event.target.value); clear("new"); }} />
          {errors.new && <FieldError>{errors.new}</FieldError>}
        </Field>
        <Field data-invalid={errors.re ? true : undefined}>
          <FieldLabel htmlFor="re-password">确认新密码</FieldLabel>
          <Input id="re-password" type="password" autoComplete="new-password" value={rePassword} aria-invalid={errors.re ? true : undefined} onChange={(event) => { setRePassword(event.target.value); clear("re"); }} />
          {errors.re && <FieldError>{errors.re}</FieldError>}
        </Field>
        <Field>
          <div>
            <Button type="submit">更新密码</Button>
          </div>
          <FieldDescription>修改密码后所有设备上的登录会话都会失效，需要重新登录。</FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
