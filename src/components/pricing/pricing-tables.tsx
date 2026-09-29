import { X } from "lucide-react";
import type { Cell, PricingCopy } from "@/lib/pricing-copy";
import { TableIconView } from "./pricing-icons";
import styles from "./pricing-page.module.css";

// A tick: an accent square with a white mark (lightdash.com's is a purple
// checkbox PNG).
function Check() {
  return (
    <svg className={styles.check} viewBox="0 0 19 18" role="img" aria-label="✓">
      <rect width="19" height="18" rx="4" fill="#f45300" />
      <path d="m5.2 9.3 2.9 2.8 5.5-6" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A cross for "not included": a thin grey X (lightdash.com's is a PNG).
function Cross() {
  return <X className={styles.cross} strokeWidth={2.4} role="img" aria-label="✗" />;
}

function CellView({ cell }: { cell: Cell }) {
  if (cell === true) return <Check />;
  if (cell === false) return <Cross />;
  if (typeof cell === "string") return <>{cell}</>;
  return (
    <span className={styles.rich}>
      {cell.rich.map(([text, bold], index) => (bold ? <b key={index}>{text}</b> : <span key={index}>{text}</span>))}
    </span>
  );
}

/** "Compare our plans": four tables, each with a header row that stays at the
 *  top while its table scrolls past. */
export function PricingTables({ copy }: { copy: PricingCopy }) {
  const { compare } = copy;
  return (
    <section aria-labelledby="compare-title">
      <div className={styles.compareHead}>
        <h2 id="compare-title" className={styles.compareTitle}>{compare.title}</h2>
      </div>
      <div className={styles.tables}>
      {compare.tables.map((table) => {
        return (
        <div key={table.title} className={styles.table}>
          <div className={styles.panel}>
            <div className={styles.tableScroll}>
              <div className={`${styles.row} ${styles.rowHead}`} role="row">
                <div className={styles.cellName}><TableIconView name={table.icon} className={styles.titleIcon} aria-hidden="true" />{table.title}</div>
                {compare.planNames.map((name) => <div key={name} className={styles.cell}>{name}</div>)}
              </div>
              {table.rows.map((row) => (
                <div key={row.name} className={styles.row} role="row">
                  <div className={styles.cellName}>
                    {row.tip ? <span className={styles.tip} data-tip={row.tip} tabIndex={0}>{row.name}</span> : row.name}
                  </div>
                  {row.cells.map((cell, index) => <div key={index} className={styles.cell}><CellView cell={cell} /></div>)}
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })}
      </div>
    </section>
  );
}
