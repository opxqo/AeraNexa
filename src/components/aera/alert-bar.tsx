import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** A one-line banner with its action on the right (under the text on phones). */
export function AlertBar({ icon, title, description, action, variant }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; variant?: "default" | "destructive" }) {
  return (
    <Alert variant={variant} className={action ? "sm:pr-40" : undefined}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
      {action && <AlertAction className="static col-start-2 mt-2 sm:absolute sm:top-1/2 sm:right-3 sm:mt-0 sm:-translate-y-1/2">{action}</AlertAction>}
    </Alert>
  );
}
