import type { ComponentProps } from "react";
import styles from "./skeleton.module.css";

// The site's loading placeholder (the admin area keeps shadcn's own, in
// components/ui/skeleton.tsx, which needs the admin's Tailwind styles).
// Same shape as shadcn's: a div you size yourself, e.g.
//   <Skeleton style={{ width: 160, height: 20 }} />
export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={`${styles.skeleton} ${className}`.trim()} {...props} />;
}
