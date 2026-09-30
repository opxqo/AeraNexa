"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatMb, MB_PER_GB, QUOTA_MB, type Breakdown, type CyclePoint } from "@/lib/demo/traffic-model";

// Chart recipes: pill-shaped bars (rounded ends), round-capped lines, donut segments with rounded corners and a gap.
// The look follows Amicro's Mono Charts (MIT); the charts are shadcn Chart + recharts, coloured with our tokens:
// download is the brand orange, upload the neutral grey, a forecast is dashed, a quota is a reference line.

const CONFIG = {
  down: { label: "下行", color: "var(--chart-1)" },
  up: { label: "上行", color: "var(--chart-5)" },
  avg7: { label: "7 日均线", color: "var(--foreground)" },
  mb: { label: "流量", color: "var(--chart-1)" },
  actual: { label: "已用", color: "var(--chart-1)" },
  forecast: { label: "预测", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** "1.2G" / "640M": short enough for an axis. */
const axisSize = (mb: number) => (mb >= MB_PER_GB ? `${Number((mb / MB_PER_GB).toFixed(mb >= MB_PER_GB * 10 ? 0 : 1))}G` : `${Math.round(mb)}M`);

/** A tooltip row: colour chip, series name, size. The default row would print the raw number. */
function sizeRow(value: unknown, name: unknown, item: { color?: string; payload?: { fill?: string } }) {
  const color = item.payload?.fill ?? item.color;
  const label = CONFIG[String(name) as keyof typeof CONFIG]?.label ?? String(name);
  return (
    <>
      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium text-foreground tabular-nums">{formatMb(Number(value))}</span>
      </div>
    </>
  );
}

const TOOLTIP = <ChartTooltipContent formatter={sizeRow} />;

/** The shell every chart sits in: a title, an optional one-line reading, the chart. */
export function ChartCard({ title, description, className, children }: { title: string; description?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- KPI sparklines

/** A number with its own small chart underneath. */
export function KpiCard({ label, value, hint, chart }: { label: string; value: ReactNode; hint?: ReactNode; chart: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-medium tracking-tight whitespace-nowrap tabular-nums">{value}</span>
          {hint && <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">{hint}</span>}
        </div>
        <div className="h-12">{chart}</div>
      </CardContent>
    </Card>
  );
}

const spark = { top: 4, right: 2, bottom: 2, left: 2 };

export function TotalSpark({ days }: { days: Breakdown["days"] }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto size-full">
      <AreaChart data={days} margin={spark}>
        <defs>
          <linearGradient id="spark-total" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-mb)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-mb)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area dataKey="total" name="mb" type="monotone" stroke="var(--color-mb)" strokeWidth={2} strokeLinecap="round" fill="url(#spark-total)" isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

export function AverageSpark({ days }: { days: Breakdown["days"] }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto size-full">
      <LineChart data={days} margin={spark}>
        <Line dataKey="avg7" name="avg7" type="monotone" stroke="var(--foreground)" strokeWidth={2} strokeLinecap="round" dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

export function PeakSpark({ days, peak }: { days: Breakdown["days"]; peak: string | undefined }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto size-full">
      <BarChart data={days} margin={spark} barCategoryGap={1}>
        <Bar dataKey="total" name="mb" radius={2} isAnimationActive={false}>
          {days.map((day) => (
            <Cell key={day.date} fill={day.date === peak ? "var(--color-mb)" : "var(--chart-5)"} fillOpacity={day.date === peak ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function SplitMini({ up, down }: { up: number; down: number }) {
  const data = [
    { name: "down", value: down, fill: "var(--color-down)" },
    { name: "up", value: up, fill: "var(--color-up)" },
  ];
  return (
    <ChartContainer config={CONFIG} className="mx-auto aspect-square h-full">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={6} cornerRadius={4} stroke="none" isAnimationActive={false} />
      </PieChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------------------------- main charts

/** Daily download and upload as stacked pills, with the 7-day average on top. */
export function DailyChart({ days, average }: { days: Breakdown["days"]; average: number }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-[280px] w-full">
      <ComposedChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={axisSize} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={TOOLTIP} />
        <ReferenceLine y={average} stroke="var(--muted-foreground)" strokeDasharray="3 4" strokeOpacity={0.6} />
        <Bar dataKey="down" name="down" stackId="day" fill="var(--color-down)" radius={[0, 0, 5, 5]} maxBarSize={18} />
        <Bar dataKey="up" name="up" stackId="day" fill="var(--color-up)" fillOpacity={0.7} radius={[5, 5, 0, 0]} maxBarSize={18} />
        <Line dataKey="avg7" name="avg7" type="monotone" stroke="var(--foreground)" strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" dot={false} activeDot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}

/** Quota as a half-ring: the filled part is what has been used. */
export function QuotaGauge({ used }: { used: number }) {
  const percent = Math.min(100, (used / QUOTA_MB) * 100);
  return (
    <div className="relative mx-auto h-[190px] w-full max-w-[280px]">
      <ChartContainer config={CONFIG} className="aspect-auto size-full">
        <RadialBarChart data={[{ name: "actual", value: percent, fill: "var(--color-actual)" }]} startAngle={210} endAngle={-30} innerRadius="74%" outerRadius="100%" cy="55%">
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
          <RadialBar dataKey="value" background={{ fill: "var(--muted)" }} cornerRadius={12} isAnimationActive={false} />
        </RadialBarChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
        <div className="text-3xl font-medium tracking-tight tabular-nums">{percent.toFixed(1)}%</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {(used / MB_PER_GB).toFixed(2)} / {QUOTA_MB / MB_PER_GB} GB
        </div>
      </div>
    </div>
  );
}

/** Cumulative use this cycle (solid) and the pace projected to the reset day (dashed), against the quota. */
export function CycleChart({ points, over }: { points: CyclePoint[]; over: boolean }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-[220px] w-full">
      <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="cycle-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-actual)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-actual)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={axisSize} domain={[0, (max: number) => Math.max(max, QUOTA_MB * 0.3)]} />
        <ChartTooltip content={TOOLTIP} />
        {over && <ReferenceLine y={QUOTA_MB} stroke="var(--chart-1)" strokeDasharray="4 4" label={{ value: "配额", position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} />}
        <Area dataKey="actual" name="actual" type="monotone" stroke="var(--color-actual)" strokeWidth={2} strokeLinecap="round" fill="url(#cycle-actual)" connectNulls={false} isAnimationActive={false} />
        <Area dataKey="forecast" name="forecast" type="monotone" stroke="var(--color-forecast)" strokeWidth={2} strokeLinecap="round" strokeDasharray="4 5" fill="none" connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Download against upload as a donut with the total in the middle. */
export function SplitDonut({ up, down }: { up: number; down: number }) {
  const data = [
    { name: "down", value: down, fill: "var(--color-down)" },
    { name: "up", value: up, fill: "var(--color-up)" },
  ];
  return (
    <div className="relative">
      <ChartContainer config={CONFIG} className="mx-auto aspect-square h-[190px]">
        <PieChart>
          <ChartTooltip content={TOOLTIP} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={6} cornerRadius={8} stroke="none" isAnimationActive={false} />
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <div className="text-xl font-medium tracking-tight tabular-nums">{formatMb(up + down)}</div>
        <div className="text-xs text-muted-foreground tabular-nums">下行 {Math.round((down / (up + down || 1)) * 100)}%</div>
      </div>
    </div>
  );
}

/** Average traffic per weekday as seven pills; the busiest one in orange. */
export function WeekdayBars({ weekdays }: { weekdays: Breakdown["weekdays"] }) {
  const max = Math.max(...weekdays.map((item) => item.mb));
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-[190px] w-full">
      <BarChart data={weekdays} margin={{ left: 0, right: 0, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis hide />
        <ChartTooltip cursor={false} content={TOOLTIP} />
        <Bar dataKey="mb" name="mb" radius={[8, 8, 8, 8]} maxBarSize={22} isAnimationActive={false}>
          {weekdays.map((item) => (
            <Cell key={item.weekday} fill={item.mb === max ? "var(--color-mb)" : "var(--chart-5)"} fillOpacity={item.mb === max ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Which hours of the day the traffic falls in (average over the range). */
export function HourArea({ hours }: { hours: Breakdown["hours"] }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-[220px] w-full">
      <AreaChart data={hours} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="hours-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-mb)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-mb)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={3} tickFormatter={(value: string) => `${value}:00`} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={axisSize} />
        <ChartTooltip content={<ChartTooltipContent formatter={sizeRow} labelFormatter={(value) => `${value}:00 – ${value}:59`} />} />
        <Area dataKey="mb" name="mb" type="monotone" stroke="var(--color-mb)" strokeWidth={2} strokeLinecap="round" fill="url(#hours-fill)" isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

/** A ranked list as horizontal pills with the size at the end of each. */
export function RankBars({ items, flag }: { items: { key: string; label: string; flag?: string; mb: number }[]; flag?: boolean }) {
  const max = Math.max(...items.map((item) => item.mb), 1);
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {flag && item.flag && (
                // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG flags
                <img src={`/flags/${item.flag}.svg`} alt="" className="size-4 shrink-0 rounded-full object-cover" />
              )}
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{formatMb(item.mb)}</span>
          </div>
          <Progress value={(item.mb / max) * 100} className={cn("gap-0 [&_[data-slot=progress-track]]:h-2", index === 0 ? "[&_[data-slot=progress-indicator]]:bg-brand" : "[&_[data-slot=progress-indicator]]:bg-chart-5/50")} />
        </li>
      ))}
    </ol>
  );
}
