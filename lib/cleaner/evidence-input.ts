import { z } from "zod";
export const evidenceInputSchema = z
  .object({
    mode: z.enum(["draft", "final"]).default("final"),
    checklistLog: z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.string().max(100),
                task: z.string().max(500),
                completed: z.boolean(),
                section: z.string().max(100).optional(),
              })
              .strict(),
          )
          .max(100),
        roomPhotos: z
          .record(
            z.string().regex(/^[a-z0-9-]{1,64}$/),
            z.array(z.string().max(600)).max(1000),
          )
          .optional(),
      })
      .strict(),
    cleanerNotes: z.string().max(3000).optional(),
    explanations: z
      .record(
        z.string().regex(/^[a-z0-9-]{1,64}$/),
        z.string().trim().max(1000),
      )
      .optional(),
  })
  .strict();
export function validCaptureTime(
  capturedAt: string | null,
  checkIn: Date | null,
  checkOut: Date | null,
  now = new Date(),
) {
  if (!capturedAt || !checkIn) return false;
  const time = new Date(capturedAt).getTime();
  return (
    Number.isFinite(time) &&
    time >= checkIn.getTime() &&
    time <= now.getTime() &&
    (!checkOut || time <= checkOut.getTime())
  );
}
