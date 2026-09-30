"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_AVATAR, type AvatarId } from "@/components/aera/avatars";
import { DEMO_SITE } from "@/lib/demo-site/flag";
import { CURRENT_SUBSCRIPTION, DEVICES, INVITE_CODES, ORDERS, PANEL_ACCOUNT, PANEL_NOW, PANEL_USER, RECHARGE_CODES, STAFF_REPLY, TICKETS, WALLET_TXS, type Device, type InviteCode, type Order, type Ticket, type TicketLevel, type WalletTx } from "@/lib/demo/panel-mock";

// What the pages of the panel demo share. In the app it is in memory only: reloading starts over. In the demo site
// it is kept in the visitor's localStorage, one record per account, so a reload (or a later visit) carries on.

type NewOrder = Pick<Order, "planId" | "planName" | "transferGb" | "periodLabel" | "subtotal" | "discount" | "total">;

type PanelState = {
  /** The login email shown on the profile page. */
  email: string;
  /** Drops what this account has done and starts from the seeded demo data again. */
  resetData: () => void;

  telegramBound: boolean;
  setTelegramBound: (bound: boolean) => void;

  nickname: string;
  setNickname: (nickname: string) => void;
  avatar: AvatarId;
  setAvatar: (avatar: AvatarId) => void;

  /** Cents. */
  balance: number;
  wallet: WalletTx[];
  /** Redeems a card code; returns the cents credited, or null if the code is not valid. */
  redeem: (code: string) => number | null;

  /** Commission that can be moved to the balance, in cents. */
  commission: number;
  /** Moves commission to the balance (and into the statement). */
  transferCommission: (cents: number) => void;
  inviteCodes: InviteCode[];
  generateCode: (options: { maxUses?: number; days?: number }) => string;
  /** Toggles a code between usable (0) and stopped (1). */
  toggleCode: (id: number) => void;

  devices: Device[];
  /** Removes one registered device, or all of them when no id is given. */
  removeDevice: (id?: number) => void;

  tickets: Ticket[];
  /** Opens a ticket with its first message and returns its id. */
  createTicket: (ticket: { subject: string; level: TicketLevel; message: string }) => number;
  /** Adds the user's message; the demo's staff answer is added by `staffReply`. */
  replyTicket: (id: number, text: string) => void;
  staffReply: (id: number) => void;
  closeTicket: (id: number) => void;

  orders: Order[];
  /** The unpaid order, if any: an account may only have one at a time. */
  pendingOrder: Order | undefined;
  /** Creates an unpaid order and returns its number. */
  createOrder: (order: NewOrder) => string;
  cancelOrder: (tradeNo: string) => void;
  /** Marks an order paid: done if it is for the plan in force (or there is none), queued behind it otherwise. */
  payOrder: (tradeNo: string) => void;
  /** Takes a queued order into force now. */
  activateOrder: (tradeNo: string) => void;
};

const Context = createContext<PanelState | null>(null);

export function usePanelState() {
  const value = useContext(Context);
  if (!value) throw new Error("usePanelState needs <PanelStateProvider>");
  return value;
}

type Saved = {
  telegramBound: boolean;
  nickname: string;
  avatar: AvatarId;
  wallet: WalletTx[];
  devices: Device[];
  commission: number;
  inviteCodes: InviteCode[];
  orders: Order[];
  tickets: Ticket[];
};

const STORAGE_PREFIX = "aeranexa-demo-state-v1:";

function load(email: string): Partial<Saved> {
  if (!DEMO_SITE) return {};
  try {
    return (JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + email) ?? "null") as Partial<Saved> | null) ?? {};
  } catch {
    return {};
  }
}

