/** Booking purpose is separate from the Standard/Deep scope and pricing model. */
export const RESIDENTIAL_PURPOSES = ["move_in", "move_out"] as const;
export type ResidentialPurpose = (typeof RESIDENTIAL_PURPOSES)[number];
export const RESIDENTIAL_PURPOSE_LABELS: Record<ResidentialPurpose, string> = {
  move_in: "Move-In Clean",
  move_out: "Move-Out Clean",
};
export function isResidentialPurpose(value: unknown): value is ResidentialPurpose {
  return value === "move_in" || value === "move_out";
}
