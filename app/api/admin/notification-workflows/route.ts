import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { notificationWorkflowSchemaReady } from "@/lib/services/notifications/workflow-settings";
import { db } from "@/db";
import { sql } from "drizzle-orm";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await getAdminAuth(request)).isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!notificationWorkflowSchemaReady()) return NextResponse.json({ enabled: false, items: [] }, { headers });
  try {
    const result = await db.execute(sql`select n.identity,n.kind,n.job_id,n.subscription_id,n.state,n.created_at,s.status as delivery_status
      from phase3a_notification_events n left join phase3a_message_status s on s.message_sid=coalesce(n.outcome->>'providerMessageId',n.outcome->'sms'->>'providerMessageId')
      where n.state in ('failed','claimed','unknown') or s.status in ('failed','undelivered','canceled') order by n.created_at desc,n.identity limit 100`);
    return NextResponse.json({ enabled: true, items: Array.isArray(result) ? result : (result as { rows: unknown[] }).rows }, { headers });
  } catch { return NextResponse.json({ error: "Notification follow-up could not be loaded" }, { status: 503, headers }); }
}
