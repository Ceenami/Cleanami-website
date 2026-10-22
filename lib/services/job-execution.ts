import "server-only";
import { createHash } from "node:crypto";
import { db, type Database } from "@/db";
import {
  cleaners,
  evidencePackets,
  evidenceUploadManifest,
  gpsTrackingLogs,
  jobEvidenceDrafts,
  jobOperationAudit,
  jobs,
  jobsToCleaners,
  reliabilityEvents,
} from "@/db/schemas";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { getExecutionContract } from "./job-execution-contract";
import {
  assertCaptureWindow,
  type IssuedTerms,
} from "@/lib/jobs/execution-policy";
import { createAdminClient } from "@/lib/supabase/server";
import {
  CHECKLISTS_BUCKET,
  EVIDENCE_BUCKET,
  createSignedUrl,
} from "@/lib/storage/signed-url";
import {
  evaluateArrival,
  evaluateGeofence,
  type DeviceLocation,
} from "./gps/geofence";
import {
  classifyArrival,
  latenessPenaltyPoints,
} from "./reliability/reliability.service";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export class ExecutionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export const deviceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable().optional(),
});
const reservationSchema = z.object({
  uploadId: z.uuid(),
  roomKey: z.string(),
  source: z.enum(["camera", "gallery"]).default("camera"),
  capturedAt: z.iso.datetime().nullable().default(null),
  byteSize: z.number().int().positive().max(10485760),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(
  (photo) => photo.source === "camera" ? photo.capturedAt !== null : photo.capturedAt === null,
  "Camera photos require a capture time; selected images must leave capture time unknown",
);
const draftSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z
    .array(z.object({ id: z.string().max(200), completed: z.boolean() }))
    .max(500),
  notes: z.string().max(10000).default(""),
});
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

/** Lock order: job -> cleaner -> packet/draft/manifest. Assignment writes lock the parent job in SQL;
 * authorization reads do not lock the child row (avoids inverse trigger lock order).
 * Sibling jobs are read, never locked or auto-closed. No network I/O inside this scope. */
async function locked<T>(
  jobId: string,
  cleanerId: string,
  work: (
    tx: Tx,
    job: typeof jobs.$inferSelect,
    packet: typeof evidencePackets.$inferSelect | undefined,
    contract: IssuedTerms,
  ) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!job) throw new ExecutionError("Job not found", 404);
    const contract = await getExecutionContract(jobId, tx);
    if (!contract) throw new ExecutionError("This job uses the existing workflow", 404);
    await tx
      .select({ id: cleaners.id })
      .from(cleaners)
      .where(eq(cleaners.id, cleanerId))
      .for("update");
    const [assignment] = await tx
      .select()
      .from(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.cleanerId, cleanerId),
        ),
      );
    if (!assignment || !["primary", "laundry_lead"].includes(assignment.role))
      throw new ExecutionError("A current working assignment is required", 403);
    if (job.status === "canceled" || job.paymentStatus === "refunded")
      throw new ExecutionError("Canceled or refunded jobs cannot be changed");
    const [packet] = await tx
      .select()
      .from(evidencePackets)
      .where(eq(evidencePackets.jobId, jobId));
    return work(tx, job, packet, contract);
  });
}
function writable(
  job: typeof jobs.$inferSelect,
  packet: typeof evidencePackets.$inferSelect | undefined,
) {
  if (
    packet?.finalEvidenceSubmittedAt ||
    !["in-progress", "completed_pending_evidence"].includes(job.status ?? "")
  )
    throw new ExecutionError("Evidence is not open for changes");
}
async function audit(
  tx: Tx,
  jobId: string,
  actor: string,
  operation: string,
  identity: string,
) {
  await tx
    .insert(jobOperationAudit)
    .values({ jobId, actor, operation, identity })
    .onConflictDoNothing();
}

