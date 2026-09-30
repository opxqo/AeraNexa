import type { Metadata } from "next";
import { DemoAuth } from "../../components/demo-auth";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return <DemoAuth mode="forget" />;
}
