import { notFound } from "next/navigation";
import { ApiOrderDetailPage, ApiTicketDetailPage } from "@/components/api-pages";
import { DetailPage } from "@/components/demo-pages";

const detailSections = new Set(["plan", "order", "ticket"]);

export default async function DetailPageDispatcher({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params;
  if (!detailSections.has(section)) notFound();

  if (section === "order") {
    return <ApiOrderDetailPage tradeNo={id} />;
  }
  if (section === "ticket") {
    const ticketId = Number(id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();
    return <ApiTicketDetailPage ticketId={ticketId} />;
  }

  // 其他详情页面平滑回退
  return <DetailPage section={section} id={id} />;
}
