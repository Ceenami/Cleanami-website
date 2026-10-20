import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";

export const EXECUTION_PROTOCOL = "pre2c-hotfix-v1" as const;
export const EXECUTION_ZONE = "America/New_York";
export const requirementSchema = z.object({
  roomKey: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  minPhotos: z.number().int().min(0).max(20),
});
export const issuedTermsSchema = z
  .object({
    protocol: z.literal(EXECUTION_PROTOCOL),
    plannedStart: z.iso.datetime(),
    plannedDeadline: z.iso.datetime(),
    timezone: z.literal(EXECUTION_ZONE),
    calendarIdentity: z.string().min(1),
    source: z.string().min(1),
    propertyCheckOutTime: z.string().nullable(),
    propertyCheckInTime: z.string().nullable(),
    rooms: z.array(requirementSchema).min(1),
    checklist: z
      .array(
        z.object({
          id: z.string(),
          task: z.string(),
          section: z.string().optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (t) => Date.parse(t.plannedDeadline) > Date.parse(t.plannedStart),
    "Invalid issued window",
  );
export type IssuedTerms = z.infer<typeof issuedTermsSchema>;

/** Resolve a wall clock without depending on the process TZ. Reject both DST gaps and folds. */
export function easternInstant(day: string, clock: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(clock)
  )
    throw Error("Invalid property date/time");
  const wall = `${day}T${clock.length === 5 ? `${clock}:00` : clock}`;
  const instant = fromZonedTime(wall, EXECUTION_ZONE);
  if (
    !Number.isFinite(instant.getTime()) ||
    formatInTimeZone(instant, EXECUTION_ZONE, "yyyy-MM-dd'T'HH:mm:ss") !== wall
  )
    throw Error(
      "Property time does not exist on this date; manual review required",
    );
  for (const shift of [-3600000, 3600000]) {
    if (
      formatInTimeZone(
        new Date(+instant + shift),
        EXECUTION_ZONE,
        "yyyy-MM-dd'T'HH:mm:ss",
      ) === wall
    )
      throw Error("Ambiguous property time; manual review required");
  }
  return instant;
}

/** node-ical 0.21 constructs VALUE=DATE at process-local midnight and marks dateOnly. */
export function calendarDay(date: Date): string {
  if ((date as Date & { dateOnly?: boolean }).dateOnly)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return date.toISOString().slice(0, 10);
}

export function rentalSchedule(
  event: { end: Date; datetype?: string },
  next: { start: Date; datetype?: string } | undefined,
  property: {
    defaultCheckOutTime?: string | null;
    defaultCheckInTime?: string | null;
  },
) {
  // Recover the parser's nominal date before resolving the Florida wall clock.
  const checkout = property.defaultCheckOutTime || "09:00:00";
  const checkin = property.defaultCheckInTime || "16:00:00";
  const day =
    event.datetype === "date"
      ? calendarDay(event.end)
      : formatInTimeZone(event.end, EXECUTION_ZONE, "yyyy-MM-dd");
  const start =
    event.datetype === "date" ? easternInstant(day, checkout) : event.end;
  let deadline = easternInstant(day, checkin);
  if (next) {
    const guest =
      next.datetype === "date"
        ? easternInstant(calendarDay(next.start), checkin)
        : next.start;
    if (+guest < +deadline) deadline = guest;
  }
  if (+deadline <= +start)
    throw Error("Cleaning window requires manual review");
  return { start, deadline };
}

export function assertCaptureWindow(
  capturedAt: Date,
  arrival: Date | null,
  departure: Date | null,
  now = new Date(),
) {
  if (
    !arrival ||
    !Number.isFinite(+capturedAt) ||
    +capturedAt < +arrival ||
    +capturedAt > +(departure ?? now)
  )
    throw Error(
      "Photo capture time must be within the recorded visit; check your device clock",
    );
}
