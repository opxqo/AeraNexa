"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Page, Section } from "@/components/aera/page-layout";
import { PlanCard } from "@/components/aera/plan-card";
import { Stat } from "@/components/aera/stat-card";
import { UsageMeter } from "@/components/aera/usage-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GitHubActivity, type Contribution } from "@/components/ui/github-activity";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PLANS, REPOS, TODAY } from "@/lib/demo/cursor-mock";
import { AdjustPlanDialog } from "./adjust-plan-dialog";
import { IntegrationList } from "./integration-list";
import { useCursorState } from "./state";

type Source = "all" | "tab" | "agent";
const LINES: Record<Source, number> = { all: 853, tab: 531, agent: 322 };
const LIT = "2026-03-24";
/** Each repository's share of the line edits, highest first. */
const SHARES = [0.48, 0.31, 0.21];

/** One cell per day from the Sunday 52 weeks back up to TODAY; only March 24 has any edits. */
function buildDays(count: number): Contribution[] {
  const day = new Date(TODAY);
  day.setDate(day.getDate() - day.getDay() - 52 * 7);
  const days: Contribution[] = [];
  while (day <= TODAY) {
    const date = format(day, "yyyy-MM-dd");
    days.push(date === LIT && count > 0 ? { date, count, level: 4 } : { date, count: 0, level: 0 });
    day.setDate(day.getDate() + 1);
  }
  return days;
}

