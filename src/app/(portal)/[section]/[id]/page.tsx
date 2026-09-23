import { notFound } from "next/navigation";
import { ApiOrderDetailPage, ApiTicketDetailPage } from "@/components/api-pages";
import { DetailPage } from "@/components/demo-pages";

const detailSections = new Set(["plan", "order", "ticket"]);

export default async function DetailPageDispatcher({
  params,
  searchParams,
}: {
  params: Promise<{ section: string; id: string }>;
  searchParams: Promise<{ paying?: string }>;
}) {
  const [{ section, id }, { paying }] = await Promise.all([params, searchParams]);
  if (!detailSections.has(section)) notFound();

  if (section === "order") {
    return <ApiOrderDetailPage tradeNo={id} resumePolling={paying === "1"} />;
  }
  if (section === "ticket") {
    const ticketId = Number(id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();
    return <ApiTicketDetailPage ticketId={ticketId} />;
  }

  // 其他详情页面平滑回退
  return <DetailPage section={section} id={id} />;
}
