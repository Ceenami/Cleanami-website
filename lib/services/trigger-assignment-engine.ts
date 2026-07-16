import "server-only";

import { runAssignmentEngine } from "@/lib/services/assignment/assignment-engine.service";

/**
 * Run the in-repo assignment engine. Replaces the former Supabase
 * `job-assignment-engine` edge function (now reimplemented in this repo, see
 * assignment-engine.service.ts). Fire-and-forget safe — logs failures.
 */
export async function triggerAssignmentEngine(): Promise<void> {
  try {
    const summary = await runAssignmentEngine();
    if (summary.errors.length > 0) {
      console.error(
        "[triggerAssignmentEngine] completed with errors:",
        summary.errors
      );
    } else {
      console.log(
        `[triggerAssignmentEngine] assigned=${summary.assigned} skipped=${summary.skipped}`
      );
    }
  } catch (error) {
    console.error("[triggerAssignmentEngine] Engine failed:", error);
  }
}
