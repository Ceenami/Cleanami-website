import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rows } from "@/lib/services/payment/rental-credit";
import { rentalFinanceReady } from "@/lib/services/payment/rental-finance-settings";
import { notificationWorkflowCutoff, workflowRecipientAllowed } from "./workflow-settings";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { getAppBaseUrl } from "@/lib/app-url";

export async function dispatchRentalFinanceNotices() {
  const cutoff = notificationWorkflowCutoff(); if (!cutoff || !rentalFinanceReady()) return;
  const notices = rows<{ identity: string; customer_id: string; job_id: string | null; subject: string; lines: string[] }>(await db.execute(sql`
    update rental_finance_notices set state='claimed' where identity in(select identity from rental_finance_notices where state='pending' and created_at>=${cutoff.toISOString()}::timestamptz order by created_at limit 100 for update skip locked) and state='pending' returning *`));
  for (const notice of notices) {
    let state = "unknown";
    try {
      const outcome = /^([0-9a-f-]{36}):([a-z_]+)$/.exec(notice.identity);
      if (outcome) {
        const [current] = rows<{ state: string }>(await db.execute(sql`select state from rental_financial_operations where id=${outcome[1]}::uuid`));
        if (!current || current.state !== outcome[2]) {
          await db.execute(sql`update rental_finance_notices set state='skipped' where identity=${notice.identity} and state='claimed'`);
          continue;
        }
      }
      const [customer] = rows<{ email: string }>(await db.execute(sql`select email from customers where id=${notice.customer_id}::uuid`));
      if (!customer?.email || !workflowRecipientAllowed(customer.email)) state = "skipped";
      else {
        const result = await sendTransactionalEmail(customer.email, notice.subject, { previewText: notice.subject, heading: notice.subject, bodyLines: notice.lines,
          ctaLabel: notice.job_id ? "View job payment" : "View properties", ctaUrl: `${getAppBaseUrl()}/customer/${notice.job_id ? `job-oversight/${notice.job_id}` : "properties"}` },
        { trigger: "rental_financial_outcome", jobId: notice.job_id });
        state = result.success ? "sent" : result.status === "unknown" ? "unknown" : "failed";
      }
    } catch { /* Interrupted/uncertain delivery is reviewed, never blindly replayed. */ }
    await db.execute(sql`update rental_finance_notices set state=${state} where identity=${notice.identity} and state='claimed'`);
  }
}
