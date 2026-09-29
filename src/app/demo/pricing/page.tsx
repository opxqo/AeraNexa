import { redirect } from "next/navigation";

// The pricing demo became the real page.
export default function PricingDemoPage() {
  redirect("/pricing");
}