export async function recordExecutionVisit(
  jobId: string,
  cleanerId: string,
  operation: "arrival" | "departure",
  device: DeviceLocation | null,
  overrideReason?: string,
) {
  const contract = await getExecutionContract(jobId);
  if (!contract) throw new ExecutionError("Execution contract missing", 404);
  const before = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!before?.propertyId) throw new ExecutionError("Property not found", 404);
  // Geocoding/provider access is outside all transaction locks.
  const fence = await evaluateGeofence(before.propertyId, device);
  return locked(jobId, cleanerId, async (tx, job, packet, issued) => {
    const prior =
      operation === "arrival"
        ? packet?.gpsCheckInTimestamp
        : packet?.gpsCheckOutTimestamp;
    if (prior)
      return {
        success: true,
        alreadyRecorded: true,
        recordedAt: prior.toISOString(),
      };
    const now = new Date();
    if (operation === "arrival") {
      if (job.status !== "assigned")
        throw new ExecutionError("Only an assigned job can be started");
      if (+now < Date.parse(issued.plannedStart))
        throw new ExecutionError(
          `Check-in opens at ${new Date(issued.plannedStart).toLocaleTimeString("en-US", { timeZone: issued.timezone })}`,
        );
      const needsOverride =
        fence.verdict === "outside" || fence.reason === "no_device_location";
      if (
        needsOverride &&
        (!overrideReason ||
          overrideReason.trim().length < 10 ||
          overrideReason.length > 500)
      )
        throw new ExecutionError(
          "Your location is outside the property's geofence or could not be verified. To check in with a location override, enter a reason of 10–500 characters.",
        );
      const siblings = await tx
        .select({ id: jobs.id })
        .from(jobsToCleaners)
        .innerJoin(jobs, eq(jobs.id, jobsToCleaners.jobId))
        .where(
          and(
            eq(jobsToCleaners.cleanerId, cleanerId),
            ne(jobs.id, jobId),
            eq(jobs.status, "in-progress"),
            inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
          ),
        );
      if (siblings.length)
        throw new ExecutionError(
          "Record departure from your other active visit before starting this job",
        );
      const arrival = evaluateArrival(new Date(issued.plannedStart), now)!;
      const fields = {
        gpsCheckInTimestamp: now,
        checkInLatitude: device ? String(device.latitude) : null,
        checkInLongitude: device ? String(device.longitude) : null,
        checkInAccuracyMeters:
          device?.accuracy == null ? null : String(device.accuracy),
        checkInDistanceMiles:
          fence.distanceMiles == null ? null : String(fence.distanceMiles),
        checkInWithinGeofence: fence.withinGeofence,
        arrivalDelayMinutes: arrival.delayMinutes,
        arrivalOnTime: arrival.onTime,
        checkInOverrideReason: needsOverride ? overrideReason!.trim() : null,
        checkInOverrideAt: needsOverride ? now : null,
        updatedAt: now,
      };
      if (packet)
        await tx
          .update(evidencePackets)
          .set(fields)
          .where(eq(evidencePackets.jobId, jobId));
      else
        await tx
          .insert(evidencePackets)
          .values({ jobId, status: "incomplete", ...fields });
      await tx
        .update(jobs)
        .set({ status: "in-progress", updatedAt: now })
        .where(eq(jobs.id, jobId));
      await tx
        .update(cleaners)
        .set({ onCallStatus: "on_job", updatedAt: now })
        .where(eq(cleaners.id, cleanerId));
      const eventType = classifyArrival(arrival.delayMinutes, 10);
      await tx.insert(reliabilityEvents).values({
        jobId,
        cleanerId,
        eventType,
        penaltyPoints:
          eventType === "late_arrival"
            ? latenessPenaltyPoints(arrival.delayMinutes)
            : 0,
        notes: `Issued schedule arrival: ${arrival.delayMinutes} min`,
      });
      // The score is derived from existing and new events; no historical event is rewritten.
      const since = new Date(+now - 90 * 86400000);
      const all = await tx
        .select({
          type: reliabilityEvents.eventType,
          at: reliabilityEvents.createdAt,
        })
        .from(reliabilityEvents)
        .where(eq(reliabilityEvents.cleanerId, cleanerId));
      const recent = all.filter((e) => +e.at >= +since);
      const score = Math.round(
        (100 *
          recent.filter((e) => ["on_time", "early_arrival"].includes(e.type))
            .length) /
          recent.length,
      );
      await tx
        .update(cleaners)
        .set({ reliabilityScore: score.toFixed(2) })
        .where(eq(cleaners.id, cleanerId));
    } else {
      writable(job, packet);
      if (!packet?.gpsCheckInTimestamp || job.status !== "in-progress")
        throw new ExecutionError("Record arrival before departure");
      await tx
        .update(evidencePackets)
        .set({
          gpsCheckOutTimestamp: now,
          checkOutLatitude: device ? String(device.latitude) : null,
          checkOutLongitude: device ? String(device.longitude) : null,
          checkOutAccuracyMeters:
            device?.accuracy == null ? null : String(device.accuracy),
          checkOutDistanceMiles:
            fence.distanceMiles == null ? null : String(fence.distanceMiles),
          checkOutWithinGeofence: fence.withinGeofence,
          updatedAt: now,
        })
        .where(eq(evidencePackets.jobId, jobId));
      await tx
        .update(jobs)
        .set({ status: "completed_pending_evidence", updatedAt: now })
        .where(eq(jobs.id, jobId));
      const siblings = await tx
        .select({ id: jobs.id })
        .from(jobsToCleaners)
        .innerJoin(jobs, eq(jobs.id, jobsToCleaners.jobId))
        .where(
          and(
            eq(jobsToCleaners.cleanerId, cleanerId),
            ne(jobs.id, jobId),
            eq(jobs.status, "in-progress"),
            inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
          ),
        );
      if (!siblings.length)
        await tx
          .update(cleaners)
          .set({ onCallStatus: "available", updatedAt: now })
          .where(
            and(
              eq(cleaners.id, cleanerId),
              eq(cleaners.onCallStatus, "on_job"),
            ),
          );
    }
    if (device)
      await tx.insert(gpsTrackingLogs).values({
        jobId,
        cleanerId,
        activityType: operation,
        latitude: String(device.latitude),
        longitude: String(device.longitude),
        accuracy: device.accuracy == null ? null : String(device.accuracy),
        metadata: {
          protocol: issued.protocol,
          geofenceVerdict: fence.verdict,
        },
      });
    await audit(tx, jobId, cleanerId, operation, "first");
    return {
      success: true,
      recordedAt: now.toISOString(),
      pendingEvidence: operation === "departure",
    };
  });
}

