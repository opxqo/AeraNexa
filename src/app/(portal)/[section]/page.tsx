import { notFound } from "next/navigation";
import {
  ApiPlanPage,
  ApiOrderPage,
  ApiNodePage,
  ApiTrafficPage,
  ApiInvitePage,
  ApiKnowledgePage,
  ApiTicketPage,
  ApiProfilePage,
} from "@/components/api-pages";

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;

  switch (section) {
    case "plan":
      return <ApiPlanPage />;
    case "order":
      return <ApiOrderPage />;
    case "node":
      return <ApiNodePage />;
    case "traffic":
      return <ApiTrafficPage />;
    case "invite":
      return <ApiInvitePage />;
    case "knowledge":
      return <ApiKnowledgePage />;
    case "ticket":
      return <ApiTicketPage />;
    case "profile":
      return <ApiProfilePage />;
    default:
      notFound();
  }
}
