import { notFound } from "next/navigation";
import {
  PlanPage,
  OrderPage,
  NodePage,
  TrafficPage,
  InvitePage,
  KnowledgePage,
  TicketPage,
  ProfilePage,
} from "@/components/demo-pages";

export default async function DemoSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;

  switch (section) {
    case "plan":
      return <PlanPage />;
    case "order":
      return <OrderPage />;
    case "node":
      return <NodePage />;
    case "traffic":
      return <TrafficPage />;
    case "invite":
      return <InvitePage />;
    case "knowledge":
      return <KnowledgePage />;
    case "ticket":
      return <TicketPage />;
    case "profile":
      return <ProfilePage />;
    default:
      notFound();
  }
}
