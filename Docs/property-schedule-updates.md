# Property time updates and upcoming rental bookings

## Behavior

Saving a changed guest check-out/check-in time also updates eligible upcoming,
unstarted rental bookings that inherit the home's times. Calendar, manually
created rental and customer extra-clean bookings are included. The cleaning start
follows guest check-out; the deadline follows guest check-in, capped by an earlier
explicit next-guest arrival. Explicit calendar checkout times are retained.

Started/finished/canceled jobs, bookings with visit/evidence progress, chosen
residential arrival windows and individual schedule overrides keep their times.
Unchanged property times do not silently repair old bookings during an unrelated
property edit. An invalid window, insufficient staffing time, unverifiable calendar
source, concurrent edit or working-cleaner overlap rejects the entire save.
No partial property/job update is reported as success.

The authenticated property editor remains admin-only. This does not add customer
property-edit permission. Existing customer requests handled through that editor
now receive the same automatic propagation.

## Previously listed bookings

The property's **Preview booking time updates** action compares its saved defaults
with already-listed upcoming bookings. It shows before/after times in Eastern and
the number preserved. **Update bookings** applies exactly that preview, bound to
the property, original schedules and target schedules. A changed property/booking
requires a fresh preview.

There is no historic override marker. A legacy calendar job at the recognized
09:00/16:00 baseline is treated as inherited even when the home already says
10:00. Other custom schedules are preserved. A historic deliberate override
exactly equal to a recognized baseline cannot be distinguished automatically;
review the preview before applying. Subsequent individual edits are explicitly
recorded and preserved on later home edits.

## Data and concurrency

SQL0053 adds a private append-only `job_schedule_revisions` table and private
`job_schedule_notices` retry queue. It creates no historical revisions/backfill.
RLS and explicit grant revocation keep both tables out of client access.
Original issued execution contracts remain immutable. The existing SQL0052 guard
permits only the exact new schedule recorded by an eligible revision; identity,
checklist, staffing/add-ons and every other guard remain protected. Effective
execution reads overlay the current guarded job schedule on the original terms.
Arrival re-reads that schedule after acquiring the job lock.

Property save locks property, then its future jobs in ID order, then working
cleaners in ID order. It checks eligibility/conflicts again and commits defaults,
job times, revisions and in-app notices together. Calendar fetching/geocoding and
push provider calls happen outside those locks. Queries are sequential for the
transaction pooler. New rental inserts lock/check their property snapshot, so a
concurrent edit cannot leave a newly inserted job on stale defaults. Calendar sync
uses defaults for new jobs even when execution enrollment is disabled.

Calendar compatibility UIDs, job IDs, assignments, prices, staffing hours,
checklists, payment/payout rows, visit facts and old reliability events are not
rewritten by the feature. Legacy calendar cancellation can still archive/delete
its job; the independent revision audit retains its original job UUID.

Cleaner notices are immediately durable in-app, including backups. The existing
authenticated job-reminders cron drains the private push queue with a five-minute
claim lease. Transient push failures remain retryable. Duplicate provider delivery
is possible if a worker dies after provider acceptance and before saving its
receipt; in-app rows are committed exactly with the revision. Queue processing
checks current assignment/account linkage. Verify push delivery on a device before
release. Old reminder receipts retain their original scheduled start, permitting
one reminder for the revised start.

## Release

1. Review the production catalog/roles, verify backup and confirm SQL0052 is
   installed. This migration depends on **0052**, independently of Phase2C
   0049-0051; do not use a lexical migration runner.
2. Review and test `0053_property_schedule_revisions.sql` against an isolated
   destination. It uses a 3-second lock timeout and a 30-second statement timeout.
3. Apply 0053 manually using the destination's secure psql settings:

   ```powershell
   psql --set=ON_ERROR_STOP=1 --file db/supabase/migrations/0053_property_schedule_revisions.sql
   ```

4. Deploy the complete compatible source after verifying both migrations.
   Execution readers, property-time updates and the notice queue are always
   enabled; no schema-readiness environment settings are required.
   `JOB_EXECUTION_ENROLLMENT` still controls only new issued-contract enrollment.
   Inspect existing mismatched bookings through preview and approve their exact
   correction separately.
5. Confirm customer/cleaner/admin schedules agree, upcoming reminders use the new
   start, queued notices drain normally and assignment conflict responses work.
   Do not fabricate live payments/uploads or force operational crons for a smoke
   test. No new mobile binary is required for server-authoritative schedule data.

Keep compatible execution readers serving already accepted effective schedules.
Disabling enrollment stops only future contract enrollment. After any issued
schedule revision, a rollback to the old immutable-contract reader would use its
original arrival for lateness/pay.
Use a revision-aware build or fix forward. Do not delete revisions or re-run money.

## Verification

- `npm run test:property-schedule`: 26 in-process PostgreSQL/service/API cases
  with calendar, push and authentication mocks.
- `node scripts/test-job-execution.cjs --with-schedule-upgrade`: 35
  execution cases against 0052 + 0053, including finalization and settlement.
- Existing DATE/timezone tests run under UTC, America/New_York and Asia/Kolkata;
  signed-transfer regression suite also passes.
- Typecheck, changed-file lint and production Next build passed.
- Local browser component fixture checks React controls with synthetic API
  replies/router and production CSS at 320/390/1440px. This is not hosted Auth or
  live database/browser acceptance. See [mobile layout checks](mobile-layout-fixes.md)
  for the responsive form verification and Safari limitation.
