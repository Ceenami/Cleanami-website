import { reconcileStaleJobs } from "@/lib/services/job-reconciliation.service";
import { assertCronAuth } from "@/lib/auth/cron-auth";

export async function GET(request: Request) {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const summary = await reconcileStaleJobs();
    console.log("[cron/reconcile-jobs]", summary);

    return Response.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error("[cron/reconcile-jobs] failed", error);
    return Response.json(
      { success: false, error: "Job reconciliation failed" },
      { status: 500 }
    );
  }
}
