"use client";

import { useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { CircleCheck, Download } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DataTable, type Column } from "@/components/aera/data-table";
import { DateRangePicker } from "@/components/aera/date-range-picker";
import { Page, PageHeader, Section } from "@/components/aera/page-layout";
import { StatCard } from "@/components/aera/stat-card";
import { UsageChart } from "@/components/aera/usage-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MODELS, TODAY, USAGE_DAYS, USAGE_EVENTS, type UsageEvent } from "@/lib/demo/cursor-mock";

const PRESETS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
];
const MODEL_ITEMS = [{ value: "all", label: "All models" }, ...MODELS.map((model) => ({ value: model, label: model }))];
const PAGE_SIZE = 8;
const money = (value: number) => `$${value.toFixed(2)}`;
const iso = (date: Date) => format(date, "yyyy-MM-dd");
const rangeFor = (days: number): DateRange => ({ from: addDays(startOfDay(TODAY), -(days - 1)), to: startOfDay(TODAY) });

const COLUMNS: Column<UsageEvent>[] = [
  { key: "date", header: "Date", cell: (row) => format(new Date(`${row.date}T00:00:00`), "MMM d, y"), className: "whitespace-nowrap" },
  { key: "model", header: "Model", cell: (row) => row.model },
  { key: "kind", header: "Type", hideBelow: "sm", cell: (row) => <Badge variant={row.kind === "Included" ? "secondary" : "outline"}>{row.kind}</Badge> },
  { key: "tokens", header: "Tokens", align: "right", hideBelow: "md", cell: (row) => row.tokens.toLocaleString("en-US"), className: "tabular-nums" },
  { key: "cost", header: "Cost", align: "right", cell: (row) => money(row.cost), className: "tabular-nums" },
];

export function UsagePage() {
  const [preset, setPreset] = useState<string>("30");
  const [range, setRange] = useState<DateRange | undefined>(rangeFor(30));
  const [model, setModel] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [exported, setExported] = useState<number | null>(null);

  const from = range?.from ? iso(range.from) : "0000-00-00";
  const to = iso(range?.to ?? range?.from ?? TODAY);

  const days = useMemo(() => USAGE_DAYS.filter((day) => day.date >= from && day.date <= to), [from, to]);
  const events = useMemo(() => USAGE_EVENTS.filter((event) => event.date >= from && event.date <= to && (model === "all" || event.model === model)), [from, to, model]);

  const api = days.reduce((sum, day) => sum + day.api, 0);
  const auto = days.reduce((sum, day) => sum + day.auto, 0);
  const pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const safePage = Math.min(pageIndex, pages - 1);
  const visible = events.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const exportCsv = () => {
    const lines = ["date,model,type,tokens,cost", ...events.map((event) => [event.date, event.model, event.kind, event.tokens, event.cost.toFixed(2)].join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `usage-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(events.length);
  };

  const reset = () => {
    setPageIndex(0);
    setExported(null);
  };

  return (
    <Page>
      <PageHeader
        title="Usage"
        description="Spend and requests for the period you pick. All figures are made up."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={events.length === 0}>
            <Download data-icon="inline-start" />
            Export CSV
          </Button>
        }
      />

      {exported !== null && (
        <Alert>
          <CircleCheck />
          <AlertTitle>Export ready</AlertTitle>
          <AlertDescription>{exported} requests were saved to a CSV file.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          variant="outline"
          value={preset ? [preset] : []}
          onValueChange={(value) => {
            if (!value[0]) return;
            setPreset(value[0]);
            setRange(rangeFor(Number(value[0])));
            reset();
          }}
          aria-label="Period"
        >
          {PRESETS.map((item) => (
            <ToggleGroupItem key={item.value} value={item.value} className="px-3">
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DateRangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            setPreset("");
            reset();
          }}
          disabled={{ after: TODAY, before: new Date(USAGE_DAYS[0].date) }}
        />
        <Select items={MODEL_ITEMS} value={model} onValueChange={(value) => { if (value) { setModel(value); reset(); } }}>
          <SelectTrigger className="w-56 max-w-full" aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total spend" value={money(api + auto)} />
        <StatCard label="API" value={money(api)} />
        <StatCard label="Auto + Composer" value={money(auto)} />
        <StatCard label="Requests" value={events.length.toLocaleString("en-US")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily spend</CardTitle>
          <CardDescription>Stacked by source, in USD</CardDescription>
        </CardHeader>
        <CardContent>
          {days.length > 0 ? <UsageChart data={days} /> : <p className="py-16 text-center text-sm text-muted-foreground">No data for this period.</p>}
        </CardContent>
      </Card>

      <Section label="Requests">
        <DataTable
          columns={COLUMNS}
          rows={visible}
          rowKey={(row) => row.id}
          empty="No requests match these filters."
          footer={
            <>
              <span className="tabular-nums">
                {events.length === 0 ? "0 results" : `${safePage * PAGE_SIZE + 1}–${safePage * PAGE_SIZE + visible.length} of ${events.length}`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPageIndex(safePage - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={safePage >= pages - 1} onClick={() => setPageIndex(safePage + 1)}>
                  Next
                </Button>
              </div>
            </>
          }
        />
      </Section>
    </Page>
  );
}