export async function reserveExecutionUpload(
  jobId: string,
  cleanerId: string,
  raw: unknown,
) {
  const input = reservationSchema.parse(raw);
  const row = await locked(
    jobId,
    cleanerId,
    async (tx, job, packet, issued) => {
      writable(job, packet);
      if (!issued.rooms.some((r) => r.roomKey === input.roomKey))
        throw new ExecutionError("Unknown issued room", 400);
      if (!packet?.gpsCheckInTimestamp)
        throw new ExecutionError("Record arrival before adding evidence");
      if (input.source === "camera")
        assertCaptureWindow(
          new Date(input.capturedAt!),
          packet.gpsCheckInTimestamp,
          packet.gpsCheckOutTimestamp,
        );
      const [old] = await tx
        .select()
        .from(evidenceUploadManifest)
        .where(eq(evidenceUploadManifest.uploadId, input.uploadId));
      if (old) {
        if (
          old.jobId !== jobId ||
          old.cleanerId !== cleanerId ||
          old.roomKey !== input.roomKey ||
          old.sha256 !== input.sha256 ||
          old.byteSize !== input.byteSize ||
          old.mime !== input.mime ||
          old.source !== input.source ||
          (old.capturedAt ? +old.capturedAt : null) !== (input.capturedAt ? Date.parse(input.capturedAt) : null) ||
          old.state === "removed"
        )
          throw new ExecutionError(
            "Upload ID already belongs to different evidence",
          );
        return old;
      }
      const ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[input.mime];
      const path = `${cleanerId}/${jobId}/issued/${input.uploadId}.${ext}`;
      const [created] = await tx
        .insert(evidenceUploadManifest)
        .values({
          ...input,
          capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
          jobId,
          cleanerId,
          path,
        })
        .returning();
      return created;
    },
  );
  if (row.state === "verified")
    return { uploadId: row.uploadId, path: row.path, verified: true };
  const client = createAdminClient();
  const { data, error } = await client.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUploadUrl(row.path, { upsert: false });
  if (error || !data)
    throw new ExecutionError(
      "Could not authorize upload; retry with the same photo",
      503,
    );
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const host = origin.hostname.endsWith(".supabase.co")
    ? origin.hostname.replace(".supabase.co", ".storage.supabase.co")
    : origin.hostname;
  return {
    uploadId: row.uploadId,
    path: row.path,
    token: data.token,
    bucket: EVIDENCE_BUCKET,
    endpoint: `${origin.protocol}//${host}${origin.port ? `:${origin.port}` : ""}/storage/v1/upload/resumable`,
    verified: false,
  };
}

