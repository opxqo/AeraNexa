import { notFound } from "next/navigation";
import { DetailPage } from "@/components/demo-pages";

const detailSections = new Set(["plan", "order", "ticket"]);

export default async function DemoDetailPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params;
  if (!detailSections.has(section)) notFound();
  return <DetailPage section={section} id={id} />;
}
