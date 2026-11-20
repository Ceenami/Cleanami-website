import { assertCronAuth } from "@/lib/auth/cron-auth";
import { expireRecordedSubscriptionTerms } from "@/lib/services/subscription-term.service";
export async function GET(request: Request) {
  const denied = assertCronAuth(request); if (denied) return denied;
  try { return Response.json(await expireRecordedSubscriptionTerms()); }
  catch { return Response.json({ error: "Subscription term processing requires review" }, { status: 503 }); }
}
