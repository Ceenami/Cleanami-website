import { sendAvailabilityReminders } from "@/lib/services/notifications/reminders.service";
import { assertCronAuth } from "@/lib/auth/cron-auth";

export async function GET(request: Request) {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const summary = await sendAvailabilityReminders();
    console.log("[cron/availability-reminders]", summary);
    return Response.json({ success: true, ...summary });
  } catch (error) {
    console.error("[cron/availability-reminders] failed", error);
    return Response.json(
      { success: false, error: "Availability reminders failed" },
      { status: 500 }
    );
  }
}
