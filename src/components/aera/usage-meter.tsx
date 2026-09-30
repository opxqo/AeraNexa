import type { ReactNode } from "react";
import { cn } from "cn";
import { Progress } from "@/components/ui/progress";

const TONES = {
  brand: "[&_[data-slot=progress-indicator]]:bg-brand",
  blue: "[&_[data-slot=progress-indicator]]:bg-chart-2",
  ink: "[&_[data-slot=progress-indicator]]:bg-primary",
  warn: "[&_[data-slot=progress-indicator]]:bg-warning",
} as const;

/** A labelled bar: what it measures on the left, the figure on the right, an optional note below. */
export function UsageMeter({ label, figure, value, tone = "brand", note, className }: { label: ReactNode; figure: ReactNode; value: number; tone?: keyof typeof TONES; note?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{figure}</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, value))} className={cn("gap-0 [&_[data-slot=progress-track]]:h-2", TONES[tone])} />
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
