import { assertCronAuth } from "@/lib/auth/cron-auth";
import { dispatchPendingOffers } from "@/lib/services/assignment/offers.service";
import { processAssignmentLifecycle, dispatchLifecycleActions } from "@/lib/services/assignment/lifecycle.service";
import { processPriorityPlans, discoverPriorityPlans, dispatchPriorityNotices } from "@/lib/services/assignment/priority.service";
export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;
  try {
    await processPriorityPlans();
    await discoverPriorityPlans();
    const summary = await processAssignmentLifecycle();
    await dispatchPendingOffers();
    await dispatchLifecycleActions();
    await dispatchPriorityNotices();
    return Response.json({ success: summary.errors.length === 0, ...summary }, { status: summary.errors.length ? 500 : 200 });
  }
  catch { return Response.json({ error: "Offer dispatch failed" }, { status: 500 }); }
}
