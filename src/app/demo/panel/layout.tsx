import "@/styles/aera.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PanelShell } from "@/components/panel-demo/shell";

export const metadata: Metadata = {
  title: "用户面板演示",
  description: "AeraNexa 用户面板的新版界面演示，使用模拟数据。",
};

export default function PanelLayout({ children }: { children: ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
