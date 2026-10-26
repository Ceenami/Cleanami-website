import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db } from "@/db";
import { evidencePackets, jobExecutionContracts, jobs, jobsToCleaners, properties } from "@/db/schemas";
import { getRoomPhotoRequirements, type RoomPhotosMap } from "@/lib/cleaner/evidence";
import { createAdminClient } from "@/lib/supabase/server";
import { createSignedUrl, EVIDENCE_BUCKET, toStoragePath } from "@/lib/storage/signed-url";

export class LegacyUploadError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const photoSchema = z.object({
  uploadId: z.uuid(), roomKey: z.string().max(100),
  byteSize: z.number().int().positive().max(3 * 1024 * 1024),
  mime: z.literal("image/jpeg"), sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const ticketSchema = photoSchema.extend({
  jobId: z.uuid(), cleanerId: z.uuid(), issuedAt: z.number().int().positive(),
});
type Ticket = z.infer<typeof ticketSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Separate signing purpose; never send this key or signed Storage credentials to logs/local storage.
function mac(payload: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new LegacyUploadError("Upload authorization unavailable; retry later", 503);
  return createHmac("sha256", key).update("legacy-evidence-upload-v1:" + payload).digest();
}
function sign(ticket: Ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}
function verify(receipt: string, jobId: string, cleanerId: string) {
  if (receipt.length > 2000) throw new LegacyUploadError("Invalid upload receipt", 400);
  const [payload, signature, extra] = receipt.split(".");
  const expected = mac(payload ?? "");
  const actual = Buffer.from(signature ?? "", "base64url");
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new LegacyUploadError("Invalid upload receipt", 403);
  const ticket = ticketSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  if (ticket.jobId !== jobId || ticket.cleanerId !== cleanerId)
    throw new LegacyUploadError("This photo belongs to another job or account", 403);
  return ticket;
}
const objectPath = (ticket: Ticket) =>
  `${ticket.cleanerId}/${ticket.jobId}/${ticket.roomKey}/legacy-${ticket.uploadId}.jpg`;

/** Same parent-job lock for acknowledgement, removal and final submission. No network I/O under locks. */
async function locked<T>(jobId: string, cleanerId: string, work: (
  tx: Tx, packet: typeof evidencePackets.$inferSelect, rooms: string[],
) => Promise<T>) {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job) throw new LegacyUploadError("Job not found", 404);
    const [assignment] = await tx.select().from(jobsToCleaners).where(and(
      eq(jobsToCleaners.jobId, jobId), eq(jobsToCleaners.cleanerId, cleanerId),
    ));
    if (!assignment || !["primary", "laundry_lead"].includes(assignment.role))
      throw new LegacyUploadError("A current working assignment is required", 403);
    const [contract] = await tx.select({ id: jobExecutionContracts.jobId }).from(jobExecutionContracts).where(eq(jobExecutionContracts.jobId, jobId));
    if (contract) throw new LegacyUploadError("Reload this job to use its issued evidence form");
    const [packet] = await tx.select().from(evidencePackets).where(eq(evidencePackets.jobId, jobId)).for("update");
    if (!packet?.gpsCheckInTimestamp || packet.finalEvidenceSubmittedAt || job.paymentStatus === "refunded" ||
      !["in-progress", "completed_pending_evidence"].includes(job.status ?? ""))
      throw new LegacyUploadError("Evidence is not open for changes. Your local photos are retained.");
    const [property] = await tx.select().from(properties).where(eq(properties.id, job.propertyId!));
    if (!property) throw new LegacyUploadError("Property not found", 404);
    return work(tx, packet, getRoomPhotoRequirements(property).map(room => room.roomKey));
  });
}
function checkTicket(ticket: Ticket, packet: typeof evidencePackets.$inferSelect, rooms: string[]) {
  if (!rooms.includes(ticket.roomKey)) throw new LegacyUploadError("Unknown photo room", 400);
  // A gallery selection is not a claim about camera capture time. After departure only retry
  // photos already authorized during this visit; the legacy capture-time gate stays intact.
  if (ticket.issuedAt < +packet.gpsCheckInTimestamp! || ticket.issuedAt > Date.now() + 1000 ||
      (packet.gpsCheckOutTimestamp && ticket.issuedAt > +packet.gpsCheckOutTimestamp))
    throw new LegacyUploadError("Add new photos before checkout. Photos authorized during this visit can still be retried.");
}