export function OverviewPage() {
  const { plan, setPlan, onDemand, setOnDemand } = useCursorState();
  const [adjust, setAdjust] = useState(false);
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<Source>("all");
  const [processing, setProcessing] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pro = plan === "pro";

  // "Upgrade to …": a beat of "Processing…", then the plan changes.
  const upgrade = (id: string, name: string) => {
    if (processing) return;
    setProcessing(id);
    timer.current = setTimeout(() => {
      setProcessing(null);
      if (id === "pro") setPlan("pro");
      else toast.success(`Upgraded to ${name}. This is a demo: nothing was charged.`);
    }, 1600);
  };

  const cards = pro ? PLANS.filter((item) => item.id !== "pro") : PLANS;
  const lines = pro ? LINES[source] : 0;
  const days = useMemo(() => buildDays(lines), [lines]);
  const repos = useMemo(() => (pro ? REPOS.slice(0, SHARES.length).map((name, index) => ({ name, count: Math.round(lines * SHARES[index]) })) : []), [pro, lines]);

  return (
    <Page>
      <div className="@container">
        <div className={pro ? "grid gap-4 @2xl:grid-cols-2" : "grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3"}>
          {cards.map((item) => (
            <PlanCard
              key={item.id}
              name={item.name}
              price={`${item.price} /mo.`}
              text={item.short}
              action={
                <Button disabled={processing !== null} onClick={() => upgrade(item.id, item.name)}>
                  {processing === item.id ? (
                    <>
                      <Spinner data-icon="inline-start" /> Processing…
                    </>
                  ) : (
                    `Upgrade to ${item.name}`
                  )}
                </Button>
              }
            />
          ))}
        </div>
      </div>

      {pro && (
        <Card>
          <CardContent className="@container">
            <div className="grid gap-6 @2xl:grid-cols-2 @2xl:gap-0 @2xl:divide-x">
              <div className="flex flex-col gap-3 @2xl:pr-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium tracking-tight">Pro</span>
                  <Badge variant="secondary">Current</Badge>
                  <span className="ml-auto text-sm text-muted-foreground tabular-nums">$20 /mo.</span>
                </div>
                <p className="text-sm text-muted-foreground text-pretty">{PLANS[0].short}</p>
                <div className="mt-auto pt-1">
                  <Button variant="outline" onClick={() => setAdjust(true)}>
                    Adjust Plan
                  </Button>
                </div>
              </div>
              <div className="@2xl:pl-6">
                {editing ? (
                  <SpendLimit
                    onCancel={() => setEditing(false)}
                    onSave={(mode, limit) => {
                      setOnDemand({ enabled: true, mode, limit });
                      setEditing(false);
                    }}
                  />
                ) : onDemand.enabled ? (
                  <div className="flex h-full flex-col gap-3">
                    <UsageMeter
                      label="On-Demand Usage this Month"
                      figure={`$0 / ${onDemand.mode === "unlimited" ? "Unlimited" : `$${onDemand.limit}`}`}
                      value={0}
                    />
                    <div className="mt-auto pt-1">
                      <Button variant="outline" onClick={() => setEditing(true)}>
                        Edit Limit
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col gap-2">
                    <div className="text-sm font-medium">On-Demand Usage is Off</div>
                    <p className="text-sm text-muted-foreground">Go beyond your plan&apos;s included quota with on-demand usage</p>
                    <div className="mt-auto pt-2">
                      <Button onClick={() => setOnDemand({ ...onDemand, enabled: true })}>Enable On-Demand Usage</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardDescription>AI Line Edits</CardDescription>
          <CardTitle className="text-3xl font-medium tracking-tight tabular-nums">{pro ? LINES[source] : 0}</CardTitle>
          <CardAction>
            <ToggleGroup variant="outline" size="sm" value={[source]} onValueChange={(value) => value[0] && setSource(value[0] as Source)} aria-label="Source">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="tab">Tab</ToggleGroupItem>
              <ToggleGroupItem value="agent">Agent</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <GitHubActivity
            contributions={days}
            repos={repos}
            heading={false}
            noun="line edit"
            label="Most edited repositories"
            accent="var(--brand)"
            cellSize={16}
            showMonths
            className={pro ? "min-h-[236px] w-full rounded-none bg-transparent p-0 pb-[76px] dark:bg-transparent" : "w-full rounded-none bg-transparent p-0 dark:bg-transparent"}
            style={{ width: "100%" }}
          />
          {pro && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Most Active Month" value="March" />
              <Stat label="Most Active Day" value="Mar 24, 2026" />
              <Stat label="Longest Streak" value="1d" />
              <Stat label="Current Streak" value="1d" />
            </div>
          )}
        </CardContent>
      </Card>

      <Section label="Integrations">
        <IntegrationList />
      </Section>

      {pro && (
        <Card>
          <CardContent className="@container">
            <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Invite Team Members</h3>
                <p className="text-sm text-muted-foreground">Accelerate your team with admin controls, analytics, and enterprise-grade security</p>
              </div>
              <Button variant="outline" className="self-start" onClick={() => toast("Team invites are part of the Teams plan. This is a demo.")}>
                Invite your team
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AdjustPlanDialog current="pro" open={adjust} onOpenChange={setAdjust} />
    </Page>
  );
}

const CHIPS = ["50", "100", "200", "500", "unlimited", "custom"] as const;
type Choice = (typeof CHIPS)[number];

function SpendLimit({ onSave, onCancel }: { onSave: (mode: "fixed" | "unlimited", limit: number) => void; onCancel: () => void }) {
  const [choice, setChoice] = useState<Choice>("50");
  const [custom, setCustom] = useState("5");
  const save = () => {
    if (choice === "unlimited") return onSave("unlimited", 0);
    const amount = choice === "custom" ? Number(custom) : Number(choice);
    if (Number.isFinite(amount) && amount >= 0) onSave("fixed", amount);
  };
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">Set Spend Limit</h3>
        <p className="text-sm text-muted-foreground">Set a monthly spend limit for on-demand usage</p>
      </div>
      <ToggleGroup variant="outline" size="sm" multiple={false} value={[choice]} onValueChange={(value) => value[0] && setChoice(value[0] as Choice)} className="flex-wrap" aria-label="Monthly limit">
        {CHIPS.map((chip) => (
          <ToggleGroupItem key={chip} value={chip} className="px-3">
            {chip === "unlimited" ? "Unlimited" : chip === "custom" ? "Custom" : `$${chip}`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {choice === "custom" && <Input aria-label="Custom limit" className="w-32" inputMode="numeric" autoFocus value={custom} onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ""))} />}
      <div className="flex gap-2">
        <Button onClick={save}>Save</Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
