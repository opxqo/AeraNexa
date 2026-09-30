"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OrderDetailPage } from "./order-detail";
import { TicketDetailPage } from "./ticket-detail";

// The detail pages read the number from the query string (?no=, ?id=): see orderHref and ticketHref in nav.ts.

function OrderRoute() {
  return <OrderDetailPage tradeNo={useSearchParams().get("no") ?? ""} />;
}

function TicketRoute() {
  return <TicketDetailPage id={Number(useSearchParams().get("id"))} />;
}

export const OrderDetailRoute = () => (
  <Suspense>
    <OrderRoute />
  </Suspense>
);

export const TicketDetailRoute = () => (
  <Suspense>
    <TicketRoute />
  </Suspense>
);
