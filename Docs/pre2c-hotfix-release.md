# Prospective job execution hotfix

This standalone hotfix is based on origin/main, before Phase 2C. It introduces
`pre2c-hotfix-v1` for genuinely new job inserts only. Existing jobs, submitted
packets, schedules, assignments, charges, payouts and reliability events are not
backfilled or automatically repaired. Existing normal workflows continue.

## Rollout switches

- `JOB_EXECUTION_SCHEMA_READY=false` initially. Owner applies SQL0052 first, then
  enables readers with `true` on every server instance.
- `JOB_EXECUTION_ENROLLMENT=false` initially. Only turn on after acceptance. A new
  job and its issued contract commit together; calendar conflicts and booking
  retries cannot enroll an existing ID.
- Once any issued job exists, keep schema readers and the compatible services
  enabled. Turning enrollment off stops only future enrollment.

Property time edits apply to subsequently created jobs. Every issued job retains
its original arrival/deadline and checklist. Calendar identifiers remain opaque
compatibility identifiers; the embedded historical clock is not an arrival time.
All-day dates are resolved in America/New_York, with DST gaps/folds refused.
Insufficient cleaning windows require manual review.

## New workflow and compatibility

Arrival, recoverable draft, physical departure and final submission are distinct.
First visit timestamps are immutable. Verified photo references are durable before
checklist completion. Final submission requires departure, all issued minimums
and no unresolved upload reservations. Only canonical final evidence can settle.
A repeat identical finalization/settlement is safe; changed final evidence conflicts.

The new web/native clients offer Take photo and Choose existing photos, normalize
both sources and persist local
bytes and use signed private Storage/TUS uploads with stable IDs. Upload authorization
is short-lived and not stored with queued photos. Failed previews do not remove
accepted evidence. Camera capture times are device claims, not proof of presence.
Selected images count toward the same room minimums without an extra review gate.
Their source is recorded as gallery and their original capture time stays unknown;
selection/upload time is never presented as a camera timestamp. They may be added
after departure until final submission. Live camera capture remains visit-bounded.
This follows the client's 21 October direction superseding camera-only policy.

Installed clients retain their endpoint/response contract. The old binary upload
endpoint adapts issued jobs into the durable manifest; large binary requests still
need the updated app to avoid the hosting body limit. A stale installed-client
PATCH cannot silently replace a changed revision from another device.

New reconciliation records an operational review item without inventing departure
or advancing incomplete evidence to capture. A missing calendar event on an issued
job records a cancellation review item; it never hard-deletes issued history.
Operations must review the cancellation/refund through the normal authenticated
cancellation path. Started-job cancellation needs separate operational review.
A cancellation claims the unstarted job before provider work; failed reversals stay
pending and do not claim a refund. Existing cancellation pay rules are retained.

## Migration and release order

1. Verify the actual production deploy commit/runtime, database catalog, backup and
   all readers/writers. Do not assume origin/main is the current hosted build.
2. Review `db/supabase/migrations/0052_prospective_job_execution.sql`. It is additive,
   transaction-bounded, has a 3-second lock timeout, creates no historic contracts,
   and refuses incompatible pre-existing table names. Run only against a verified
   test destination first. Existing table policies are not replaced.
3. Owner applies **only 0052** to production using their secure connection settings:

   ```powershell
   psql --set=ON_ERROR_STOP=1 --file db/supabase/migrations/0052_prospective_job_execution.sql
   ```

   Configure the production connection through the owner's existing secure psql
   service/environment. The agent must not execute production DDL.
4. Deploy the complete compatible server/web build with schema ready, enrollment
   **off**. Verify no old ID was enrolled and normal legacy reads still work.
5. Accept actual Android/iOS binaries and browser recovery behavior. Source push,
   Vite build and plugin sync do not establish device acceptance.
6. Owner activates enrollment prospectively. Observe normal reconciliation/capture
   cycles, pending-age, review items, rejected acknowledgements and settlement
   retries; do not fabricate production payments/uploads as smoke tests.
7. Integrate the accepted hotfix into Phase 2C later through a fresh reviewed
   branch, preserving the existing dirty Phase 2C worktrees.

0052 precedes the already allocated Phase 2C 0049-0051 in release order. Do not
renumber them or use an automatic lexically sorted migration runner. Phase 2C's
visit/evidence/schedule writers must retain this execution-contract dispatch.

## Verification

`pnpm test:execution` runs the in-process PostgreSQL/service regressions and parses
actual iCal DATE events under UTC, New_York and Kolkata. Provider/Storage adapters
in that suite are explicit substitutes. It is not hosted integration acceptance.
`npx tsc --noEmit -p tsconfig.json` and `pnpm build` are required separately.

The companion native branch has `npm run test:execution`, a focused typecheck,
changed-file lint, Vite build, Android/iOS sync and Android debug assembly. Its
adapter suite substitutes native plugins; physical device tests remain required.

Hosted compatibility results and remaining release gates are recorded in the PR
handoff. The existing Phase 2C test project's additional guards make that a
coexistence test, not proof of a pristine production-schema hosted destination.
Guarded Stripe integration uses test cards and direct test PaymentIntents only;
no Checkout sessions, live charges, transfers, webhook changes or production
mutations are part of that test. Existing enabled test webhook subscriptions were
checked before mutation to exclude PaymentIntent/charge event delivery.

The recorded checks cover 35 local PostgreSQL/service cases, three process timezone
runs, four web transfer cases, 13 hosted Auth/Storage/API cases, four large-photo
transport cases and six browser recovery checks. The hosted large JPEG was
2,779,943 bytes; both transport adapters uploaded a previously captured image after
departure. All 1,934 original records across 56 pre-existing test tables retained
their original hashes. Test fixtures and pending test payouts are retained with
their cleaners ineligible and payout transfers disabled.

These results do not replace an owner review of the production catalog/runtime or
physical device acceptance. An iOS build still requires macOS/Xcode/CocoaPods.

## Cleaner browser workflow

The issued-job evidence workspace follows the existing portal brand and uses
three sections: Photos, Checklist, and Finish. Camera and existing-photo controls
appear side by side on phones, with local previews and separate device/server
statuses. The checklist retains its issued section labels and task IDs. Desktop
uses a wider workspace with a progress sidebar; controls have visible focus and
at least 44px targets. The portal uses a consistent light control palette.

Saving progress remains separate from uploading photos and final submission.
Refreshing previews or removing a photo retains unsaved checklist/notes edits;
refreshing an unedited draft adopts the latest saved revision. Conflicting edited
drafts keep their original revision and explain the need to review the other
session's changes. Departure requires an explicit confirmation, and final
submission explains the existing photo/checklist/visit prerequisites.

UI follow-up validation: production-mode build, typecheck and changed-file lint;
19 browser state/layout checks plus four keyboard checks. Browser widths included
320, 390 and 1440px. UI write responses were mocked for failure, draft, departure
and finality states; these checks do not claim new hosted write or device-camera
acceptance. Existing service/transfer suites also passed. No production migration,
job rewrite or mobile application change accompanies this presentation update.

## Rollback

Before any issued jobs exist, the old application can be restored with enrollment
off and empty additive tables retained. After issuance, disable enrollment only;
retain compatible readers, queues, finalization and settlement. Roll back to a
hotfix-capable build or fix forward. Do not drop contracts/tables, delete media,
replay money or reinterpret issued work. A hosting code rollback does not undo data.

Historical incident recovery and corrections to already-created upcoming jobs need
a separate exact-record review and authorization. They are excluded here.
