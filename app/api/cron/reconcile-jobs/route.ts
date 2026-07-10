import { reconcileStaleJobs } from "@/lib/services/job-reconciliation.service";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

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
