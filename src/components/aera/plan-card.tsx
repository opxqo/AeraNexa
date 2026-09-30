import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/** A plan, compact: name and price on one line, a sentence, then the action. */
export function PlanCard({ name, price, current, text, action }: { name: ReactNode; price: ReactNode; current?: boolean; text?: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-medium tracking-tight">{name}</span>
          {current && <Badge variant="secondary">Current</Badge>}
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">{price}</span>
        </div>
        {text && <p className="text-sm text-muted-foreground text-pretty">{text}</p>}
        {action && <div className="mt-auto pt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}
