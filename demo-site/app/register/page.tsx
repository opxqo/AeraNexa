import type { Metadata } from "next";
import { DemoAuth } from "../../components/demo-auth";

export const metadata: Metadata = { title: "Sign up" };

export default function Page() {
  return <DemoAuth mode="register" />;
}
