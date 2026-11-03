export type AssignmentAuditCandidate = {
  cleanerId: string;
  source: string;
  reasons: string[];
  selected?: boolean;
  selectedRole?: string | null;
};

export type AssignmentAuditRun = {
  outcome: string;
  reason?: string | null;
  candidates: AssignmentAuditCandidate[];
  context?: Record<string, unknown> | null;
};

const SOURCE_LABELS: Record<string, string> = {
  main_primary: "Main Primary",
  secondary_primary: "Secondary Primary",
  preferred_backup: "Preferred Backup",
  on_call: "On-call",
  open_pool: "Open Pool",
  proximity: "Proximity pool",
  manual: "Manual Override",
  manual_override: "Manual Override",
  backup_promotion: "Backup promotion",
  urgent_claim: "Urgent replacement",
  replacement: "Replacement",
  swap: "Swap",
};

export function assignmentSourceLabel(source: string | null | undefined) {
  return source
    ? (SOURCE_LABELS[source] ?? source.replaceAll("_", " "))
    : "Not recorded";
}

export function assignmentRoleLabel(role: string) {
  if (role === "backup") return "Backup (coverage only)";
  if (role === "laundry_lead") return "Laundry Lead";
  if (role === "primary") return "Primary";
  return role.replaceAll("_", " ");
}

/** Read the issued audit; never reconstruct historical sources from today's roster. */
export function selectedAssignmentRole(
  run: AssignmentAuditRun,
  candidate: AssignmentAuditCandidate,
): string | null {
  if (run.outcome !== "assigned" || !candidate.selected) return null;
  if (candidate.selectedRole) return candidate.selectedRole;
  if (run.context?.backupCleanerId === candidate.cleanerId) return "backup";
  const workers = run.context?.workingCleanerIds;
  if (Array.isArray(workers) && workers.includes(candidate.cleanerId))
    return "primary";
  // SQL0050 records the committed role in reason for manual/replacement writes.
  if (["primary", "laundry_lead", "backup"].includes(run.reason ?? ""))
    return run.reason!;
  return "unknown";
}

export function recordedAssignmentSource(
  cleanerId: string,
  role: string,
  runs: AssignmentAuditRun[],
) {
  for (const run of runs) {
    const candidate = run.candidates.find((c) => c.cleanerId === cleanerId);
    if (!candidate) continue;
    const selectedRole = selectedAssignmentRole(run, candidate);
    if (selectedRole && (selectedRole === role || selectedRole === "unknown"))
      return candidate.source;
  }
  return null;
}
