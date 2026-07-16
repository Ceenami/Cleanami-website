# AGENTS.md — CleanNami

Operating guide for AI coding agents (and humans) working in this repo. Read this first; it is the
single source of truth for how to build, run, verify, and stay out of trouble here. Keep it current:
when you hit a mistake this file could have prevented, add a line.

CleanNami is a subscription cleaning marketplace: customers book recurring cleans, guest-calendar
(iCal) events generate jobs, cleaners are assigned and paid via Stripe Connect, all in one Next.js app.

---

## 1. Stack (what you're editing)

- **Next.js 15.5 App Router** (`app/`), React 19, TypeScript `strict`. Dev server uses Turbopack.
- **Drizzle ORM** over **Postgres (Supabase)**. Schema in `db/schemas/*.schema.ts`, aggregated by `db/schema.ts`.
- **Supabase Auth** via `@supabase/ssr` (cookie sessions, middleware-refreshed).
- **TanStack Query** for client data fetching; **Zod v4** for validation; **Tailwind v4** for styling.
- **Stripe v19** (PaymentIntents + Connect payouts) · **Resend** (email) · **Google Maps/Places** · **node-ical**.
- Package manager is **pnpm 10.8** (pinned in `packageManager`). Do not use npm/yarn to install.

Path alias: `@/*` → repo root (e.g. `@/lib/...`, `@/db/...`, `@/components/...`).

---

## 2. Commands

```bash
pnpm i                       # install (pnpm only — a stray package-lock.json is stale, ignore it)
pnpm dev                     # dev server (Turbopack) at http://localhost:3000
pnpm build                   # production build — the closest thing to a full typecheck+compile gate
pnpm start                   # serve the production build
pnpm lint                    # ESLint (eslint-config-next)
pnpm exec tsc --noEmit       # standalone typecheck (there is NO `typecheck` script — use this)
```

Database (Drizzle → Supabase Postgres):

```bash
pnpm drizzle-kit generate    # generate SQL migration from db/schemas changes → db/supabase/migrations
pnpm drizzle-kit migrate     # apply numbered migrations
pnpm tsx scripts/apply-sql-function_migrations.ts   # ⚠️ REQUIRED — see §4, applies SQL functions/triggers
```

**There is no test script and no tests in the repo.** "Verified" here means: `pnpm lint` clean,
`pnpm exec tsc --noEmit` clean, `pnpm build` succeeds, **and** you manually exercised the affected
flow (or drove it with the `/verify` skill). Do not claim a change works on typecheck alone —
separate making the change from checking it.

---

## 3. Layout & where things live

```
app/
  (root)/            public marketing site + booking modal entry
  (auth)/            sign-in / sign-up
  (dashboard)/[slug]/  admin console AND customer portal — customer when slug === "customer"
  (cleaner)/cleaner/   cleaner portal (onboarding → availability → jobs → check-in/out → evidence → pay)
  api/               admin/shared routes
  api/cleaner/**     cleaner portal API      api/customer/**  customer portal API
  api/cron/**        scheduled jobs (pre-authorize, process-payout, sync-calendars, reconcile-jobs)
  api/stripe/webhook Stripe webhook receiver
lib/
  actions/           Next.js server actions (mutations invoked from client components)
  queries/           read-side DB queries
  services/          business logic (pricing, onboarding, iCal, reconciliation, payment)
  validations/       Zod schemas + shared form types
  admin-auth.ts · cleaner-auth.ts · customer-auth.ts   per-surface auth guards
  supabase/middleware.ts   session refresh + route segmentation
db/schemas/*.schema.ts     Drizzle table defs   ·   db/schemas/functions_for_app.sql  raw SQL layer
Docs/                developer notes per API route / service (handy, but verify against code)
```

Route-group folders in parentheses do not affect URLs. `components/dashbboard/` is **misspelled on
purpose-by-history** — callers import that exact path; do not "fix" the spelling without updating every import.

---

## 4. Migrations have TWO layers — don't forget the second

