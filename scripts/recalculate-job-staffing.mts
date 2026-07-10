import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { differenceInDays, startOfDay } from "date-fns";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.local") });

function isHotTubDeepCleanDue(
  jobDate: Date,
  subscriptionStartDate: Date,
  cadence: string | null | undefined
): boolean {
  if (!cadence) return false;
  const job = startOfDay(jobDate);
  const start = startOfDay(subscriptionStartDate);
  const diffDays = Math.abs(differenceInDays(job, start));
  const cadenceDays: Record<string, number> = {
    "4_weeks": 28,
    "6_weeks": 42,
    "2_months": 56,
    "3_months": 84,
    "4_months": 112,
  };
  const days = cadenceDays[cadence] ?? 0;
  if (days === 0) return false;
  return diffDays > 0 && diffDays % days < 7;
}

type JobRow = {
  id: string;
  check_in_time: Date | null;
  created_at: Date;
  addons_snapshot: Record<string, unknown> | null;
  bed_count: number;
  bath_count: string;
  sq_ft: number | null;
  laundry_type: string;
  hot_tub_service_level: boolean;
  hot_tub_drain_cadence: string | null;
  property_created_at: Date;
  subscription_start_date: Date | null;
};

async function main() {
  const { calculateJobStaffing } = await import(
    "../lib/pricing/staffing-logic.ts"
  );

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { prepare: false, max: 3 });
  const futureOnly = process.argv.includes("--future-only");
  const now = new Date();

  const statusFilter = futureOnly
    ? sql`AND j.status IN ('unassigned', 'assigned', 'in-progress', 'awaiting_capture', 'completed_pending_evidence')
          AND j.check_in_time IS NOT NULL
          AND j.check_in_time >= ${now}`
    : sql``;

  const rows = await sql<JobRow[]>`
    SELECT
      j.id,
      j.check_in_time,
      j.created_at,
      j.addons_snapshot,
      p.bed_count,
      p.bath_count,
      p.sq_ft,
      p.laundry_type,
      p.hot_tub_service AS hot_tub_service_level,
      p.hot_tub_drain_cadence,
      p.created_at AS property_created_at,
      s.start_date AS subscription_start_date
    FROM jobs j
    INNER JOIN properties p ON p.id = j.property_id
    LEFT JOIN subscriptions s ON s.id = j.subscription_id
    WHERE j.status != 'canceled'
      AND j.property_id IS NOT NULL
      ${statusFilter}
  `;

  let updated = 0;

  for (const row of rows) {
    const checkInTime = row.check_in_time ?? row.created_at;
    const subscriptionStart =
      row.subscription_start_date ?? row.property_created_at ?? row.created_at;

    const staffing = calculateJobStaffing({
      bedCount: row.bed_count,
      bathCount: row.bath_count,
      sqFt: row.sq_ft,
      laundryType: row.laundry_type,
      hotTubServiceLevel: row.hot_tub_service_level,
      hotTubDeepClean: row.hot_tub_service_level
        ? isHotTubDeepCleanDue(
            checkInTime,
            new Date(subscriptionStart),
            row.hot_tub_drain_cadence
          )
        : false,
    });

    const existingSnapshot = row.addons_snapshot ?? {
      laundryType: row.laundry_type,
    };

    await sql`
      UPDATE jobs
      SET
        expected_hours = ${staffing.expectedHoursPerCleaner.toString()},
        addons_snapshot = ${sql.json({
          ...existingSnapshot,
          laundryType: row.laundry_type,
          laundryLoads: staffing.expectedLaundryLoads,
          hotTubServiceLevel: row.hot_tub_service_level
            ? staffing.isDeepClean
              ? "deep_clean"
              : "basic"
            : "none",
          hotTubDrainCadence: row.hot_tub_drain_cadence,
          teamSize: staffing.teamSize,
          propertySize: staffing.propertySize,
          requiresManualStaffing: staffing.requiresManualStaffing,
          bedroomBathroomTotal: staffing.bedroomBathroomTotal,
          baseCleaningHours: staffing.baseCleaningHours,
          offSiteLaundryHours: staffing.offSiteLaundryHours,
          hotTubHours: staffing.hotTubHours,
        })},
        updated_at = NOW()
      WHERE id = ${row.id}
    `;

    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        scope: futureOnly ? "future_open" : "all_non_canceled",
        updated,
      },
      null,
      2
    )
  );

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