export async function acknowledgeExecutionUpload(
  jobId: string,
  cleanerId: string,
  uploadId: string,
) {
  z.uuid().parse(uploadId);
  const [row] = await db
    .select()
    .from(evidenceUploadManifest)
    .where(
      and(
        eq(evidenceUploadManifest.uploadId, uploadId),
        eq(evidenceUploadManifest.jobId, jobId),
        eq(evidenceUploadManifest.cleanerId, cleanerId),
      ),
    );
  if (!row) throw new ExecutionError("Upload reservation not found", 404);
  // Only the reserved object is fetched. Decode fully to reject truncated files/MIME spoofing.
  const { data, error } = await createAdminClient()
    .storage.from(EVIDENCE_BUCKET)
    .download(row.path);
  if (error || !data)
    throw new ExecutionError(
      "Upload has not reached storage; retry transfer",
      409,
    );
  if (data.size !== row.byteSize || data.size > 10485760)
    throw new ExecutionError("Stored image size does not match", 400);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (sha(bytes) !== row.sha256)
    throw new ExecutionError("Stored image differs from reserved photo", 409);
  try {
    const image = sharp(bytes, { limitInputPixels: 40000000 });
    const metadata = await image.metadata();
    if (
      (
        { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<
          string,
          string
        >
      )[metadata.format ?? ""] !== row.mime
    )
      throw Error("format");
    await image.stats();
  } catch {
    throw new ExecutionError(
      "Image cannot be decoded. Capture a JPEG, PNG or WebP photo",
      400,
    );
  }
  await locked(jobId, cleanerId, async (tx, job, packet) => {
    writable(job, packet);
    const [current] = await tx
      .select()
      .from(evidenceUploadManifest)
      .where(eq(evidenceUploadManifest.uploadId, uploadId));
    if (!current || current.state === "removed")
      throw new ExecutionError("Photo has been removed");
    if (!packet?.gpsCheckInTimestamp)
      throw new ExecutionError("Record arrival before adding evidence");
    if (current.source === "camera") {
      if (!current.capturedAt) throw new ExecutionError("Camera capture time missing");
      assertCaptureWindow(current.capturedAt, packet.gpsCheckInTimestamp, packet.gpsCheckOutTimestamp);
    } else if (current.source !== "gallery" || current.capturedAt !== null) {
      throw new ExecutionError("Invalid photo source");
    }
    if (current.state !== "verified")
      await tx
        .update(evidenceUploadManifest)
        .set({ state: "verified", verifiedAt: new Date() })
        .where(eq(evidenceUploadManifest.uploadId, uploadId));
    await audit(tx, jobId, cleanerId, "upload_verified", uploadId);
  });
  return {
    success: true,
    uploadId,
    path: row.path,
    url: await createSignedUrl(EVIDENCE_BUCKET, row.path),
    verified: true,
  };
}

export async function saveExecutionDraft(
  jobId: string,
  cleanerId: string,
  raw: unknown,
  finalize = false,
) {
  const input = draftSchema.parse(raw);
  return locked(jobId, cleanerId, async (tx, job, packet, issued) => {
    const items = issued.checklist.map((item) => ({
      ...item,
      completed: input.items.find((i) => i.id === item.id)?.completed === true,
    }));
    if (
      new Set(input.items.map((i) => i.id)).size !== input.items.length ||
      input.items.some((i) => !issued.checklist.some((e) => e.id === i.id))
    )
      throw new ExecutionError("Checklist does not match the issued job", 400);
    const uploads = await tx
      .select()
      .from(evidenceUploadManifest)
      .where(eq(evidenceUploadManifest.jobId, jobId));
    const verified = uploads
      .filter((u) => u.state === "verified")
      .sort((a, b) => a.uploadId.localeCompare(b.uploadId));
    const hash = sha(
      JSON.stringify({
        items,
        notes: input.notes,
        uploads: verified.map((u) => [u.uploadId, u.sha256]),
      }),
    );
    const [draft] = await tx
      .select()
      .from(jobEvidenceDrafts)
      .where(eq(jobEvidenceDrafts.jobId, jobId));
    if (packet?.finalEvidenceSubmittedAt) {
      if (finalize && draft?.finalHash === hash)
        return {
          success: true,
          isSubmitted: true,
          finalEvidenceSubmittedAt:
            packet.finalEvidenceSubmittedAt.toISOString(),
          revision: draft.revision,
        };
      throw new ExecutionError("Final evidence cannot be changed");
    }
    writable(job, packet);
    if ((draft?.revision ?? 0) !== input.revision)
      throw new ExecutionError(
        "Progress changed on another device. Reload before saving; your local photos are retained",
      );
    const roomPhotos: Record<string, string[]> = {};
    for (const upload of verified)
      (roomPhotos[upload.roomKey] ??= []).push(upload.path);
    const now = new Date();
    if (finalize) {
      if (!packet?.gpsCheckInTimestamp || !packet.gpsCheckOutTimestamp)
        throw new ExecutionError(
          "Record physical departure before final submission",
        );
      if (
        !items.every((i) => i.completed) ||
        issued.rooms.some(
          (r) => (roomPhotos[r.roomKey]?.length ?? 0) < r.minPhotos,
        )
      )
        throw new ExecutionError(
          "Complete all issued checklist and room-photo requirements",
        );
      if (uploads.some((u) => u.state === "reserved"))
        throw new ExecutionError(
          "Finish or remove pending uploads before final submission",
        );
      await tx
        .update(evidencePackets)
        .set({
          photoUrls: verified.map((u) => u.path),
          checklistLog: { items, roomPhotos },
          cleanerNotes: input.notes,
          isChecklistComplete: true,
          status: "complete",
          finalEvidenceSubmittedAt: now,
          updatedAt: now,
        })
        .where(eq(evidencePackets.jobId, jobId));
      await tx
        .update(jobs)
        .set({ status: "awaiting_capture", updatedAt: now })
        .where(eq(jobs.id, jobId));
      await audit(tx, jobId, cleanerId, "finalize", hash);
    }
    const value = {
      jobId,
      revision: input.revision + 1,
      items,
      notes: input.notes,
      finalHash: finalize ? hash : null,
      updatedAt: now,
    };
    await tx
      .insert(jobEvidenceDrafts)
      .values(value)
      .onConflictDoUpdate({ target: jobEvidenceDrafts.jobId, set: value });
    return {
      success: true,
      draftSaved: true,
      revision: value.revision,
      isSubmitted: finalize,
      finalEvidenceSubmittedAt: finalize ? now.toISOString() : null,
    };
  });
}

export async function removeExecutionUpload(
  jobId: string,
  cleanerId: string,
  uploadId: string,
) {
  z.uuid().parse(uploadId);
  return locked(jobId, cleanerId, async (tx, job, packet) => {
    writable(job, packet);
    const result = await tx
      .update(evidenceUploadManifest)
      .set({ state: "removed" })
      .where(
        and(
          eq(evidenceUploadManifest.jobId, jobId),
          eq(evidenceUploadManifest.cleanerId, cleanerId),
          eq(evidenceUploadManifest.uploadId, uploadId),
        ),
      )
      .returning();
    if (!result.length) throw new ExecutionError("Photo not found", 404);
    await audit(tx, jobId, cleanerId, "upload_removed", uploadId);
    return { success: true };
  });
}

export async function getExecutionEvidence(jobId: string, cleanerId: string) {
  const contract = await getExecutionContract(jobId);
  if (!contract) return null;
  const [assignment] = await db
    .select()
    .from(jobsToCleaners)
    .where(
      and(
        eq(jobsToCleaners.jobId, jobId),
        eq(jobsToCleaners.cleanerId, cleanerId),
      ),
    );
  if (!assignment || !["primary", "laundry_lead"].includes(assignment.role))
    throw new ExecutionError("Working assignment required", 403);
  const [packet] = await db
    .select()
    .from(evidencePackets)
    .where(eq(evidencePackets.jobId, jobId));
  const [draft] = await db
    .select()
    .from(jobEvidenceDrafts)
    .where(eq(jobEvidenceDrafts.jobId, jobId));
  const uploads = await db
    .select()
    .from(evidenceUploadManifest)
    .where(eq(evidenceUploadManifest.jobId, jobId));
  const roomPhotos: Record<string, string[]> = {},
    roomPhotoPreviews: Record<string, string[]> = {};
  const photos = [];
  for (const u of uploads) {
    if (u.state === "removed") continue;
    const url =
      u.state === "verified"
        ? await createSignedUrl(EVIDENCE_BUCKET, u.path)
        : null;
    photos.push({
      uploadId: u.uploadId,
      roomKey: u.roomKey,
      path: u.path,
      state: u.state,
      source: u.source,
      capturedAt: u.capturedAt?.toISOString() ?? null,
      url,
      mine: u.cleanerId === cleanerId,
    });
    if (u.state === "verified") {
      (roomPhotos[u.roomKey] ??= []).push(u.path);
      (roomPhotoPreviews[u.roomKey] ??= []).push(url ?? "");
    }
  }
  const issuedJob = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { checklistSnapshot: true },
  });
  const checklistFiles = [];
  for (const file of issuedJob?.checklistSnapshot?.files ?? [])
    checklistFiles.push({
      id: file.id,
      fileName: file.fileName,
      url: file.storagePath
        ? ((await createSignedUrl(CHECKLISTS_BUCKET, file.storagePath)) ?? "")
        : (file.sourceUrl ?? ""),
    });
  return {
    protocol: contract.protocol,
    queueOwner: cleanerId,
    jobId,
    roomRequirements: contract.rooms,
    checklistItems: contract.checklist.map((i) => ({
      ...i,
      completed: draft?.items.find((d) => d.id === i.id)?.completed ?? false,
    })),
    checklistFiles,
    roomPhotos,
    roomPhotoPreviews,
    photos,
    cleanerNotes: draft?.notes ?? "",
    revision: draft?.revision ?? 0,
    draftSaved: !!draft,
    arrivalRecorded: !!packet?.gpsCheckInTimestamp,
    departureRecorded: !!packet?.gpsCheckOutTimestamp,
    finalEvidenceSubmittedAt:
      packet?.finalEvidenceSubmittedAt?.toISOString() ?? null,
    isSubmitted: !!packet?.finalEvidenceSubmittedAt,
  };
}
