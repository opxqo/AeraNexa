import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

/**
 * Page layout primitives. The shell decides the width and margins; a page is just a stack.
 * Every page in the app is:
 *
 *   <Page>
 *     <PageHeader title description actions />
 *     <Section label> ...cards... </Section>
 *   </Page>
 *
 * so spacing, widths and heading sizes are decided here once, not per page.
 */

export function Page({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex w-full flex-col gap-6", className)} {...props} />;
}

export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-medium tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled group of cards. The label is the small caption above the group. */
export function Section({ label, description, actions, children, className }: { label?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {(label || actions) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {label && <h2 className="text-sm font-medium">{label}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A row inside a card: title and helper text on the left, the control on the right. Stacks on
 * narrow containers.
 */
export function SettingRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("@container/row", className)}>
      <div className="flex flex-col gap-3 @md/row:flex-row @md/row:items-center @md/row:justify-between @md/row:gap-6">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">{title}</div>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