export async function reserveLegacyPhoto(jobId: string, cleanerId: string, raw: unknown) {
  const input = photoSchema.extend({ receipt: z.string().max(2000).optional() }).parse(raw);
  const ticket = input.receipt ? verify(input.receipt, jobId, cleanerId) :
    ticketSchema.parse({ ...input, jobId, cleanerId, issuedAt: Date.now() });
  for (const key of ["uploadId", "roomKey", "byteSize", "mime", "sha256"] as const)
    if (ticket[key] !== input[key]) throw new LegacyUploadError("Upload receipt does not match this photo", 400);
  await locked(jobId, cleanerId, async (_tx, packet, rooms) => checkTicket(ticket, packet, rooms));
  const path = objectPath(ticket);
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) throw new LegacyUploadError("Could not authorize photo; retry without selecting it again", 503);
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const host = origin.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  return { uploadId: ticket.uploadId, path, verified: false, token: data.token, bucket: EVIDENCE_BUCKET,
    endpoint: `${origin.protocol}//${host}${origin.port ? `:${origin.port}` : ""}/storage/v1/upload/resumable`,
    receipt: input.receipt ?? sign(ticket) };
}

export async function acknowledgeLegacyPhoto(jobId: string, cleanerId: string, receipt: string) {
  const ticket = verify(receipt, jobId, cleanerId);
  await locked(jobId, cleanerId, async (_tx, packet, rooms) => checkTicket(ticket, packet, rooms));
  const path = objectPath(ticket);
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) throw new LegacyUploadError("Photo has not reached storage yet; retry upload", 404);
  if (data.size !== ticket.byteSize || data.size > 3 * 1024 * 1024)
    throw new LegacyUploadError("Stored photo size does not match", 400);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== ticket.sha256)
    throw new LegacyUploadError("Stored photo differs from the saved image", 409);
  try {
    const image = sharp(bytes, { limitInputPixels: 40000000 });
    if ((await image.metadata()).format !== "jpeg") throw Error("format");
    await image.stats();
  } catch { throw new LegacyUploadError("Image could not be decoded; choose a valid photo", 400); }
  await locked(jobId, cleanerId, async (tx, packet, rooms) => {
    checkTicket(ticket, packet, rooms);
    const log = (packet.checklistLog ?? {}) as { items?: unknown[]; roomPhotos?: RoomPhotosMap };
    const roomPhotos = { ...log.roomPhotos };
    roomPhotos[ticket.roomKey] = [...new Set([...(roomPhotos[ticket.roomKey] ?? []), path])];
    await tx.update(evidencePackets).set({
      checklistLog: { ...log, roomPhotos },
      photoUrls: [...new Set([...(packet.photoUrls ?? []), path])], updatedAt: new Date(),
    }).where(eq(evidencePackets.jobId, jobId));
  });
  return { path, url: await createSignedUrl(EVIDENCE_BUCKET, path), roomKey: ticket.roomKey };
}

export async function removeLegacyPhoto(jobId: string, cleanerId: string, path: string) {
  path = toStoragePath(EVIDENCE_BUCKET, path);
  if (!path.startsWith(`${cleanerId}/${jobId}/`)) throw new LegacyUploadError("Photo belongs to another job or account", 403);
  await locked(jobId, cleanerId, async (tx, packet) => {
    const log = (packet.checklistLog ?? {}) as { items?: unknown[]; roomPhotos?: RoomPhotosMap };
    const roomPhotos = Object.fromEntries(Object.entries(log.roomPhotos ?? {}).map(([key, paths]) => [key, paths.filter(p => toStoragePath(EVIDENCE_BUCKET, p) !== path)]));
    await tx.update(evidencePackets).set({ checklistLog: { ...log, roomPhotos },
      photoUrls: packet.photoUrls?.filter(p => toStoragePath(EVIDENCE_BUCKET, p) !== path), updatedAt: new Date(),
    }).where(eq(evidencePackets.jobId, jobId));
  });
  return { success: true };
}
