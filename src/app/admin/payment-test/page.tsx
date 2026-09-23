import { getEpayTestOverview, getEpayTestStatus, type EpayTestStatus } from "@/lib/server/payments/epay-test";
import { EpayLiveTest } from "./epay-live-test";
import { PaymentTestLab } from "./payment-test-lab";

export const dynamic = "force-dynamic";

export default async function AdminPaymentTestPage({ searchParams }: { searchParams: Promise<{ epay?: string }> }) {
  const [overview, { epay }] = await Promise.all([getEpayTestOverview(), searchParams]);
  // 收银台付款后经 return 路由跳回时带上测试单号，直接展示该单的结果。
  let initialStatus: EpayTestStatus | null = null;
  if (epay && /^ET[0-9A-F]{20}$/.test(epay)) initialStatus = await getEpayTestStatus(epay).catch(() => null);
  return (
    <>
      <EpayLiveTest overview={overview} initialStatus={initialStatus} />
      <PaymentTestLab />
    </>
  );
}
