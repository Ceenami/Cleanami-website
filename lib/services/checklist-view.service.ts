import "server-only";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, properties, jobsToCleaners, propertyChecklistState, jobEvidenceDrafts, evidenceDrafts, jobExecutionContracts } from "@/db/schemas";
import { effectiveChecklistState } from "./effective-checklist";
import { issuePropertyChecklist } from "./property-checklists";
import { residentialV2ChecklistTasks, type ChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";
import { CHECKLISTS_BUCKET, createSignedUrls } from "@/lib/storage/signed-url";
import { CHECKLIST_SOURCE_LABELS, checklistItemsSchema, checklistSource, checklistViewSchema, safeChecklistUrl, type ChecklistView } from "@/lib/checklists/view";
import { EXECUTION_PROTOCOL, issuedTermsSchema } from "@/lib/jobs/execution-policy";
import { RESIDENTIAL_CHECKLIST_VERSION } from "@/lib/constants/residential-checklist";

export type ChecklistAudience = { kind: "admin" } | { kind: "customer"; customerId: string } | { kind: "cleaner"; cleanerId: string };
export class ChecklistNotFound extends Error {}
const filesSchema = z.array(z.object({ id: z.string().min(1), fileName: z.string().min(1), storagePath: z.string().nullable().optional(), sourceUrl: z.string().nullable().optional() }));
const progressSchema = z.array(z.object({ id: z.string(), task: z.string(), section: z.string().optional(), completed: z.boolean() }));

async function signedFiles(files: ChecklistSnapshot["files"]): Promise<ChecklistView["files"]> {
  const source = filesSchema.parse(files);
  const uploads = source.filter(file => file.storagePath);
  let urls: (string | null)[] = [];
  try { if (uploads.length) urls = await createSignedUrls(CHECKLISTS_BUCKET, uploads.map(f => f.storagePath!)); }
  catch { /* Retain documents and tasks; unavailable URLs do not mean no checklist. */ }
  let index = 0;
  return source.map(file => ({ id: file.id, fileName: file.fileName,
    url: safeChecklistUrl(file.storagePath ? urls[index++] : file.sourceUrl) }));
}
async function snapshotView(snapshot: ChecklistSnapshot | null, base: Omit<ChecklistView, "items" | "files" | "source" | "sourceLabel">,
  context?: Parameters<typeof checklistSource>[1], progress?: unknown): Promise<ChecklistView> {
  if (snapshot) z.object({
    defaultVersion: z.enum(["turnover-v2", "vr-library-v1", "residential-legacy", "residential-company-v2", RESIDENTIAL_CHECKLIST_VERSION]).nullable().optional(),
    origin: z.enum(["default", "customer_custom"]).optional(),
  }).parse(snapshot);
  const items = checklistItemsSchema.parse(snapshot?.items ?? []);
  const files = await signedFiles(snapshot?.files ?? []);
  const source = !items.length && !files.length ? "missing" : snapshot ? checklistSource(snapshot, context) : "recorded";
  const recorded = progress == null ? [] : progressSchema.parse(progress);
  return checklistViewSchema.parse({ ...base, record: source === "missing" ? "missing" : base.record,
    source, sourceLabel: CHECKLIST_SOURCE_LABELS[source], files,
    items: items.map(item => {
      // Reusing an ID after an approved edit must not inherit an old completion.
      const match = recorded.find(r => r.id === item.id && r.task === item.task &&
        (r.section === item.section || (r.section === undefined && base.executionRevision === 0)));
      return { ...item, state: !match ? "not_recorded" : match.completed ? "completed" : "not_completed" };
    }),
  });
}

/** Current preview only. Reuses issuance resolution without persisting a job. */
export async function loadPropertyChecklistView(id: string, level: "standard" | "deep", customerId?: string) {
  const property = await db.query.properties.findFirst({
    where: and(eq(properties.id, id), customerId ? eq(properties.customerId, customerId) : undefined),
    with: { checklistFiles: true },
  });
  if (!property) throw new ChecklistNotFound();
  const residential = property.serviceType === "residential_one_time";
  const snapshot: ChecklistSnapshot = residential ? {
    version: 1, source: "default", defaultVersion: "residential-company-v2", cleaningLevel: level,
    items: residentialV2ChecklistTasks({ cleaningLevel: level, hotTub: "none", inUnitLaundryLoads: 0 }), files: [],
  } : await issuePropertyChecklist(property, property.checklistFiles);
  const state = residential ? null : await db.query.propertyChecklistState.findFirst({ where: eq(propertyChecklistState.propertyId, id) });
  return snapshotView(snapshot, {
    scope: "property", record: "current", revision: snapshot.propertyRevision ?? null, executionRevision: 0,
    completion: null,
    description: residential
      ? `Current company ${level === "deep" ? "Deep (also Move-In/Out)" : "Standard"} template. Purchased add-ons and the exact checklist for a booked clean appear on that job. This preview does not change any booking.`
      : "Current published property checklist. Property changes affect newly issued jobs; older jobs retain their own issued checklists.",
    publicationNotice: state?.status === "pending" ? "Changes await admin review. The last published checklist remains active."
      : state?.status === "rejected" ? "The proposed changes were rejected. The last published checklist remains active." : null,
  }, property);
}

/** Scope in SQL before reading/signing. Never derive an old job from today's property. */
export async function loadJobChecklistView(id: string, audience: ChecklistAudience) {
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, id), audience.kind === "customer"
      ? inArray(jobs.propertyId, db.select({ id: properties.id }).from(properties).where(eq(properties.customerId, audience.customerId)))
      : audience.kind === "cleaner"
        ? inArray(jobs.id, db.select({ id: jobsToCleaners.jobId }).from(jobsToCleaners).where(eq(jobsToCleaners.cleanerId, audience.cleanerId))) : undefined),
    columns: { id: true, checklistSnapshot: true, addonsSnapshot: true },
    with: { evidencePacket: { columns: { checklistLog: true, isChecklistComplete: true, finalEvidenceSubmittedAt: true } } },
  });
  if (!job) throw new ChecklistNotFound();
  const effective = await effectiveChecklistState(id, job.checklistSnapshot);
  let snapshot = effective.snapshot;
  if (!snapshot) {
    const contract = await db.query.jobExecutionContracts.findFirst({ where: eq(jobExecutionContracts.jobId, id) });
    if (contract) {
      if (contract.protocol !== EXECUTION_PROTOCOL) throw new Error("Unsupported checklist protocol");
      const issued = issuedTermsSchema.parse(contract.terms);
      snapshot = { version: 1, source: "default", defaultVersion: null, items: issued.checklist, files: [] };
    }
  }
  const packet = job.evidencePacket;
  const log = packet?.checklistLog as { items?: unknown } | null;
  let progress = log?.items;
  let completion: ChecklistView["completion"] = progress ? packet?.finalEvidenceSubmittedAt || packet?.isChecklistComplete ? "submitted" : "recorded" : null;
  // Private draft text/notes never enter this DTO; customer sees recorded evidence only.
  if (audience.kind !== "customer" && completion !== "submitted") {
    const draft = await db.query.jobEvidenceDrafts.findFirst({ where: eq(jobEvidenceDrafts.jobId, id), columns: { items: true } });
    if (draft) { progress = draft.items; completion = "draft"; }
    else if (audience.kind === "cleaner") {
      const legacy = await db.query.evidenceDrafts.findFirst({ where: and(eq(evidenceDrafts.jobId, id), eq(evidenceDrafts.cleanerId, audience.cleanerId)), columns: { state: true } });
      if (legacy?.state?.checklistLog) { progress = legacy.state.checklistLog.items; completion = "draft"; }
    }
  }
  const record = snapshot ? "issued" : progress ? "legacy_record" : "missing";
  if (!snapshot && progress) snapshot = {
    version: 1, source: "default", defaultVersion: null, items: checklistItemsSchema.parse(progress), files: [],
  };
  const addons = job.addonsSnapshot;
  const context = typeof addons?.petsAllowed === "boolean" && typeof addons.laundryType === "string" && typeof addons.hotTubServiceLevel === "string"
    ? { petsAllowed: addons.petsAllowed, laundryType: addons.laundryType, hotTubServiceLevel: addons.hotTubServiceLevel !== "none" } : undefined;
  const view = await snapshotView(snapshot, {
    scope: "job", record, revision: snapshot?.propertyRevision ?? null, executionRevision: effective.revision,
    publicationNotice: null, completion,
    description: record === "legacy_record" ? "Recorded task history only; no original issued checklist is available. Today's property checklist has not been substituted."
      : record === "missing" ? "No issued checklist or recorded tasks are available for this job. Contact management."
        : effective.revision ? "Effective checklist from an approved job reissue. The original issued checklist is preserved in history."
          : "Checklist issued for this clean. Later property edits do not change it.",
  }, context, progress);
  if (record === "legacy_record" && view.source !== "missing") { view.source = "recorded"; view.sourceLabel = CHECKLIST_SOURCE_LABELS.recorded; }
  return view;
}
