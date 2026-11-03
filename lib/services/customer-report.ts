import "server-only";
import { db } from "@/db";
import { publicJobNotes } from "@/db/schemas";
import { eq, asc } from "drizzle-orm";
import { getJobDetails } from "@/lib/queries/jobs";
import { toCustomerJobReport } from "@/lib/customer/job-report";
/** Caller authorizes ownership before this loads or signs any job data. */
export async function loadCustomerJobReport(id: string) {
  const report = toCustomerJobReport(await getJobDetails(id));
  const notes = await db
    .select({ text: publicJobNotes.text })
    .from(publicJobNotes)
    .where(eq(publicJobNotes.jobId, id))
    .orderBy(asc(publicJobNotes.createdAt))
    .limit(50);
  return { ...report, publishedNotes: notes.map((n) => n.text) };
}
