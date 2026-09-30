"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { DataTable, type Column } from "@/components/aera/data-table";
import { DateRangePicker } from "@/components/aera/date-range-picker";
import { Page, PageHeader, Section } from "@/components/aera/page-layout";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SUBSCRIPTION } from "@/lib/demo/panel-mock";
import { ALL_DAYS, breakdown, cycle, FIRST_DATE, formatMb, LAST_DATE, QUOTA_MB, type Day } from "@/lib/demo/traffic-model";
import { AverageSpark, ChartCard, CycleChart, DailyChart, HourArea, KpiCard, PeakSpark, QuotaGauge, RankBars, SplitDonut, SplitMini, TotalSpark, WeekdayBars } from "./traffic-charts";

const PRESETS = [
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
];
const PAGE_SIZE = 10;
const iso = (date: Date) => format(date, "yyyy-MM-dd");
const rangeOf = (days: number): DateRange => ({ from: parseISO(ALL_DAYS[Math.max(0, ALL_DAYS.length - days)].date), to: parseISO(LAST_DATE) });

export function TrafficPage() {
  const [preset, setPreset] = useState<string>("30");
  const [range, setRange] = useState<DateRange | undefined>(rangeOf(30));
  const [pageIndex, setPageIndex] = useState(1);

  const from = range?.from ? iso(range.from) : FIRST_DATE;
  const to = iso(range?.to ?? range?.from ?? parseISO(LAST_DATE));
  const data = useMemo(() => breakdown(from, to), [from, to]);
  const cycleData = useMemo(() => cycle(), []);

  const newest = [...data.days].reverse();
  const pages = Math.max(1, Math.ceil(newest.length / PAGE_SIZE));
  const current = Math.min(pageIndex, pages);
  const rows = newest.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const peak = data.peak?.total ?? 1;

  const columns: Column<Day>[] = [
    { key: "date", header: "日期", cell: (day) => day.date, className: "whitespace-nowrap tabular-nums" },
    { key: "up", header: "上行", hideBelow: "sm", align: "right", cell: (day) => formatMb(day.up), className: "tabular-nums text-muted-foreground" },
    { key: "down", header: "下行", hideBelow: "sm", align: "right", cell: (day) => formatMb(day.down), className: "tabular-nums text-muted-foreground" },
    {
      key: "total",
      header: "合计",
      align: "right",
      cell: (day) => (
        <div className="flex items-center justify-end gap-3">
          <Progress value={(day.total / peak) * 100} className="w-16 gap-0 max-sm:hidden [&_[data-slot=progress-indicator]]:bg-brand [&_[data-slot=progress-track]]:h-1.5" />
          <span className="w-20 text-right font-medium tabular-nums">{formatMb(day.total)}</span>
        </div>
      ),
    },
  ];

  const go = (next: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setPageIndex(Math.min(Math.max(1, next), pages));
  };

  return (
    <Page>
      <PageHeader
        title="流量明细"
        description="近期开销记录"
        actions={
          <>
            <ToggleGroup
              variant="outline"
              value={preset ? [preset] : []}
              onValueChange={(value) => {
                if (!value[0]) return;
                setPreset(value[0]);
                setRange(rangeOf(Number(value[0])));
                setPageIndex(1);
              }}
              aria-label="范围"
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
                setPageIndex(1);
              }}
              disabled={{ before: parseISO(FIRST_DATE), after: parseISO(LAST_DATE) }}
            />
          </>
        }
      />

      {data.days.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>这个范围内没有流量记录</EmptyTitle>
            <EmptyDescription>换一个日期范围试试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="@container space-y-4">
          <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
            <KpiCard label="区间合计" value={formatMb(data.total)} hint={`${data.days.length} 天`} chart={<TotalSpark days={data.days} />} />
            <KpiCard label="日均" value={formatMb(data.average)} chart={<AverageSpark days={data.days} />} />
            <KpiCard label="峰值日" value={formatMb(data.peak?.total ?? 0)} hint={data.peak?.label} chart={<PeakSpark days={data.days} peak={data.peak?.date} />} />
            <KpiCard label="下行 / 上行" value={`${Math.round((data.down / (data.total || 1)) * 100)} / ${Math.round((data.up / (data.total || 1)) * 100)}`} hint="%" chart={<SplitMini up={data.up} down={data.down} />} />
          </div>

          <div className="grid gap-4 @4xl:grid-cols-3">
            <ChartCard title="每日流量" className="@4xl:col-span-2">
              <DailyChart days={data.days} average={data.average} />
            </ChartCard>
            <ChartCard title="本周期配额">
              <QuotaGauge used={cycleData.used} />
              <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                <Reading label="剩余" value={formatMb(QUOTA_MB - cycleData.used)} />
                <Reading label={`${SUBSCRIPTION.resetInDays} 天后重置`} value={formatMb(cycleData.pace)} unit="/天" />
                <Reading label="预计周期末" value={formatMb(cycleData.projected)} warn={cycleData.over} />
              </div>
            </ChartCard>
          </div>

          <div className="grid gap-4 @4xl:grid-cols-3">
            <ChartCard title="累计用量与预测">
              <CycleChart points={cycleData.points} over={cycleData.over} />
            </ChartCard>
            <ChartCard title="下行与上行">
              <SplitDonut up={data.up} down={data.down} />
            </ChartCard>
            <ChartCard title="星期分布（日均）">
              <WeekdayBars weekdays={data.weekdays} />
            </ChartCard>
          </div>

          <div className="grid gap-4 @4xl:grid-cols-3">
            <ChartCard title="一天中的时段（日均）">
              <HourArea hours={data.hours} />
            </ChartCard>
            <ChartCard title="节点占比">
              <RankBars flag items={data.nodes.map((node) => ({ key: node.code, label: node.name, flag: node.flag, mb: node.mb }))} />
            </ChartCard>
            <ChartCard title="流量最高的 5 天">
              <RankBars items={data.top.map((day) => ({ key: day.date, label: day.date, mb: day.total }))} />
            </ChartCard>
          </div>

          <Section label="每日明细" className="pt-2">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(day) => day.date}
              footer={
                <>
                  <span className="tabular-nums">
                    共 {newest.length} 天 · 第 {current} / {pages} 页
                  </span>
                  {pages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious href="#" text="上一页" onClick={go(current - 1)} aria-disabled={current <= 1} className={current <= 1 ? "pointer-events-none opacity-50" : undefined} />
                        </PaginationItem>
                        {Array.from({ length: Math.min(pages, 5) }, (_, index) => (
                          <PaginationItem key={index} className="max-sm:hidden">
                            <PaginationLink href="#" isActive={current === index + 1} onClick={go(index + 1)}>
                              {index + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext href="#" text="下一页" onClick={go(current + 1)} aria-disabled={current >= pages} className={current >= pages ? "pointer-events-none opacity-50" : undefined} />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </>
              }
            />
          </Section>
        </div>
      )}
    </Page>
  );
}

/** A short figure under a chart: the number big, its label small. */
function Reading({ label, value, unit, warn }: { label: string; value: string; unit?: string; warn?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className={warn ? "text-sm font-medium tabular-nums text-brand" : "text-sm font-medium tabular-nums"}>
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
