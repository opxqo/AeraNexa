"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PLANS, TEAM_PLAN } from "@/lib/demo/cursor-mock";

// "Adjust your plan": the plans side by side (four columns, two, then one as the dialog narrows).
// The current one is muted. Prices drop 20% when billed annually.

const ANNUAL: Record<string, string> = { pro: "$16", "pro-plus": "$48", ultra: "$160" };

type Tier = { id: string; name: string; price: string; blurb: string; features: readonly string[] };

export function AdjustPlanDialog({ open, onOpenChange, current = "pro" }: { open: boolean; onOpenChange: (open: boolean) => void; current?: string }) {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const currentName = PLANS.find((plan) => plan.id === current)?.name ?? "Pro";
  const annual = billing === "annual";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-6 overflow-y-auto p-4 sm:max-w-5xl sm:p-6">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="text-2xl font-medium tracking-tight">Adjust your plan</DialogTitle>
          <DialogDescription>Current plan: {currentName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <ToggleGroup variant="outline" value={[billing]} onValueChange={(value) => value[0] && setBilling(value[0] as "monthly" | "annual")} aria-label="Billing period">
            <ToggleGroupItem value="monthly" className="px-4">
              Monthly
            </ToggleGroupItem>
            <ToggleGroupItem value="annual" className="px-4">
              Annual
            </ToggleGroupItem>
          </ToggleGroup>
          <Badge variant="secondary">Save 20% when billed annually</Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <TierCard
              key={plan.id}
              tier={plan}
              price={annual ? ANNUAL[plan.id] : plan.price}
              unit="/mo."
              current={plan.id === current}
              action={
                plan.id === current ? (
                  <Button className="w-full" variant="secondary" disabled>
                    Your current plan
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => {
                      onOpenChange(false);
                      toast.success(`Switched to ${plan.name}. This is a demo: nothing was charged.`);
                    }}
                  >
                    Choose plan
                  </Button>
                )
              }
            />
          ))}
          <TierCard
            tier={{ id: "team", ...TEAM_PLAN }}
            price={annual ? "$32" : TEAM_PLAN.price.split("/")[0]}
            unit="/user/mo."
            action={
              <Button className="w-full" variant="outline" onClick={() => onOpenChange(false)}>
                Get Teams
              </Button>
            }
          />
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Need more capabilities for your business? Learn more about our{" "}
          <a href="#enterprise" className="text-foreground underline underline-offset-4">
            Enterprise plans.
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function TierCard({ tier, price, unit, current, action }: { tier: Tier; price: string; unit: string; current?: boolean; action: React.ReactNode }) {
  return (
    <Card className={current ? "bg-muted" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {tier.name}
          {current && <Badge variant="outline">Current plan</Badge>}
        </CardTitle>
        <div className="flex items-baseline gap-1 pt-1">
          <span className="text-3xl font-medium tracking-tight tabular-nums">{price}</span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        <CardDescription>{tier.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <ul className="space-y-2 text-sm">
          {tier.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {feature}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-2">{action}</div>
      </CardContent>
    </Card>
  );
}
