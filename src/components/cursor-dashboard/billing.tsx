"use client";

import { useState } from "react";
import { ExternalLink, Gift } from "lucide-react";
import { toast } from "sonner";
import { AlertBar } from "@/components/aera/alert-bar";
import { DataTable, type Column } from "@/components/aera/data-table";
import { Page, PageHeader, SettingRow, Section } from "@/components/aera/page-layout";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdjustPlanDialog } from "./adjust-plan-dialog";
import { useCursorState } from "./state";

const CYCLES = [
  { value: "mar", label: "Cycle Starting Mar 24, 2026" },
  { value: "feb", label: "Cycle Starting Feb 24, 2026" },
];
const MONTHS = [
  { value: "mar", label: "March 2026" },
  { value: "feb", label: "February 2026" },
];

type Included = { name: string; tokens: string; usage: string; strong?: boolean };
const INCLUDED: Included[] = [
  { name: "API", tokens: "8.2M tokens", usage: "4.8%", strong: true },
  { name: "gpt-5.3-codex-high", tokens: "2.7M tokens", usage: "4.8%" },
  { name: "claude-4.6-opus-high-thinking", tokens: "5.5M tokens", usage: "0.0%" },
  { name: "Auto + Composer", tokens: "0", usage: "0.0%", strong: true },
];
const INCLUDED_COLUMNS: Column<Included>[] = [
  { key: "name", header: "Item", cell: (row) => <span className={row.strong ? "font-medium" : "pl-4 text-muted-foreground"}>{row.name}</span> },
  { key: "tokens", header: "Tokens", cell: (row) => row.tokens, className: "tabular-nums" },
  { key: "usage", header: "Usage", align: "right", cell: (row) => row.usage, className: "tabular-nums" },
];

type Invoice = { id: string; date: string; status: string; amount: string };
const INVOICES: Invoice[] = [{ id: "inv-1", date: "Mar 24, 2026", status: "Paid", amount: "20.00 USD" }];

const DEMAND_COLUMNS: Column<{ id: string }>[] = [
  { key: "type", header: "Type", cell: () => "Subtotal:" },
  { key: "tokens", header: "Tokens", align: "right", hideBelow: "sm", cell: () => null },
  { key: "cost", header: "Cost", align: "right", hideBelow: "sm", cell: () => null },
  { key: "qty", header: "Qty", align: "right", hideBelow: "sm", cell: () => null },
  { key: "total", header: "Total", align: "right", cell: () => "$0.00", className: "tabular-nums" },
];

export function BillingPage() {
  const { plan, onDemand } = useCursorState();
  const pro = plan === "pro";
  const [adjust, setAdjust] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [cycle, setCycle] = useState("mar");
  const [month, setMonth] = useState("mar");
  const limit = onDemand.mode === "unlimited" ? "Unlimited" : `$${onDemand.limit}.00`;

  const invoiceColumns: Column<Invoice>[] = [
    { key: "date", header: "Date", cell: (row) => row.date },
    { key: "status", header: "Status", cell: (row) => <Badge variant="secondary">{row.status}</Badge> },
    { key: "amount", header: "Amount", align: "right", cell: (row) => row.amount, className: "tabular-nums" },
    {
      key: "invoice",
      header: "Invoice",
      align: "right",
      cell: () => (
        <Button variant="ghost" size="sm" onClick={() => toast("Invoices open in Stripe. This is a demo.")}>
          <ExternalLink data-icon="inline-start" />
          View
        </Button>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader title="Billing & Invoices" />

      {pro && (
        <>
          <AlertBar
            icon={<Gift />}
            title="Switch to annual billing and save 20%"
            action={
              <Button variant="outline" size="sm" onClick={() => toast.success("Switched to annual billing. This is a demo: nothing was charged.")}>
                Upgrade Now
              </Button>
            }
          />

          <Card>
            <CardContent>
              <SettingRow
                title={
                  <span className="flex items-baseline gap-2">
                    <span className="text-base">Pro</span>
                    <span className="text-sm font-normal text-muted-foreground">$20 /mo.</span>
                  </span>
                }
                description={
                  <>
                    <span className="block">Entry-level plan with access to premium models, unlimited Tab completions, and more.</span>
                    <span className="block">Your subscription will auto renew on April 24, 2026.</span>
                  </>
                }
              >
                <Button variant="outline" onClick={() => setAdjust(true)}>
                  Adjust plan
                </Button>
              </SettingRow>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <SettingRow title="Payment" description="Update your payment details">
                <Button variant="outline" onClick={() => toast("Stripe's billing portal is not part of this demo.")}>
                  Manage in Stripe
                </Button>
              </SettingRow>
            </CardContent>
          </Card>

          <Section label="Included Usage" description="Mar 24, 2026 - Apr 24, 2026">
            <DataTable columns={INCLUDED_COLUMNS} rows={INCLUDED} rowKey={(row) => row.name} />
          </Section>
        </>
      )}

      <Section
        label="On-Demand Usage"
        description="Mar 24, 2026 - Apr 24, 2026"
        actions={
          <Select items={CYCLES} value={cycle} onValueChange={(value) => value && setCycle(value)}>
            <SelectTrigger className="w-64 max-w-full" aria-label="Billing cycle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {CYCLES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        <Card>
          <CardContent>
            <p className="text-3xl font-medium tracking-tight tabular-nums">
              $0.00
              {pro && <small className="ml-2 text-sm font-normal text-muted-foreground">/ {limit}</small>}
            </p>
          </CardContent>
        </Card>
        <DataTable columns={DEMAND_COLUMNS} rows={[{ id: "subtotal" }]} rowKey={(row) => row.id} />
      </Section>

      <Section
        label="Invoices"
        actions={
          pro && (
            <Select items={MONTHS} value={month} onValueChange={(value) => value && setMonth(value)}>
              <SelectTrigger className="w-40" aria-label="Invoice month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {MONTHS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      >
        <DataTable columns={invoiceColumns} rows={pro && month === "mar" ? INVOICES : []} rowKey={(row) => row.id} empty="No invoices found." />
      </Section>

      {pro && (
        <Card>
          <CardContent>
            <SettingRow title="Cancel" description="We'll be sad to see you go.">
              <Button variant="destructive" onClick={() => setCancel(true)}>
                Cancel
              </Button>
            </SettingRow>
          </CardContent>
        </Card>
      )}

      <AdjustPlanDialog current="pro" open={adjust} onOpenChange={setAdjust} />
      <AlertDialog open={cancel} onOpenChange={setCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>If you cancel your subscription, you will lose access to premium models, have limited Tab completions, and have fewer Agent requests.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => toast("Your subscription would be cancelled here. This is a demo.")}>
              Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
