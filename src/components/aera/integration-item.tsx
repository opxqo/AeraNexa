import type { ReactNode } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

/** A row for a connectable service: logo, name, status text, and the action on the right. */
export function IntegrationItem({ icon, name, text, action }: { icon: ReactNode; name: ReactNode; text: ReactNode; action: ReactNode }) {
  return (
    <Item size="default" className="px-4 py-3">
      <ItemMedia variant="icon" className="size-9 rounded-lg border bg-background">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription className="line-clamp-2">{text}</ItemDescription>
      </ItemContent>
      <ItemActions>{action}</ItemActions>
    </Item>
  );
}
