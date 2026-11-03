import "server-only";
import { effectiveChecklist } from "./effective-checklist";
import { db } from "@/db";
import {
  properties,
  propertyChecklistState,
  phase2cAudit,
  jobs,
  propertyAssignmentPolicy,
} from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import {
  basicRentalDraft,
  buildRentalTasks,
  rentalLibrary,
  RENTAL_LIBRARY_VERSION,
  canPublishRentalDraft,
  type ChecklistDraft,
} from "@/lib/checklists/rental-library";
import {
  createChecklistSnapshot,
  isChecklistSnapshot,
  type ChecklistSnapshot,
  type IssuedChecklistFile,
} from "@/lib/cleaner/checklist-snapshot";
import { getRoomPhotoRequirements } from "@/lib/cleaner/evidence";
import type { ResidentialCleaningLevel } from "@/lib/pricing/residential";

export async function getPropertyChecklist(propertyId: string) {
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
  });
  if (!property) throw new Error("Property not found");
  if (property.serviceType === "residential_one_time")
    throw new Error(
      "Residential checklists are company-defined and cannot be customized",
    );
  const [state] = await db
    .select()
    .from(propertyChecklistState)
    .where(eq(propertyChecklistState.propertyId, propertyId));
  return {
    revision: state?.revision ?? 0,
    publishedRevision: state?.publishedRevision ?? 0,
    status: state?.status ?? "basic",
    draft: state?.draft ?? basicRentalDraft(property),
    published:
      state?.published ??
      buildRentalTasks(property, basicRentalDraft(property)),
    library: rentalLibrary(property),
  };
}
export async function savePropertyChecklist(
  propertyId: string,
  draft: ChecklistDraft,
  expectedRevision: number,
  actorId: string,
  review?: { action: "approve" | "reject"; reason: string },
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`checklist:${propertyId}`},0))`,
    );
    const property = await tx.query.properties.findFirst({
      where: eq(properties.id, propertyId),
    });
    if (!property || property.serviceType === "residential_one_time")
      throw new Error("Rental property required");
    const [state] = await tx
      .select()
      .from(propertyChecklistState)
      .where(eq(propertyChecklistState.propertyId, propertyId));
    if ((state?.revision ?? 0) !== expectedRevision)
      throw new Error("Version conflict: reload the checklist before saving");
    if (
      review &&
      (state?.status !== "pending" || review.reason.trim().length < 3)
    )
      throw new Error("A pending revision and review reason are required");
    const effectiveDraft = review ? state!.draft! : draft;
    const items = buildRentalTasks(property, effectiveDraft);
    const revision = expectedRevision + 1;
    const publish = review
      ? review.action === "approve"
      : canPublishRentalDraft(effectiveDraft, state?.published);
    const status = publish ? "published" : review ? "rejected" : "pending";
    await tx
      .insert(propertyChecklistState)
      .values({
        propertyId,
        revision,
        draft: effectiveDraft,
        status,
        publishedRevision: publish ? revision : (state?.publishedRevision ?? 0),
        published: publish ? items : (state?.published ?? null),
      })
      .onConflictDoUpdate({
        target: propertyChecklistState.propertyId,
        set: {
          revision,
          draft: effectiveDraft,
          status,
          publishedRevision: publish
            ? revision
            : (state?.publishedRevision ?? 0),
          published: publish ? items : (state?.published ?? null),
          updatedAt: new Date(),
        },
      });
    await tx.insert(phase2cAudit).values({
      subjectId: propertyId,
      actorId,
      kind: "checklist_revision",
      payload: {
        revision,
        status,
        draft: effectiveDraft,
        reason: review?.reason ?? null,
      },
    });
    return { revision, status };
  });
}
/** Only published data is issued. Existing legacy file snapshots remain readable. */
type ChecklistReader =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function issuePropertyChecklist(
  property: {
    id: string;
    serviceType?: string | null;
    useDefaultChecklist: boolean;
    cleaningLevel?: ResidentialCleaningLevel | null;
    residentialPricing?: unknown;
  },
  files: IssuedChecklistFile[],
  reader: ChecklistReader = db,
): Promise<ChecklistSnapshot> {
  const actualProperty = await reader.query.properties.findFirst({
    where: eq(properties.id, property.id),
  });
  if (!actualProperty) throw new Error("Property not found");
  const photoRequirements = getRoomPhotoRequirements(actualProperty);
  const policy = await reader.query.propertyAssignmentPolicy.findFirst({
    where: eq(propertyAssignmentPolicy.propertyId, property.id),
  });
  const capabilityRequirements = {
    hotTub: policy?.hotTubRequired ?? false,
    laundryLead: policy?.laundryLeadRequired ?? false,
  };
  if (
    property.serviceType === "residential_one_time" &&
    property.residentialPricing &&
    (property.residentialPricing as { ruleVersion?: string }).ruleVersion ===
      "residential-v2"
  ) {
    const issued = createChecklistSnapshot(
      { ...actualProperty, ...property },
      files,
    );
    return {
      ...issued,
      capabilityRequirements: {
        hotTub:
          capabilityRequirements.hotTub ||
          !!issued.capabilityRequirements?.hotTub,
        laundryLead:
          capabilityRequirements.laundryLead ||
          !!issued.capabilityRequirements?.laundryLead,
      },
    };
  }
  if (property.serviceType === "residential_one_time")
    return {
      ...createChecklistSnapshot({ ...actualProperty, ...property }, files),
      photoRequirements,
      capabilityRequirements,
    };
  const [state] = await reader
    .select()
    .from(propertyChecklistState)
    .where(eq(propertyChecklistState.propertyId, property.id));
  // A legacy uploaded guide remains supported. New Basic rentals issue the structured library.
  if (!state && !property.useDefaultChecklist && files.length)
    return {
      ...createChecklistSnapshot(property, files),
      photoRequirements,
      capabilityRequirements,
    };
  return {
    version: 1,
    source: "default",
    defaultVersion: RENTAL_LIBRARY_VERSION,
    propertyRevision: state?.publishedRevision ?? 0,
    items: (
      state?.published ??
      buildRentalTasks(actualProperty, basicRentalDraft(actualProperty))
    ).map((item) => ({ ...item })),
    files: [],
    photoRequirements,
    capabilityRequirements,
  };
}

/** First-reader CAS freezes missing legacy requirements without replacing issued tasks. */
export async function ensureIssuedChecklist(
  jobId: string,
  property: Parameters<typeof issuePropertyChecklist>[0],
  files: IssuedChecklistFile[],
  existing: unknown,
): Promise<ChecklistSnapshot> {
  existing = await effectiveChecklist(jobId, existing);
  if (isChecklistSnapshot(existing) && existing.photoRequirements)
    return existing;
  // Older issued snapshots did not freeze room requirements. Preserve their
  // original JSON; retain the established read fallback without rewriting history.
  if (isChecklistSnapshot(existing)) {
    const originalProperty = await db.query.properties.findFirst({ where: eq(properties.id, property.id) });
    if (!originalProperty) throw new Error("Property not found");
    return { ...existing, photoRequirements: getRoomPhotoRequirements(originalProperty) };
  }
  const candidate = isChecklistSnapshot(existing)
    ? {
        ...existing,
        photoRequirements: getRoomPhotoRequirements(
          (await db.query.properties.findFirst({
            where: eq(properties.id, property.id),
          }))!,
        ),
      }
    : await issuePropertyChecklist(property, files);
  const [saved] = await db
    .update(jobs)
    .set({ checklistSnapshot: candidate, updatedAt: new Date() })
    .where(
      sql`${jobs.id} = ${jobId} and ${jobs.checklistSnapshot} is not distinct from ${existing == null ? null : JSON.stringify(existing)}::jsonb`,
    )
    .returning({ snapshot: jobs.checklistSnapshot });
  if (saved && isChecklistSnapshot(saved.snapshot)) return saved.snapshot;
  const current = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { checklistSnapshot: true },
  });
  if (
    !isChecklistSnapshot(current?.checklistSnapshot) ||
    !current.checklistSnapshot.photoRequirements
  )
    throw new Error("Issued checklist changed; reload before continuing");
  return current.checklistSnapshot;
}
