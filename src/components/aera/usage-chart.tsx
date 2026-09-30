"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type UsagePoint = { date: string; api: number; auto: number };

const CONFIG = {
  api: { label: "API", color: "var(--chart-2)" },
  auto: { label: "Auto + Composer", color: "var(--chart-1)" },
} satisfies ChartConfig;

const short = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Daily usage in USD, stacked by source. */
export function UsageChart({ data }: { data: UsagePoint[] }) {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-64 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          {(["api", "auto"] as const).map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.55} />
              <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={short} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value: number) => `$${value}`} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(value) => short(String(value))} />} />
        <Area dataKey="auto" type="monotone" stackId="usage" stroke="var(--color-auto)" fill="url(#fill-auto)" />
        <Area dataKey="api" type="monotone" stackId="usage" stroke="var(--color-api)" fill="url(#fill-api)" />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
