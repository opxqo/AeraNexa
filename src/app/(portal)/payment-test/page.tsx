import { notFound } from "next/navigation";
import { PaymentTestPage } from "@/components/payment-test-page";

export const metadata = {
  title: "支付测试",
};

export default function PaymentTestRoute() {
  // 与 navigation.ts 里的过滤成对出现：这一页是静态原型，不发任何请求，
  // 生产环境连 URL 也不该可达，否则用户点进来会以为支付流程坏了。
  if (process.env.NODE_ENV === "production") notFound();
  return <PaymentTestPage />;
}
