import { Fragment, type ReactNode } from "react";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";

/**
 * Label and value rows, for order and account details. shadcn has no description list, so this is the
 * one composition of ours: a <dl> with a Separator between rows. Values are right-aligned.
 */
export function KeyValueList({ items, className }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; className?: string }) {
  const rows = items.filter((item) => !item.hidden);
  return (
    <dl className={cn("text-sm", className)}>
      {rows.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <Separator />}
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 text-right">{item.value}</dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}
