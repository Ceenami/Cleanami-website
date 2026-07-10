# Dashboard jobs: schedule window, sorting, and assignment flow

## What the dashboard shows

The admin and owner (`/customer`) dashboards load jobs through `GET /api/jobs?dashboard=1`.

| Behavior | Value |
|----------|--------|
| Sort | **Check-in date, soonest first** (`check_in_time ASC`) |
| Past window | Last **7 days** (recent in-progress / completed) |
| Future window | **30 days** ahead (no cleans farther out unless you paginate) |
| Page size | 20 jobs per page |

Constants live in `lib/queries/dashboard-job-window.ts`.

Job oversight (`/admin/job-oversight`) does **not** pass `dashboard=1`, so it still shows all jobs sorted by created-at.

---

## How jobs get into the system

1. **iCal sync** — `ICalService` (`lib/services/iCal/ical.service.ts`) reads each property’s Airbnb/vrbo calendar URL.
2. **Cron** — `GET /api/cron/sync-calendars` runs sync for active subscriptions.
3. **Upsert** — Events become rows in `jobs` (keyed by `calendar_event_uid`) with `check_in_time`, `check_out_time`, status `unassigned`.

See `Docs/ical-service-docs.md` and `Docs/api-cron-sync-calendars.md`.

---

## How cleaners get assigned

Assignment is **not** in this Next.js repo.

After calendar sync completes, `app/api/cron/sync-calendars/route.ts` calls the Supabase Edge Function:

```
POST {SUPABASE_URL}/functions/v1/job-assignment-engine
```

Admins can also run it manually from the sidebar **Assignment Engine → Run Now** (`POST /api/trigger-assignments`).

Successful runs insert rows into `jobs_to_cleaners` (primary / backup / laundry roles).

---

## How to verify the dashboard window

### In the browser

1. Open `/admin/dashboard` or `/customer/dashboard`.
2. Confirm the subtitle: **“Check-in order · last 7 days through 30 days ahead”**.
3. Check-in column should increase down the list (soonest clean at the top).
4. No job should have a check-in more than ~30 days in the future (unless you click **Load more** for the next page inside the window).

### API check

```bash
curl -s "http://localhost:3000/api/jobs?dashboard=1&page=1" \
  -H "Cookie: <your-session-cookie>" | jq '.data[] | {checkIn: .checkInTime, address: .property.address}'
```

Jobs should be ordered by `checkInTime` ascending; all dates within the 7-day-past / 30-day-future window.

### Database check (Supabase SQL)

```sql
SELECT id, check_in_time, status
FROM jobs
WHERE check_in_time >= NOW() - INTERVAL '7 days'
  AND check_in_time <= NOW() + INTERVAL '30 days'
ORDER BY check_in_time ASC
LIMIT 25;
```

Compare row order to the dashboard table.

### Assignment check (after sync)

```sql
SELECT j.id, j.check_in_time, j.status, jtc.role, c.full_name
FROM jobs j
LEFT JOIN jobs_to_cleaners jtc ON jtc.job_id = j.id
LEFT JOIN cleaners c ON c.id = jtc.cleaner_id
WHERE j.status IN ('unassigned', 'assigned')
ORDER BY j.check_in_time ASC
LIMIT 20;
```

Unassigned jobs have no `jobs_to_cleaners` rows until the assignment engine runs.

---

## Changing sort direction

If the client prefers **furthest-out first**, set `sortByCheckIn: 'desc'` when `dashboard=1` in `app/api/jobs/route.ts`.