1. **Drizzle numbered migrations** (`db/supabase/migrations/000N_*.sql`) — schema/tables. Generate + migrate as above.
2. **Raw SQL functions & triggers** (`db/schemas/functions_for_app.sql`) — swap eligibility, reliability,
   leaderboard, job-reminder triggers. These are applied by the standalone script
   `scripts/apply-sql-function_migrations.ts`, **not** by `drizzle-kit migrate`.

If you add/change anything in `functions_for_app.sql`, a deploy must run that script or the change never
lands. Note `drizzle.config.ts` reads `.env.local`; the running app reads `.env` — keep both in sync locally.

---

## 5. Conventions & landmines (read before touching money, auth, or DB)

- **Money is in integer cents.** Times/schedules are **America/New_York (ET)** — use the existing
  date-fns-tz helpers, never `new Date()` local math for business deadlines.
- **Never trust a client-sent price.** Prices are recomputed server-side in
  `lib/services/pricing.service.ts` and re-checked before payment in `lib/actions/payment.actions.ts`.
  Any new charge path must re-validate amount/currency server-side.
- **Drizzle `.where()` must use `and(...)`, never JS `&&`.** `eq(a,b) && eq(c,d)` silently returns only
  the second predicate and matches the wrong rows — this bug exists in the code today. Use `and(eq(...), eq(...))`.
- **Auth role is authoritative from the DB, not the session.** There is a real `users.role` column;
  guards that read `user?.user_metadata?.role` are trusting a value the client can self-edit (the current
  top security hole). New/edited guards must read the authoritative role, not `user_metadata`. Gate cleaner
  routes with `lib/cleaner-auth.ts`, admin with `lib/admin-auth.ts`, customer with `lib/customer-auth.ts`.
- **Stripe calls on money paths need idempotency keys.** capture / transfer / payment-intent create
  currently have none. When you touch `complete-and-capture`, `cron/process-payout`, or `cron/pre-authorize`,
  add a stable `idempotencyKey` (key off job/payout id) and claim rows before calling Stripe.
- **Crons and the capture route are secret-gated.** `CRON_SECRET` (cron routes), `CLEANER_APP_API_KEY`
  (`api/jobs/complete-and-capture`), `STRIPE_WEBHOOK_SECRET` (webhook). Fail closed if a secret is missing.
- **Service-area polygons currently include non-FL/Canadian test zones** — do not treat the address gate as
  production-correct; it's client-side only.

Full, itemized security/spec findings live in `_audit-private/CLEANNAMI-STATE-OF-THE-LAND.md` (local only).
Consult it before hardening money or auth paths.

---

## 6. Environment

Copy `.env.example` → `.env` (app) and `.env.local` (drizzle) and fill in. Required groups:

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- **Stripe**: `STRIPE_MODE`/`NEXT_PUBLIC_STRIPE_MODE` (`test`|`live`) select the key pair below;
  `STRIPE_SECRET_KEY(_LIVE)`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY(_LIVE)`, `STRIPE_WEBHOOK_SECRET`
- **Google**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps + Places on one key)
- **Secrets**: `CRON_SECRET`, `CLEANER_APP_API_KEY` · **Email**: `RESEND_API_KEY` · **App**: `NEXT_PUBLIC_APP_URL`

Never commit real secrets. `.env*` (except `.env.example`) is gitignored — keep it that way.

---

## 7. Do NOT commit / do NOT leak

- `_audit-private/` and `_client-docs/` are gitignored — internal audit + client-facing docs. Never commit,
  never paste their contents anywhere they'd reach the remote or a third party.
- Do **not** add any `Co-Authored-By: Claude ...` trailer or any mention of Claude / Anthropic / Claude Code
  to commit messages, PRs, or anything else that reaches the git remote. This is a hard project rule.
- Commit or push only when explicitly asked. Branch off `main` first; keep messages factual.

---

## 8. When you finish a change

1. `pnpm lint` and `pnpm exec tsc --noEmit` — both clean.
2. `pnpm build` — succeeds (this is the real compile gate; there's no CI here).
3. Exercise the actual flow you changed (booking, cleaner check-in, payout, etc.) — code that compiles is not code that works.
4. If the change touched migrations or `functions_for_app.sql`, confirm both migration layers were applied (§4).
5. Report honestly: what you verified, what you didn't, and any assumption you made.
