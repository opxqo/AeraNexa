import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { cn } from "cn";

/**
 * A price card after GitBook's pricing page, measured at 1920 wide: 16px radius, 1px hairline border on a
 * warm off-white, 34px top and 24px side padding, 16px between blocks, a pill button at the bottom.
 * The highlighted card is white with a brand-coloured border and a dark button. It is deliberately plain:
 * the marketing site's price cards are the decorated ones.
 */
export function PricingCard({
  name,
  tagline,
  corner,
  highlighted,
  price,
  unit,
  meta,
  aside,
  lead,
  features,
  action,
  footer,
  className,
}: {
  name: ReactNode;
  tagline: ReactNode;
  /** The small label in the top-right corner. */
  corner?: ReactNode;
  highlighted?: boolean;
  /** The big figure, with its currency sign: e.g. ["¥", "19.8"], or a word such as "定制". */
  price: ReactNode;
  /** The small text after the figure. */
  unit?: ReactNode;
  /** The line under the price. */
  meta?: ReactNode;
  /** Sits at the right of the price row (a 36px square). */
  aside?: ReactNode;
  /** "All X features plus:" */
  lead?: ReactNode;
  features: ReactNode[];
  action: ReactNode;
  /** Under the button: the "Trusted by" row of the reference (here, the services the plan unlocks). */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-4 self-start rounded-[16px] px-6 pt-[34px] pb-6 text-stone-900 after:pointer-events-none after:absolute after:inset-0 after:rounded-[16px] after:border after:border-hairline",
        highlighted ? "bg-white after:border-brand" : "bg-stone-50",
        className,
      )}
    >
      {corner && <div className="absolute top-2.5 right-3 text-xs">{corner}</div>}

      <div className="space-y-1">
        <h3 className="text-xl/[26px] font-medium">{name}</h3>
        <p className="text-sm/[22.4px] text-stone-500">{tagline}</p>
      </div>

      <div className="relative min-h-[60px]">
        <div className="flex items-baseline gap-1 pr-10">
          <span className="text-[30px]/9 font-medium tracking-tight tabular-nums">{price}</span>
          {unit && <span className="text-xs/[19.2px] text-stone-500">{unit}</span>}
        </div>
        {meta && <div className="text-xs/6 text-stone-500">{meta}</div>}
        {aside && <div className="absolute top-0 right-0">{aside}</div>}
      </div>

      <div className="space-y-2">
        {lead && <p className="text-sm/[22.4px]">{lead}</p>}
        <ul className="space-y-2">
          {features.map((feature, index) => (
            <li key={index} className="flex gap-1.5 text-sm/[22.4px] text-stone-500">
              <CircleCheck className="mt-[3.7px] size-[15px] shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {action}
      {footer}
    </div>
  );
}
