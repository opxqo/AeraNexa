import { CircleCheck } from "lucide-react";
import { Page, PageHeader, Section, SettingRow } from "@/components/aera/page-layout";
import { PlanCard } from "@/components/aera/plan-card";
import { Stat, StatCard } from "@/components/aera/stat-card";
import { UsageMeter } from "@/components/aera/usage-meter";
import { DataTable } from "@/components/aera/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "cn";

// The living reference for the design language. Everything on this page is a real component; when
// a token or a pattern changes, this page changes with it. Rules are in docs/ui-design-language.md.

const SWATCHES = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["border", "bg-border"],
  ["input", "bg-input"],
  ["primary", "bg-primary"],
  ["brand", "bg-brand"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["destructive", "bg-destructive"],
  ["chart-1", "bg-chart-1"],
  ["chart-2", "bg-chart-2"],
  ["chart-5", "bg-chart-5"],
];

export default function KitPage() {
  return (
    <Page>
      <PageHeader title="Design language" description="Tokens, components and page patterns of the Aera account area. Rules: docs/ui-design-language.md." />

      <Section label="Colour" description="Ink is the action colour. Orange (Cloudflare orange) is the data colour: meters, heat maps, the lead chart series and focus rings; never a button fill.">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
          {SWATCHES.map(([name, swatch]) => (
            <div key={name} className="space-y-1.5">
              <div className={cn("h-12 rounded-lg border", swatch)} />
              <div className="text-xs text-muted-foreground">{name}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Type" description="Inter. 14px body, weight 400 and 500 only. Hierarchy comes from size and colour, not bold.">
        <Card>
          <CardContent className="space-y-2">
            <div className="text-3xl font-medium tracking-tight">Page figure, 30px / 500</div>
            <div className="text-2xl font-medium tracking-tight">Page title, 24px / 500</div>
            <div className="text-base font-medium">Card title, 16px / 500</div>
            <div className="text-sm">Body, 14px / 400. Lists, rows, table cells and helper copy all start here.</div>
            <div className="text-sm text-muted-foreground">Secondary, 14px, muted foreground.</div>
            <div className="text-xs text-muted-foreground">Caption, 12px. Table headers, stat labels, legends.</div>
          </CardContent>
        </Card>
      </Section>

      <Section label="Controls" description="32px tall, 10px radius. One primary action per card.">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button disabled>Disabled</Button>
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Input className="w-48" placeholder="Input" />
            <Switch defaultChecked aria-label="Switch" />
          </CardContent>
        </Card>
      </Section>

      <Section label="Patterns" description="What every page is made of.">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="StatCard" value="$67.81" hint="Optional hint" />
          <PlanCard name="PlanCard" price="$20 /mo." current text="Name and price on one line, a sentence, then the action." action={<Button variant="outline">Action</Button>} />
          <Card>
            <CardContent className="space-y-3">
              <UsageMeter label="UsageMeter" figure="42%" value={42} note="A labelled bar with an optional note." />
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Stat" value="853" />
                <Stat label="Stat" value="Mar 24" />
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent>
            <SettingRow title="SettingRow" description="Title and helper text on the left, the control on the right; it stacks when its card is narrow.">
              <Button variant="outline">Manage</Button>
            </SettingRow>
          </CardContent>
        </Card>
        <Alert>
          <CircleCheck />
          <AlertTitle>Alert</AlertTitle>
          <AlertDescription>Confirmations that stay on the page. Transient ones use a toast.</AlertDescription>
        </Alert>
        <DataTable
          columns={[
            { key: "a", header: "DataTable", cell: (row) => row.a },
            { key: "b", header: "Hidden below sm", hideBelow: "sm", cell: (row) => row.b },
            { key: "c", header: "Right, tabular", align: "right", cell: (row) => row.c, className: "tabular-nums" },
          ]}
          rows={[
            { id: "1", a: "Scrolls sideways on its own", b: "least important column", c: "1,204" },
            { id: "2", a: "Numbers align right", b: "hide it first", c: "98" },
          ]}
          rowKey={(row) => row.id}
        />
      </Section>
    </Page>
  );
}
