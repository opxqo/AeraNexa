import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/** A number with a caption. Used in rows of 2 to 4 at the top of a page or inside a card. */
export function StatCard({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-medium tabular-nums tracking-tight">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** The same thing without a card, for use inside one. */
export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