/** `account` is who is signed in (the demo site); without it the panel shows the seeded user and keeps nothing. */
export function PanelStateProvider({ children, account }: { children: ReactNode; account?: { email: string; nickname: string } }) {
  const email = account?.email ?? PANEL_ACCOUNT.email;
  // Only ever mounted in the browser in the demo site (DemoGate renders nothing before the session is known), so localStorage can be read here.
  const [saved] = useState(() => (account ? load(account.email) : {}));
  const [telegramBound, setTelegramBound] = useState(saved.telegramBound ?? false);
  const [nickname, setNickname] = useState<string>(saved.nickname ?? account?.nickname ?? PANEL_USER.name);
  const [avatar, setAvatar] = useState<AvatarId>(saved.avatar ?? PANEL_USER.avatar ?? DEFAULT_AVATAR);
  const [wallet, setWallet] = useState<WalletTx[]>(saved.wallet ?? WALLET_TXS);
  const [devices, setDevices] = useState<Device[]>(saved.devices ?? DEVICES);
  const [commission, setCommission] = useState<number>(saved.commission ?? PANEL_ACCOUNT.commission);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>(saved.inviteCodes ?? INVITE_CODES);
  const [orders, setOrders] = useState<Order[]>(saved.orders ?? ORDERS);
  const [tickets, setTickets] = useState<Ticket[]>(saved.tickets ?? TICKETS);

  useEffect(() => {
    if (!DEMO_SITE || !account) return;
    const record: Saved = { telegramBound, nickname, avatar, wallet, devices, commission, inviteCodes, orders, tickets };
    try {
      window.localStorage.setItem(STORAGE_PREFIX + account.email, JSON.stringify(record));
    } catch {
      // Storage full or blocked: the page still works, it just will not survive a reload.
    }
  }, [account, telegramBound, nickname, avatar, wallet, devices, commission, inviteCodes, orders, tickets]);

  const patch = useCallback((tradeNo: string, change: Partial<Order>) => setOrders((list) => list.map((item) => (item.tradeNo === tradeNo ? { ...item, ...change } : item))), []);

  const value = useMemo<PanelState>(() => {
    const clock = () => PANEL_NOW.getTime() + 60_000 * (orders.length - ORDERS.length + 1);
    return {
      email,
      resetData: () => {
        try {
          window.localStorage.removeItem(STORAGE_PREFIX + email);
        } catch {
          // Nothing saved to drop.
        }
        window.location.reload();
      },
      telegramBound,
      setTelegramBound,
      nickname,
      setNickname,
      avatar,
      setAvatar,
      balance: wallet[0]?.balanceAfter ?? PANEL_ACCOUNT.balance,
      wallet,
      redeem: (code) => {
        const credit = RECHARGE_CODES[code.trim().toUpperCase()];
        if (!credit) return null;
        const balanceAfter = (wallet[0]?.balanceAfter ?? PANEL_ACCOUNT.balance) + credit;
        setWallet((list) => [{ id: list.length + 1, at: clock(), description: "卡密充值", amount: credit, balanceAfter }, ...list]);
        return credit;
      },
      commission,
      transferCommission: (cents) => {
        setCommission((value) => value - cents);
        const balanceAfter = (wallet[0]?.balanceAfter ?? PANEL_ACCOUNT.balance) + cents;
        setWallet((list) => [{ id: list.length + 1, at: clock(), description: "佣金划转到余额", amount: cents, balanceAfter }, ...list]);
      },
      inviteCodes,
      generateCode: ({ maxUses, days }) => {
        const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
        const createdAt = clock();
        setInviteCodes((list) => [{ id: Math.max(0, ...list.map((item) => item.id)) + 1, code, pv: 0, used: 0, maxUses: maxUses ?? null, expiresAt: days ? createdAt + days * 86_400_000 : null, status: 0, createdAt }, ...list]);
        return code;
      },
      toggleCode: (id) => setInviteCodes((list) => list.map((item) => (item.id === id ? { ...item, status: item.status === 0 ? 1 : 0 } : item))),
      devices,
      removeDevice: (id) => setDevices((list) => (id === undefined ? [] : list.filter((item) => item.id !== id))),
      tickets,
      createTicket: ({ subject, level, message }) => {
        const id = Math.max(0, ...tickets.map((item) => item.id)) + 1;
        const at = clock();
        setTickets((list) => [{ id, subject, level, status: 0, replied: false, createdAt: at, updatedAt: at, messages: [{ id: 1, mine: true, text: message, at }] }, ...list]);
        return id;
      },
      replyTicket: (id, text) => {
        const at = clock();
        setTickets((list) => list.map((item) => (item.id === id ? { ...item, replied: false, updatedAt: at, messages: [...item.messages, { id: item.messages.length + 1, mine: true, text, at }] } : item)));
      },
      staffReply: (id) => {
        const at = clock() + 60_000;
        setTickets((list) => list.map((item) => (item.id === id ? { ...item, replied: true, updatedAt: at, messages: [...item.messages, { id: item.messages.length + 1, mine: false, text: STAFF_REPLY, at }] } : item)));
      },
      closeTicket: (id) => setTickets((list) => list.map((item) => (item.id === id ? { ...item, status: 1, updatedAt: clock() } : item))),
      orders,
      pendingOrder: orders.find((item) => item.status === 0),
      createOrder: (draft) => {
        const tradeNo = `20260326${String(100 + orders.length).padStart(5, "0")}`;
        const createdAt = clock();
        const type = draft.planId === CURRENT_SUBSCRIPTION.planId ? "续费" : "新购";
        setOrders((list) => [{ ...draft, tradeNo, type, status: 0, surplus: 0, refund: 0, createdAt, payDeadline: createdAt + 30 * 60_000 }, ...list]);
        return tradeNo;
      },
      cancelOrder: (tradeNo) => patch(tradeNo, { status: 2, cancelReason: "user", cancelledAt: clock(), payDeadline: undefined }),
      payOrder: (tradeNo) => {
        const target = orders.find((item) => item.tradeNo === tradeNo);
        if (!target) return;
        patch(tradeNo, { status: target.planId === CURRENT_SUBSCRIPTION.planId ? 3 : 1, paidAt: clock(), payDeadline: undefined });
      },
      activateOrder: (tradeNo) => patch(tradeNo, { status: 3 }),
    };
  }, [email, telegramBound, nickname, avatar, wallet, devices, commission, inviteCodes, tickets, orders, patch]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
