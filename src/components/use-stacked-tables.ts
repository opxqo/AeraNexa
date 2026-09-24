"use client";

import { useEffect, type RefObject } from "react";

/**
 * 移动端把 `.v2-table` 折叠成卡片列表（样式见 globals.css「移动端表格卡片化」）。
 * CSS 读不到单元格对应的表头，这里按列序把 thead 文字写进每个 td 的 data-label，
 * 并给表格打上 data-stack 标记——只有打过标记的表格才会在窄屏下卡片化。
 * 跨列的单元格（空状态、展开行）标记 data-full，整行显示、不带标签。
 */
function labelTable(table: HTMLTableElement) {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return;

  const labels: string[] = [];
  for (const th of Array.from(headerRow.cells)) {
    const text = th.textContent?.trim() ?? "";
    for (let i = 0; i < th.colSpan; i += 1) labels.push(text);
  }

  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        if (cell.colSpan > 1) {
          cell.setAttribute("data-full", "");
          cell.removeAttribute("data-label");
        } else {
          cell.removeAttribute("data-full");
          const label = labels[column] ?? "";
          if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
        }
        column += cell.colSpan;
      }
    }
  }
  table.setAttribute("data-stack", "");
}

export function useStackedTables(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const run = () => {
      frame = 0;
      root.querySelectorAll<HTMLTableElement>("table.v2-table").forEach(labelTable);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };

    run();
    // 只监听节点增删：写 data-* 属性不会再次触发，避免循环
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
