import { z } from "zod";
import {
  dateAvailabilityLocked,
  easternToday,
} from "@/lib/cleaner/availability-deadline";
export const availabilityDaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isAvailable: z.boolean(),
    onCallEligible: z.boolean(),
    openPoolEligible: z.boolean().optional().default(false),
    revision: z.number().int().min(0).optional(),
  })
  .strict();
export type AvailabilityFlags = {
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible: boolean;
};
export function assertAvailabilityChange(input: {
  date: string;
  before: AvailabilityFlags;
  after: AvailabilityFlags;
  assigned: boolean;
  reopened: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date(),
    { before, after } = input;
  if (!after.isAvailable && (after.onCallEligible || after.openPoolEligible))
    throw new Error("Pool eligibility requires availability");
  const negative =
    (before.isAvailable && !after.isAvailable) ||
    (before.onCallEligible && !after.onCallEligible) ||
    (before.openPoolEligible && !after.openPoolEligible);
  if (input.assigned && negative)
    throw new Error("Assigned dates cannot lose availability or pool coverage");
  if (
    input.date < easternToday(now) &&
    JSON.stringify(before) !== JSON.stringify(after)
  )
    throw new Error("Past dates cannot be changed");
  if (negative && dateAvailabilityLocked(input.date, now) && !input.reopened)
    throw new Error(
      "This week is locked; admin reopening is required for removals",
    );
  const positive =
    (!before.isAvailable && after.isAvailable) ||
    (!before.onCallEligible && after.onCallEligible) ||
    (!before.openPoolEligible && after.openPoolEligible);
  return { late: positive && dateAvailabilityLocked(input.date, now) };
}
