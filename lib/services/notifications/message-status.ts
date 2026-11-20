import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
export const MESSAGE_STATUS_RANK = { accepted: 0, queued: 1, sending: 2, sent: 3, failed: 4, undelivered: 4, canceled: 4, delivered: 5, read: 6 } as const;
export async function recordMessageStatus(sid: string, status: keyof typeof MESSAGE_STATUS_RANK, errorCode: string | null) {
  // Callback may beat the send response/log insert. Keep a SID-only observation;
  // joining to the eventual provider ID resolves the race without inventing delivery.
  await db.execute(sql`insert into phase3a_message_status(message_sid,status,rank,error_code)
    values(${sid},${status},${String(MESSAGE_STATUS_RANK[status])},${errorCode})
    on conflict(message_sid) do update set status=excluded.status,rank=excluded.rank,error_code=excluded.error_code,observed_at=clock_timestamp()
    where phase3a_message_status.rank::int<excluded.rank::int`);
}
