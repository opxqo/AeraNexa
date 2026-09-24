import { notFound } from "next/navigation";
import { ApiOrderDetailPage, ApiTicketDetailPage } from "@/components/api-pages";

const detailSections = new Set(["order", "ticket"]);

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
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();
  return <ApiTicketDetailPage ticketId={ticketId} />;
}
