import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminPaymentTestPage({ searchParams }: { searchParams: Promise<{ epay?: string }> }) {
  const { epay } = await searchParams;
  redirect(`/admin/payments?tab=test${epay ? `&epay=${encodeURIComponent(epay)}` : ""}`);
}
