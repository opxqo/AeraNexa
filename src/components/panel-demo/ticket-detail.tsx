"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Lock, RotateCcw, SearchX } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/aera/avatars";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { BrandMark } from "@/components/brand-mark";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Message, MessageAvatar, MessageContent, MessageGroup, MessageHeader } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_LEVELS } from "@/lib/demo/panel-mock";
import { BASE } from "./nav";
import { formatTime } from "./order-status";
import { usePanelState } from "./state";

const STAFF_DELAY_MS = 1800;

export function TicketDetailPage({ id }: { id: number }) {
  const { tickets, nickname, avatar, replyTicket, staffReply, closeTicket } = usePanelState();
  const ticket = tickets.find((item) => item.id === id);
  const [reply, setReply] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [closing, setClosing] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // New messages scroll the thread to the bottom, so a reply never looks unsent.
  const count = ticket?.messages.length ?? 0;
  useEffect(() => {
    const node = thread.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count, waiting]);

  if (!ticket) {
    return (
      <Page>
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>找不到这张工单</EmptyTitle>
            <EmptyDescription>工单 #{id} 不存在，或不属于当前账户。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/ticket`} />}>
              返回工单列表
            </Button>
          </EmptyContent>
        </Empty>
      </Page>
    );
  }

  const open = ticket.status === 0;
  const send = () => {
    const text = reply.trim();
    if (!text) return toast.warning("请输入回复内容");
    replyTicket(ticket.id, text);
    setReply("");
    toast.success("回复已发送");
    // The real page waits for staff; the demo has staff answer after a beat.
    setWaiting(true);
    timer.current = setTimeout(() => {
      staffReply(ticket.id);
      setWaiting(false);
    }, STAFF_DELAY_MS);
  };

  return (
    <Page>
      <PageHeader
        title={ticket.subject}
        description={`工单 #${ticket.id} · ${open ? "处理中" : "已关闭"} · 优先级 ${TICKET_LEVELS[ticket.level]}`}
        actions={
          <>
            <Button variant="outline" onClick={() => toast("演示：已是最新。")}>
              <RotateCcw data-icon="inline-start" />
              刷新
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/ticket`} />}>
              返回工单列表
            </Button>
            {open && (
              <Button variant="ghost" onClick={() => setClosing(true)}>
                关闭工单
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardContent>
          <div ref={thread} className="max-h-[60vh] overflow-y-auto pr-1">
            <MessageGroup className="gap-5">
              {ticket.messages.map((item) => (
                <Message key={item.id} align={item.mine ? "end" : "start"}>
                  <MessageAvatar className="size-8 min-w-8 self-start bg-transparent">
                    {item.mine ? <UserAvatar avatar={avatar} name={nickname} size="default" /> : <span className="grid size-8 place-items-center rounded-full border bg-background"><BrandMark size={16} /></span>}
                  </MessageAvatar>
                  <MessageContent>
                    <MessageHeader className={item.mine ? "justify-end gap-2 px-0" : "gap-2 px-0"}>
                      <span className="text-foreground">{item.mine ? "我" : "客服"}</span>
                      <span className="font-normal tabular-nums">{formatTime(item.at)}</span>
                    </MessageHeader>
                    <Bubble variant={item.mine ? "default" : "muted"} align={item.mine ? "end" : "start"}>
                      <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              ))}
              {waiting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  客服正在回复…
                </div>
              )}
            </MessageGroup>
          </div>
        </CardContent>
      </Card>

      {open ? (
        <Card>
          <CardContent className="space-y-3">
            <Textarea aria-label="补充回复" rows={3} placeholder="补充问题或反馈" value={reply} onChange={(event) => setReply(event.target.value)} />
            <div className="flex gap-2">
              <Button disabled={!reply.trim() || waiting} onClick={send}>
                发送回复
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lock />
            </EmptyMedia>
            <EmptyTitle>该工单已关闭</EmptyTitle>
            <EmptyDescription>如需继续沟通，请新建工单。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/ticket`} />}>
              返回工单列表
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定关闭该工单？</AlertDialogTitle>
            <AlertDialogDescription>关闭后将无法继续回复，如问题仍未解决请重新提交工单。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                clearTimeout(timer.current);
                setWaiting(false);
                closeTicket(ticket.id);
                setClosing(false);
                toast.success("工单已关闭");
              }}
            >
              确定关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
