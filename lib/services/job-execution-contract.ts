import "server-only";
import { db, type Database } from "@/db";
import { jobs, properties, jobExecutionContracts } from "@/db/schemas";
import { eq } from "drizzle-orm";
import {
  EXECUTION_PROTOCOL,
  EXECUTION_ZONE,
  issuedTermsSchema,
} from "@/lib/jobs/execution-policy";
import {
  getRoomPhotoRequirements,
  getExpectedChecklistItemsFromSnapshot,
} from "@/lib/cleaner/evidence";
import {
  createChecklistSnapshot,
  isChecklistSnapshot,
} from "@/lib/cleaner/checklist-snapshot";

export function enrollmentEnabled() {
  return process.env.JOB_EXECUTION_ENROLLMENT === "true";
}
export async function getExecutionContract(jobId: string, database: Database | Transaction = db) {
  const [row] = await database
    .select({ contract: jobExecutionContracts, start: jobs.checkInTime, deadline: jobs.checkOutTime })
    .from(jobExecutionContracts)
    .innerJoin(jobs, eq(jobs.id, jobExecutionContracts.jobId))
    .where(eq(jobExecutionContracts.jobId, jobId));
  if (!row) return null;
  if (row.contract.protocol !== EXECUTION_PROTOCOL)
    throw Error("Unsupported issued execution protocol");
  const terms = issuedTermsSchema.parse(row.contract.terms);
  // SQL0053 only permits audited unstarted schedule revisions. Original issued
  // terms stay immutable; every workflow consumes the same effective schedule.
  return issuedTermsSchema.parse({ ...terms, plannedStart: row.start?.toISOString(), plannedDeadline: row.deadline?.toISOString() });
}
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Only rows returned by INSERT DO NOTHING can be enrolled. Contracts and jobs commit together. */
export async function insertIssuedJobs(
  database: Database | Transaction,
  values: (typeof jobs.$inferInsert)[],
  expectedProperty?: { id: string; defaultCheckOutTime: string | null; defaultCheckInTime: string | null; iCalUrl: string | null },
) {
  if (!values.length) return [];
  return database.transaction(async (tx) => {
    // A calendar sync computed outside this transaction must not insert a stale
    // 09:00 schedule after a concurrent property edit committed 10:00.
    if (expectedProperty) {
      const [fresh] = await tx.select().from(properties).where(eq(properties.id, expectedProperty.id)).for("share");
      if (!fresh || fresh.defaultCheckOutTime !== expectedProperty.defaultCheckOutTime || fresh.defaultCheckInTime !== expectedProperty.defaultCheckInTime || fresh.iCalUrl !== expectedProperty.iCalUrl)
        throw Error("Property times changed during calendar sync; retry the sync");
    }
    const inserted = await tx
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: jobs.calendarEventUid })
      .returning();
    if (!enrollmentEnabled()) return inserted;
    for (const job of inserted) {
      if (!job.propertyId || !job.checkInTime || !job.checkOutTime)
        throw Error("New execution job requires a property and planned window");
      const property = await tx.query.properties.findFirst({
        where: eq(properties.id, job.propertyId),
        with: { checklistFiles: true },
      });
      if (!property) throw Error("New execution property is missing");
      const snapshot = isChecklistSnapshot(job.checklistSnapshot)
        ? job.checklistSnapshot
        : createChecklistSnapshot(property, property.checklistFiles);
      // Newly created residential jobs also need their issued checklist stored, never lazily inferred later.
      if (!job.checklistSnapshot)
        await tx
          .update(jobs)
          .set({ checklistSnapshot: snapshot })
          .where(eq(jobs.id, job.id));
      const hours = Number(job.expectedHours);
      if (!Number.isFinite(hours) || hours <= 0)
        throw Error("New issued job requires valid expected hours");
      if (+job.checkOutTime - +job.checkInTime < hours * 3600000)
        throw Error(
          "Issued cleaning window is shorter than the required work; manual review required",
        );
      const terms = issuedTermsSchema.parse({
        protocol: EXECUTION_PROTOCOL,
        plannedStart: job.checkInTime.toISOString(),
        plannedDeadline: job.checkOutTime.toISOString(),
        timezone: EXECUTION_ZONE,
        calendarIdentity: job.calendarEventUid,
        source: job.jobSource,
        propertyCheckOutTime: property.defaultCheckOutTime,
        propertyCheckInTime: property.defaultCheckInTime,
        rooms: getRoomPhotoRequirements(property),
        checklist: getExpectedChecklistItemsFromSnapshot(snapshot),
      });
      await tx
        .insert(jobExecutionContracts)
        .values({ jobId: job.id, protocol: EXECUTION_PROTOCOL, terms });
    }
    return inserted;
  });
}
