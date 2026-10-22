import { sendUpcomingJobReminders } from "@/lib/services/notifications/reminders.service";
import { assertCronAuth } from "@/lib/auth/cron-auth";
import { sendPendingScheduleNotices } from "@/lib/services/property-schedule";

export async function GET(request: Request) {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    await sendPendingScheduleNotices();
    const summary = await sendUpcomingJobReminders();
    console.log("[cron/job-reminders]", summary);
    return Response.json({ success: true, ...summary });
  } catch (error) {
    console.error("[cron/job-reminders] failed", error);
    return Response.json(
      { success: false, error: "Job reminders failed" },
      { status: 500 }
    );
  }
}
