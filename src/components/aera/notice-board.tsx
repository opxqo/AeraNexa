"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { flapCellPitch, SplitFlapDisplay } from "@/components/ui/split-flap-display";

export type Notice = { id: number; title: string; date: string; content: string };

const STORAGE_KEY = "aera-panel-dismissed-notices";
const CHANGE_EVENT = "aera-notices-changed";
const ROTATE_MS = 6000;

/** A notice counts as the same one until its id or date changes, so an edited notice comes back. */
const signature = (notice: Notice) => `${notice.id}:${notice.date}`;

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}
const readDismissed = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
const readDismissedOnServer = () => null;

function dismiss(notice: Notice, current: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...current, signature(notice)]));
  } catch {
    // Storage blocked: the notice is only hidden until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The announcements strip in the top line of a page: a split-flap board that flips through the notices,
 * pauses under the pointer, opens the full text on click, and lets people remove a notice for good
 * (remembered in this browser). With no notices left it folds away.
 */
export function NoticeBoard({ notices }: { notices: Notice[] }) {
  const stored = useSyncExternalStore(subscribe, readDismissed, readDismissedOnServer);
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Notice | null>(null);

  const removed = useMemo<string[]>(() => {
    try {
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  }, [stored]);
  const visible = useMemo(() => notices.filter((notice) => !removed.includes(signature(notice))), [notices, removed]);
  const current = visible.length > 0 ? visible[index % visible.length] : null;

  useEffect(() => {
    if (visible.length < 2 || paused || open || reduceMotion) return;
    const timer = window.setInterval(() => setIndex((value) => value + 1), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [visible.length, paused, open, reduceMotion]);

  // How many cells fit: measured from the strip itself, with smaller cells on a phone.
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const shown = current !== null;
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    setWidth(node.clientWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  const size = width < 480 ? "xs" : "sm";
  const columns = Math.max(6, Math.floor(width / flapCellPitch(size)));
  const charset = useMemo(() => visible.map((notice) => notice.title).join(""), [visible]);

  const remove = useCallback(() => {
    if (current) dismiss(current, removed);
  }, [current, removed]);

  return (
    <>
      <AnimatePresence initial={false}>
        {current && (
          <motion.div key="notice-board" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div>
              <div
                role="region"
                aria-label="公告"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                className="flex items-center gap-3 rounded-xl bg-primary px-3 py-2 text-primary-foreground"
              >
                <Megaphone className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                <button type="button" onClick={() => setOpen(current)} aria-label={`查看公告全文：${current.title}`} className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <div ref={strip} className="overflow-hidden">
                    <SplitFlapDisplay text={current.title} columns={columns} size={size} charset={charset} animate={!reduceMotion} />
                  </div>
                </button>
                {visible.length > 1 && (
                  <span className="shrink-0 text-xs tabular-nums opacity-60" aria-live="polite">
                    {(index % visible.length) + 1} / {visible.length}
                  </span>
                )}
                <Button variant="ghost" size="icon-sm" onClick={remove} aria-label="移除这条公告" className="shrink-0 text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground">
                  <X />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>发布于 {open?.date}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-pretty">{open?.content}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
