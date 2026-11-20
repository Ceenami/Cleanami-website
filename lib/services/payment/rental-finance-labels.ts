import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rentalFinanceReady } from "./rental-finance-settings";
import { rows } from "./rental-credit";
export async function financialCancellationKinds(ids: string[]) {
  if (!rentalFinanceReady() || !ids.length) return new Map<string, string>();
  const found = rows<{ job_id: string; cancellation: string }>(await db.execute(sql`select job_id,cancellation from rental_job_finances where job_id in(${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)}) and cancellation is not null`));
  return new Map(found.map(f => [f.job_id, f.cancellation]));
}
