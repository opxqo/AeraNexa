"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Applies the Aera design tokens (src/styles/aera.css) to its subtree.
 *
 * Base UI renders popovers, menus and dialogs in a portal on <body>, outside this element, so the
 * scope class is also put on <body> while the scope is mounted. Without that, portalled surfaces
 * would lose their colours.
 */
export function AeraScope({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => {
    document.body.classList.add("aera");
    return () => document.body.classList.remove("aera");
  }, []);
  return <div className={cn("aera", className)}>{children}</div>;
}
