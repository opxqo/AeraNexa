import type { LucideIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** A page that exists in the navigation but is not built yet. */
export function ComingSoon({ title, heading = `${title} is not part of this demo`, description, icon: Icon }: { title: string; heading?: string; description: string; icon: LucideIcon }) {
  return (
    <Page>
      <PageHeader title={title} />
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{heading}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Page>
  );
}
