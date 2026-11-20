import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { rentalFinanceReady } from "@/lib/services/payment/rental-finance-settings";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rows } from "@/lib/services/payment/rental-credit";
export async function GET(request: NextRequest) {
  if (!(await getAdminAuth(request)).isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const headers = { "Cache-Control": "private, no-store" };
  if (!rentalFinanceReady()) return NextResponse.json({ operations: [], heldCredit: [], missingFees: [], notices: [] }, { headers });
  const operations = rows(await db.execute(sql`select id,job_id,entitlement_id,kind,cents,state,provider_id,last_error,created_at from rental_financial_operations where state in('failed','unknown','review','requires_action','processing','submitting') order by created_at limit 100`));
  const heldCredit = rows(await db.execute(sql`select id,property_id,hold_reason from prepaid_entitlements where state='held' order by created_at limit 100`));
  const missingFees = rows(await db.execute(sql`select f.job_id,(quote->>'chargeAmountCents')::int cents from rental_job_finances f where cancellation='late_customer' and not exists(select 1 from rental_financial_operations o where o.identity='late:'||f.job_id::text) order by canceled_at limit 100`));
  const notices = rows(await db.execute(sql`select identity,job_id,subject,state from rental_finance_notices where state in('claimed','failed','unknown') order by created_at limit 100`));
  return NextResponse.json({ operations, heldCredit, missingFees, notices }, { headers });
}
