"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import { BrandGlyph } from "@/components/aera/brand-glyph";
import { IntegrationItem } from "@/components/aera/integration-item";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { INTEGRATIONS } from "@/lib/demo/cursor-mock";
import { useCursorState } from "./state";
import { Fragment } from "react";

/** The four integrations, as on Overview and on the Integrations page. */
export function IntegrationList() {
  const { plan, connections, setConnected } = useCursorState();
  return (
    <Card className="gap-0 py-0">
      {INTEGRATIONS.map((item, index) => {
        const connected = connections[item.id];
        // On the Free plan Slack can't be connected yet.
        const locked = plan === "free" && item.id === "slack";
        return (
          <Fragment key={item.id}>
            {index > 0 && <Separator />}
            <IntegrationItem
              icon={<BrandGlyph name={item.id} size={18} />}
              name={item.name}
              text={connected ? item.connected : item.text}
              action={
                connected ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" />}>
                      Manage
                      <ChevronDown data-icon="inline-end" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setConnected(item.id, false)}>Disconnect</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="outline" disabled={locked} onClick={() => setConnected(item.id, true)}>
                    Connect
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                )
              }
            />
          </Fragment>
        );
      })}
    </Card>
  );
}
