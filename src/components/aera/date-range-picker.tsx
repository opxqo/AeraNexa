"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A date range in a popover: shadcn Popover around shadcn Calendar in range mode. */
export function DateRangePicker({ value, onChange, disabled }: { value: DateRange | undefined; onChange: (range: DateRange | undefined) => void; disabled?: React.ComponentProps<typeof Calendar>["disabled"] }) {
  const label = value?.from ? (value.to ? `${format(value.from, "MMM d, y")} – ${format(value.to, "MMM d, y")}` : format(value.from, "MMM d, y")) : "Pick a date range";
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="justify-start font-normal" />}>
        <CalendarIcon data-icon="inline-start" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar mode="range" numberOfMonths={2} selected={value} onSelect={onChange} disabled={disabled} defaultMonth={value?.from} />
      </PopoverContent>
    </Popover>
  );
}
