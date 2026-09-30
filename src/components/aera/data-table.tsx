import type { ReactNode } from "react";
import { cn } from "cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  /** Hide the column below this breakpoint. Put the least important columns last and hide them first. */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
};

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden", xl: "max-xl:hidden", "2xl": "max-2xl:hidden" } as const;

/**
 * The one table of the app: shadcn Table with our column model. The Table scrolls sideways on its
 * own when the columns do not fit, so a page never gets a horizontal scrollbar.
 */
export function DataTable<T>({ columns, rows, rowKey, empty = "No results.", footer, className }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column.key} className={cn("h-10 px-4 text-xs font-medium text-muted-foreground max-sm:px-2.5", ALIGN[column.align ?? "left"], column.hideBelow && HIDE[column.hideBelow], column.className)}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-24 px-4 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={cn("px-4 py-2.5 max-sm:px-2.5", ALIGN[column.align ?? "left"], column.hideBelow && HIDE[column.hideBelow], column.className)}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {footer && <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}
