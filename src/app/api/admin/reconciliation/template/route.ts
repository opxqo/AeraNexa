import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/users";
import { reconciliationCsvTemplate } from "@/lib/server/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ message: "没有权限下载对账模板" }, { status: 403 });
  return new NextResponse(reconciliationCsvTemplate, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="aeranexa-reconciliation-template.csv"',
    },
  });
}
