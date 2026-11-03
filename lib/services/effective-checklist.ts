import "server-only";
import { db } from "@/db";
import { phase2cAudit } from "@/db/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import { isChecklistSnapshot, type ChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";

type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Audited reissues layer over the immutable original acceptance record. */
export async function latestChecklistRevision(jobId: string, reader: Reader = db) {
  const [row] = await reader.select().from(phase2cAudit).where(and(
    eq(phase2cAudit.subjectId, jobId), eq(phase2cAudit.kind, "checklist_reissued"),
  )).orderBy(desc(sql`coalesce((${phase2cAudit.payload}->>'executionRevision')::bigint,0)`), desc(phase2cAudit.createdAt), desc(phase2cAudit.id)).limit(1);
  if (!row) return null;
  if (!isChecklistSnapshot(row.payload.next)) throw new Error("Recorded checklist revision requires review");
  const revision = Number(row.payload.executionRevision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid checklist revision");
  return { snapshot: row.payload.next, revision };
}
export async function effectiveChecklist(jobId: string, original: unknown, reader: Reader = db): Promise<ChecklistSnapshot | null> {
  const revised = await latestChecklistRevision(jobId, reader);
  if (revised) return revised.snapshot;
  if (original == null) return null;
  if (!isChecklistSnapshot(original)) throw new Error("Issued checklist requires review");
  return original;
}
