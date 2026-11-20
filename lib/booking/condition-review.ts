import { z } from "zod";

export const CONDITION_REVIEW_LABEL = "Excessive debris or unusual cleaning conditions";
export const conditionReviewSchema = z.object({
  description: z.string().trim().min(1, "Describe the property's condition.").max(2000),
}).strict();
export type ConditionReview = z.infer<typeof conditionReviewSchema>;
/** Absence preserves old checkout identities. No false/empty snapshot field. */
export const conditionReviewFields = {
  unusualConditions: z.boolean().optional(),
  conditionDescription: z.string().trim().max(2000).optional(),
};
export function conditionReviewIssue(data: { unusualConditions?: boolean; conditionDescription?: string }) {
  return !data.unusualConditions || !!data.conditionDescription?.trim();
}
export function bookingConditionReview(data: { unusualConditions?: boolean; conditionDescription?: string }): ConditionReview | undefined {
  return data.unusualConditions
    ? conditionReviewSchema.parse({ description: data.conditionDescription }) : undefined;
}
export function readConditionReview(snapshot: unknown): ConditionReview | undefined {
  if (!snapshot || typeof snapshot !== "object" || !("conditionReview" in snapshot)) return undefined;
  return conditionReviewSchema.parse(snapshot.conditionReview);
}
