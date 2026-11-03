import { z } from "zod";
export const uploadStatusSchema = z
  .object({
    uploadId: z.uuid(),
    roomKey: z.string().regex(/^[a-z0-9-]{1,64}$/),
    capturedAt: z.string().datetime({ offset: true }),
    state: z.enum(["pending", "failed", "discarded"]),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    issue: z
      .enum(["upload_failed", "draft_save_failed"])
      .nullable()
      .default(null),
  })
  .strict();
export type UploadStatusReport = z.infer<typeof uploadStatusSchema>;

export type EvidenceUploadEvent = {
  kind: string;
  actorId: string;
  payload: Record<string, unknown>;
};
export type EvidenceRoomStatus = {
  roomKey: string;
  label: string;
  required: number;
  submitted: number;
  draft: number;
  received: number;
  pending: number;
  failed: number;
  progressSaveFailed: number;
  explanations: Array<{ cleanerId: string; text: string }>;
};

/** Upload status never counts as evidence or waives a required photo. */
export function summarizeEvidenceRooms(
  requirements: Array<{ roomKey: string; label: string; minPhotos: number }>,
  submitted: Record<string, string[]>,
  drafts: Array<{
    cleanerId: string;
    explanations: Record<string, string>;
    state: { checklistLog: { roomPhotos?: Record<string, string[]> } } | null;
  }>,
  events: EvidenceUploadEvent[],
): EvidenceRoomStatus[] {
  return requirements.map((room) => {
    const submittedPaths = new Set(submitted[room.roomKey] ?? []);
    const draftPaths = new Set(
      drafts.flatMap(
        (draft) => draft.state?.checklistLog.roomPhotos?.[room.roomKey] ?? [],
      ),
    );
    const states = new Map<string, UploadStatusReport>();
    const received = new Map<string, string>();
    for (const event of events) {
      if (event.payload.roomKey !== room.roomKey) continue;
      if (
        event.kind === "evidence_photo_uploaded" &&
        typeof event.payload.clientUploadId === "string" &&
        typeof event.payload.path === "string"
      ) {
        received.set(
          `${event.actorId}:${event.payload.clientUploadId}`,
          event.payload.path,
        );
      }
      if (event.kind === "evidence_upload_state") {
        const parsed = uploadStatusSchema.safeParse(event.payload);
        if (!parsed.success) continue;
        const key = `${event.actorId}:${parsed.data.uploadId}`;
        if ((states.get(key)?.revision ?? 0) < parsed.data.revision)
          states.set(key, parsed.data);
      }
    }
    let pending = 0,
      failed = 0,
      progressSaveFailed = 0;
    for (const [key, state] of states) {
      const path = received.get(key);
      if (
        state.state === "discarded" ||
        (path && (submittedPaths.has(path) || draftPaths.has(path)))
      )
        continue;
      if (path) {
        if (state.issue === "draft_save_failed") progressSaveFailed++;
        else pending++;
      } else if (state.state === "failed") failed++;
      else pending++;
    }
    return {
      roomKey: room.roomKey,
      label: room.label,
      required: room.minPhotos,
      submitted: submittedPaths.size,
      draft: draftPaths.size,
      received: new Set(received.values()).size,
      pending,
      failed,
      progressSaveFailed,
      explanations: drafts
        .filter((draft) => draft.explanations[room.roomKey]?.trim())
        .map((draft) => ({
          cleanerId: draft.cleanerId,
          text: draft.explanations[room.roomKey],
        })),
    };
  });
}
