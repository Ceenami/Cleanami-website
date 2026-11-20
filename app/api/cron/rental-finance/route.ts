import { assertCronAuth } from "@/lib/auth/cron-auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rows } from "@/lib/services/payment/rental-credit";
import { rentalFinanceReady } from "@/lib/services/payment/rental-finance-settings";
import { runOperation, type FinanceOperation } from "@/lib/services/payment/rental-finance-operations";
import { refundCredit } from "@/lib/services/payment/rental-finance-admin";
import { cancelFinancialJob } from "@/lib/services/payment/rental-finance.service";
export async function GET(request: Request) {
  const denied = assertCronAuth(request); if (denied) return denied;
  if (!rentalFinanceReady() || process.env.RENTAL_FINANCE_WORKER_ENABLED !== "true") return Response.json({ disabled: true });
  let processed = 0, review = 0;
  const expired = rows<{ id: string }>(await db.execute(sql`update subscriptions s set status='expired',updated_at=clock_timestamp()
    from rental_finance_contracts c where c.subscription_id=s.id and c.reactivation_terms is not null and s.status::text in('active','paused')
    and (c.reactivation_terms->>'endDate')::date<(clock_timestamp() at time zone 'America/New_York')::date returning s.id`));
  const missing = rows<{ job_id: string }>(await db.execute(sql`select f.job_id from rental_job_finances f where cancellation='late_customer' and not exists(select 1 from rental_financial_operations o where o.identity='late:'||f.job_id::text) order by canceled_at limit 50`));
  for (const item of missing) {
    try { await cancelFinancialJob(item.job_id, "customer", "financial-recovery-worker"); processed++; } catch { review++; }
  }
  const pending = rows<FinanceOperation>(await db.execute(sql`select * from rental_financial_operations where state in('prepared','unknown','processing','submitting') and coalesce(claimed_at,created_at)<clock_timestamp()-interval '5 minutes' order by created_at limit 100`));
  for (const op of pending) {
    try {
      if (op.kind === "credit_refund") await refundCredit(op.entitlement_id!, op.actor, op.reason, op.identity.slice("credit-refund:".length), op.cents);
      else await runOperation(op.identity);
      processed++;
    } catch { review++; }
  }
  return Response.json({ processed, review, expired: expired.length });
}
