import type { Metadata } from "next";
import { DemoPricing } from "../../components/demo-pricing";

export const metadata: Metadata = { title: "Pricing" };

export default function Page() {
  return <DemoPricing />;
}
