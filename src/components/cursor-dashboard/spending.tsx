"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader, SettingRow, Section } from "@/components/aera/page-layout";
import { PlanCard } from "@/components/aera/plan-card";
import { UsageMeter } from "@/components/aera/usage-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { AdjustPlanDialog } from "./adjust-plan-dialog";
import { useCursorState } from "./state";

const MODES = [
  { value: "fixed", label: "Fixed" },
  { value: "unlimited", label: "Unlimited" },
];

export function SpendingPage() {
  const { onDemand, setOnDemand } = useCursorState();
  const [adjust, setAdjust] = useState(false);
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [mode, setMode] = useState<"fixed" | "unlimited">(onDemand.mode);
  const [amount, setAmount] = useState(String(onDemand.limit));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const dirty = mode !== onDemand.mode || (mode === "fixed" && Number(amount) !== onDemand.limit);
  const limitLabel = onDemand.mode === "unlimited" ? "Unlimited" : `$${onDemand.limit}`;

  return (
    <Page>
      <PageHeader title="Spending" description="What your plan includes, and what you have spent beyond it." />

      <div className="grid gap-4 sm:grid-cols-2">
        <PlanCard
          name="Pro"
          current
          price="$20/mo"
          text="Resets on Apr 24 (29 days)"
          action={
            <Button variant="outline" onClick={() => setAdjust(true)}>
              Adjust plan
            </Button>
          }
        />
        <PlanCard
          name="Pro+"
          price="$60/mo"
          text="Unlock 3x more usage on Agent & more"
          action={
            <Button
              disabled={processing}
              onClick={() => {
                setProcessing(true);
                timer.current = setTimeout(() => {
                  setProcessing(false);
                  toast.success("Upgraded to Pro+. This is a demo: nothing was charged.");
                }, 1600);
              }}
            >
              {processing ? (
                <>
                  <Spinner data-icon="inline-start" /> Processing…
                </>
              ) : (
                "Upgrade"
              )}
            </Button>
          }
        />
      </div>

      <Section label="Included in Pro">
        <Card>
          <CardContent>
            <Collapsible open={open} onOpenChange={setOpen} className="space-y-4">
              <UsageMeter label="Total" figure="3%" value={2.7} />
              <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" />}>
                0% Auto and 11% API used
                <ChevronDown data-icon="inline-end" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-5 rounded-lg bg-muted/50 p-4">
                  <UsageMeter label="Auto + Composer" figure="0%" value={0.3} note="Consumed by Auto and Composer models. Additional usage consumes API quota." />
                  <UsageMeter label="API" figure="11%" value={11.4} tone="blue" note="Consumed by other models. Your plan includes at least $20 of API usage." />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </Section>

      <Section label="On-Demand Usage">
        <Card>
          <CardContent className="space-y-5">
            <UsageMeter label="On-Demand" figure={`$0.00 / ${limitLabel}`} value={0} note="On-demand usage is consumed after a usage limit is reached, and is billed in arrears." />
            <Separator />
            <SettingRow title="Monthly Limit" description="Set a fixed amount or make it unlimited.">
              <Select items={MODES} value={mode} onValueChange={(value) => value && setMode(value as "fixed" | "unlimited")}>
                <SelectTrigger className="w-32" aria-label="Limit type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <InputGroup className="w-28">
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput aria-label="Monthly limit" inputMode="numeric" disabled={mode === "unlimited"} value={mode === "unlimited" ? "" : amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} />
              </InputGroup>
              <Button
                variant="outline"
                disabled={!dirty}
                onClick={() => {
                  setOnDemand({ enabled: true, mode, limit: mode === "fixed" ? Number(amount) || 0 : onDemand.limit });
                  toast.success("Monthly limit saved");
                }}
              >
                Save
              </Button>
            </SettingRow>
          </CardContent>
        </Card>
      </Section>

      <AdjustPlanDialog current="pro" open={adjust} onOpenChange={setAdjust} />
    </Page>
  );
}
