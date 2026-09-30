"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/aera/data-table";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_LEVELS, type Ticket, type TicketLevel } from "@/lib/demo/panel-mock";
import { ticketHref } from "./nav";
import { formatTime } from "./order-status";
import { usePanelState } from "./state";

/** 高 is the only priority that gets the dark badge. */
export function LevelBadge({ level }: { level: TicketLevel }) {
  return <Badge variant={level === 2 ? "default" : level === 1 ? "secondary" : "outline"}>{TICKET_LEVELS[level]}</Badge>;
}

export function TicketStatusBadge({ ticket }: { ticket: Pick<Ticket, "status" | "replied"> }) {
  if (ticket.status === 1) return <Badge variant="outline" className="text-muted-foreground">已关闭</Badge>;
  return ticket.replied ? (
    <Badge variant="secondary">已回复</Badge>
  ) : (
    <Badge variant="outline">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      待处理
    </Badge>
  );
}

const LEVEL_OPTIONS = [
  { value: "0", label: "低（一般性咨询）" },
  { value: "1", label: "中（功能异常）" },
  { value: "2", label: "高（严重影响使用）" },
];

export function TicketPage() {
  const { tickets } = usePanelState();
  const [filter, setFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);

  const count = (status: number | "all") => tickets.filter((ticket) => status === "all" || ticket.status === status).length;
  const rows = tickets.filter((ticket) => filter === "all" || String(ticket.status) === filter);

  const columns: Column<Ticket>[] = [
    { key: "id", header: "工单号", cell: (ticket) => `#${ticket.id}`, className: "font-mono text-[13px] text-muted-foreground" },
    {
      key: "subject",
      header: "主题",
      cell: (ticket) => (
        <Link href={ticketHref(ticket.id)} className="font-medium underline-offset-4 hover:underline">
          {ticket.subject}
        </Link>
      ),
    },
    { key: "level", header: "优先级", hideBelow: "sm", cell: (ticket) => <LevelBadge level={ticket.level} /> },
    { key: "status", header: "状态", cell: (ticket) => <TicketStatusBadge ticket={ticket} /> },
    { key: "updated", header: "更新时间", hideBelow: "xl", cell: (ticket) => formatTime(ticket.updatedAt), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
  ];

  return (
    <Page>
      <PageHeader
        title="我的工单"
        description="联系技术支持"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            新建工单
          </Button>
        }
      />

      <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
        <TabsList variant="line">
          <TabsTrigger value="all">全部 {count("all")}</TabsTrigger>
          <TabsTrigger value="0">处理中 {count(0)}</TabsTrigger>
          <TabsTrigger value="1">已关闭 {count(1)}</TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(ticket) => String(ticket.id)}
        empty={
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyTitle>{filter === "all" ? "您当前没有工单记录" : "该状态下暂无工单"}</EmptyTitle>
              <EmptyDescription>遇到网络问题可随时点击右上角新建工单。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      {creating && <NewTicketDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}

function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { createTicket } = usePanelState();
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("1");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});

  const submit = () => {
    const next: typeof errors = {};
    if (subject.trim().length < 2) next.subject = "工单主题至少 2 个字符";
    if (subject.trim().length > 255) next.subject = "工单主题不能超过 255 个字符";
    if (message.trim().length < 5) next.message = "请至少填写 5 个字符的问题描述";
    setErrors(next);
    if (Object.keys(next).length) return;
    const id = createTicket({ subject: subject.trim(), level: Number(level) as TicketLevel, message: message.trim() });
    toast.success("工单已提交，技术支持将尽快处理");
    onClose();
    router.push(ticketHref(id));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>请尽可能详细提供您的客户端平台、节点名称及报错提示，我们会更快定位问题。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={errors.subject ? true : undefined}>
            <FieldLabel htmlFor="ticket-subject">工单主题</FieldLabel>
            <Input
              id="ticket-subject"
              placeholder="简要概括您遇到的问题"
              maxLength={255}
              value={subject}
              aria-invalid={errors.subject ? true : undefined}
              onChange={(event) => {
                setSubject(event.target.value);
                if (errors.subject) setErrors((current) => ({ ...current, subject: undefined }));
              }}
            />
            {errors.subject && <FieldError>{errors.subject}</FieldError>}
          </Field>
          <Field>
            <FieldLabel>优先级</FieldLabel>
            <Select items={LEVEL_OPTIONS} value={level} onValueChange={(value) => value && setLevel(value)}>
              <SelectTrigger className="w-full" aria-label="优先级">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={errors.message ? true : undefined}>
            <FieldLabel htmlFor="ticket-message">详细描述</FieldLabel>
            <Textarea
              id="ticket-message"
              rows={4}
              placeholder="发生了什么？在哪个客户端、哪条线路上？"
              value={message}
              aria-invalid={errors.message ? true : undefined}
              onChange={(event) => {
                setMessage(event.target.value);
                if (errors.message) setErrors((current) => ({ ...current, message: undefined }));
              }}
            />
            {errors.message && <FieldError>{errors.message}</FieldError>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>立即提交</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
