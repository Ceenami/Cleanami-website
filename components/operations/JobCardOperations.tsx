import type { AdminJobOperations } from "@/lib/jobs/admin-job-summary";
import {
  assignmentRoleLabel,
  assignmentSourceLabel,
} from "@/lib/jobs/assignment-audit";

/** The same operational fields on desktop, calendar and mobile cards. */
export function JobCardOperations({
  operations,
  compact = false,
}: {
  operations?: AdminJobOperations | null;
  compact?: boolean;
}) {
  if (!operations) return null;
  return (
    <div
      className={`${compact ? "text-xs" : "text-sm"} space-y-1 text-gray-600 break-words`}
    >
      <p>Customer: {operations.customerName ?? "Not recorded"}</p>
      <p>Payment: {operations.paymentLabel}</p>
      <p>
        Checklist: {operations.checklistLabel} · Evidence:{" "}
        {operations.evidenceLabel} · {operations.photoCount} photos
      </p>
      {operations.cleaners.length ? (
        operations.cleaners.map((cleaner) => (
          <p key={cleaner.id}>
            {cleaner.name} · {assignmentRoleLabel(cleaner.role)} · Source:{" "}
            {assignmentSourceLabel(cleaner.source)}
          </p>
        ))
      ) : (
        <p>Unassigned</p>
      )}
      {operations.warnings.map((warning) => (
        <p key={warning} className="font-medium text-amber-800">
          {warning}
        </p>
      ))}
    </div>
  );
}
