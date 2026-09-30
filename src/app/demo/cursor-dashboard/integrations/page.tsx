import { Page, PageHeader } from "@/components/aera/page-layout";
import { IntegrationList } from "@/components/cursor-dashboard/integration-list";

export default function IntegrationsRoute() {
  return (
    <Page>
      <PageHeader title="Integrations" description="Connect the services your agents work with." />
      <IntegrationList />
    </Page>
  );
}
