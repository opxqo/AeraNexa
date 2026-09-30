"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { usePanelState } from "./state";

/** Copies text to the clipboard and says so (or says it failed). */
export async function copy(text: string, done = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("复制失败，请手动选择复制");
  }
}

/** Two steps: message the bot, then send it a one-time code. */
export function TelegramDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { setTelegramBound } = usePanelState();
  const [code, setCode] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setCode(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定 Telegram</DialogTitle>
          <DialogDescription>绑定码只可使用一次，10 分钟内有效。</DialogDescription>
        </DialogHeader>
        <ol className="space-y-4 text-sm">
          <li className="space-y-1.5">
            <div className="font-medium">第一步</div>
            <p className="text-muted-foreground">
              在 Telegram 中搜索并私聊机器人 <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">@AeraNexaBot</code>
            </p>
          </li>
          <li className="space-y-2">
            <div className="font-medium">第二步</div>
            <p className="text-muted-foreground">生成绑定码后，向机器人发送下面的指令。</p>
            {code ? (
              <InputGroup>
                <InputGroupInput readOnly aria-label="绑定指令" value={`/bind ${code}`} className="font-mono" onFocus={(event) => event.currentTarget.select()} />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton variant="outline" onClick={() => void copy(`/bind ${code}`, "绑定指令已复制")}>
                    <Copy />
                    复制
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <Button variant="outline" onClick={() => setCode(Math.random().toString(36).slice(2, 10).toUpperCase())}>
                生成绑定码
              </Button>
            )}
          </li>
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            稍后再说
          </Button>
          <Button
            disabled={!code}
            onClick={() => {
              setTelegramBound(true);
              onOpenChange(false);
              setCode(null);
              toast.success("演示：已标记为绑定成功。");
            }}
          >
            我已发送指令
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
