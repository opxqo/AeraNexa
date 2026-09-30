import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS, type OrderStatus } from "@/lib/demo/panel-mock";

/** ¥ amounts without trailing zeros: 1250 cents -> "12.5". */
export const yuan = (cents: number) => `¥${Number((cents / 100).toFixed(2))}`;

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-03-26 10:20" */
export function formatTime(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The order state as a shadcn Badge: a coloured dot for states that still need attention, plain otherwise. */
const STATUS_LOOK: Record<OrderStatus, { variant: "outline" | "secondary"; dot?: string; muted?: boolean }> = {
  0: { variant: "outline", dot: "bg-warning" },
  1: { variant: "outline", dot: "bg-chart-2" },
  2: { variant: "secondary", muted: true },
  3: { variant: "secondary" },
  4: { variant: "outline" },
  5: { variant: "outline" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <Badge variant={look.variant} className={look.muted ? "text-muted-foreground" : undefined}>
      {look.dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${look.dot}`} />}
      {ORDER_STATUS[status]}
    </Badge>
  );
}
