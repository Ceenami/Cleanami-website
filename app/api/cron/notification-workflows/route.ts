import { assertCronAuth } from "@/lib/auth/cron-auth";
import { discoverNotificationEvents, dispatchNotificationEvents } from "@/lib/services/notifications/workflows.service";
import { dispatchRentalFinanceNotices } from "@/lib/services/notifications/rental-finance-notices";
import { dispatchAdminSms } from "@/lib/services/notifications/admin-sms.service";
export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;
  let notifications: object, status = 200;
  try {
    await discoverNotificationEvents();
    await dispatchRentalFinanceNotices();
    notifications = await dispatchNotificationEvents();
  } catch { notifications = { error: "Notification workflow requires review" }; status = 500; }
  // Already queued SMS drains independently of another workflow's failure.
  let adminSms: unknown;
  try { adminSms = await dispatchAdminSms(); }
  catch { adminSms = { error: "Admin SMS dispatch requires review" }; status = 500; }
  return Response.json({ ...notifications, adminSms }, { status });
}
