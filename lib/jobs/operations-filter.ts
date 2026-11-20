import "server-only";
import { sql } from "drizzle-orm";
import { jobs } from "@/db/schemas";
import { ARRIVAL_WINDOWS } from "@/lib/scheduling/arrival-windows";

/** Same arrival-window allowance and 15-minute tolerance as the displayed warning. */
export function overdueArrivalFilter() {
  const windows = sql.join(ARRIVAL_WINDOWS.map(w => sql`when ${w.key} then ${w.endMinutes - w.startMinutes}`), sql` `);
  return sql`${jobs.status}::text='assigned' and ${jobs.checkInTime} is not null
    and clock_timestamp()>${jobs.checkInTime}+(15+case when ${jobs.serviceType}='residential_one_time'
      then case ${jobs.addonsSnapshot}->>'arrivalWindow' ${windows} else 0 end else 0 end)*interval '1 minute'
    and not exists(select 1 from evidence_packets e where e.job_id=${jobs.id} and e.gps_check_in_timestamp is not null)`;
}
