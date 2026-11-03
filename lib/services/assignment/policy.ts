/** Pure shared policy; database guard in 0050 is the race-safe final authority. */
export type AssignmentProfile = {
  eligibleForAssignments: boolean;
  accountStatus: string;
  residentialQualified: boolean;
  petComfortable: boolean;
  hasHotTubCert: boolean | null;
  hasLaundryLeadCert: boolean;
};
export function assignmentReasons(
  profile: AssignmentProfile,
  job: {
    serviceType?: string | null;
    addonsSnapshot?: {
      petsAllowed?: boolean | null;
      laundryType?: string | null;
    } | null;
  },
  excluded: boolean,
) {
  const reasons: string[] = [];
  if (!profile.eligibleForAssignments || profile.accountStatus !== "active")
    reasons.push("inactive_or_ineligible");
  if (excluded) reasons.push("do_not_assign");
  if (
    job.serviceType === "residential_one_time" &&
    !profile.residentialQualified
  )
    reasons.push("residential_not_qualified");
  if (
    job.serviceType === "residential_one_time" &&
    job.addonsSnapshot?.petsAllowed &&
    !profile.petComfortable
  )
    reasons.push("pets_not_supported");
  return reasons;
}
export function selectCompleteTeam<
  T extends { hotTubCapable: boolean; laundryLeadCapable: boolean },
>(pool: T[], size: number, hotTub: boolean, offSite: boolean): T[] | null {
  if (!Number.isInteger(size) || size < 1 || size > 4 || pool.length < size)
    return null;
  if (
    (hotTub && !pool.some((c) => c.hotTubCapable)) ||
    (offSite && !pool.some((c) => c.laundryLeadCapable))
  )
    return null;
  function choose(start: number, selected: T[]): T[] | null {
    if (selected.length === size)
      return (!hotTub || selected.some((c) => c.hotTubCapable)) &&
        (!offSite || selected.some((c) => c.laundryLeadCapable))
        ? selected
        : null;
    for (let i = start; i <= pool.length - (size - selected.length); i++) {
      const found = choose(i + 1, [...selected, pool[i]]);
      if (found) return found;
    }
    return null;
  }
  return choose(0, []);
}
