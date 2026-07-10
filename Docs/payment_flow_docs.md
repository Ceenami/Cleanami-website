# CleanNami Payment Flow Documentation

Complete guide to the customer payment and cleaner payout system.

---

## Table of Contents
1. [Overview](#overview)
2. [Payment Flow Diagram](#payment-flow-diagram)
3. [Step-by-Step Process](#step-by-step-process)
4. [Endpoints](#endpoints)
5. [Database Schema](#database-schema)
6. [Security](#security)
7. [Error Handling](#error-handling)
8. [Testing Checklist](#testing-checklist)

---

## Overview

The CleanNami payment system handles:
- **Customer Payments**: Prepay first clean, pre-authorize future cleans, capture after completion
- **Reserve Fund**: 2% of all revenue held for disputes/refunds
- **Cleaner Payouts**: Instant payouts via Stripe Connect after job completion

### Key Principles (Per Spec)
- First clean is **prepaid** at signup to verify card validity
- Future cleans are **pre-authorized** 24 hours before checkout
- Payments are **captured** only after evidence packet is complete
- Cleaners paid **$17/hour** based on expected hours (not actual time)
- **2% reserve** held from all captured payments
- Payouts are **instant** via Stripe Connect transfers

---

## Payment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER SIGNUP                               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Endpoint: POST /actions/payment.actions  │
          │  - Validate pricing server-side           │
          │  - Create/retrieve Stripe customer        │
          │  - Capture first clean payment            │
          │  - Create subscription record             │
          └───────────────────────────────────────────┘
                                  │
                                  ▼
                    ✅ First clean PREPAID
                    💰 Customer charged immediately
                    📝 Subscription active

┌─────────────────────────────────────────────────────────────────────┐
│                    NIGHT BEFORE EACH CLEAN                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Cron: POST /api/cron/pre-authorize       │
          │  - Find jobs for tomorrow                 │
          │  - Create pre-auth (manual capture)       │
          │  - Update job: paymentStatus = authorized │
          └───────────────────────────────────────────┘
                                  │
                                  ▼
                    ⏸️  Payment AUTHORIZED (not charged yet)
                    💳 Funds held on customer's card
                    ⏰ Valid for 7 days

┌─────────────────────────────────────────────────────────────────────┐
│                        JOB COMPLETION                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Cleaner App: Evidence Packet Submission  │
          │  - Upload photos                          │
          │  - Complete checklist                     │
          │  - GPS check-in/out                       │
          │  - Mark status: complete                  │
          └───────────────────────────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Endpoint: POST /api/jobs/complete-capture│
          │  - Verify evidence complete               │
          │  - CAPTURE pre-authorized payment         │
          │  - Calculate 2% reserve                   │
          │  - Create payout records (status: pending)│
          └───────────────────────────────────────────┘
                                  │
                                  ▼
                    ✅ Payment CAPTURED
                    💰 Customer charged
                    🏦 2% moved to reserve
                    📋 Payout records created

┌─────────────────────────────────────────────────────────────────────┐
│                    CLEANER PAYOUTS (Every 15-30 min)                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Cron: POST /api/cron/process-payouts     │
          │  - Find pending payouts                   │
          │  - Validate cleaner Stripe account        │
          │  - Create Stripe transfer                 │
          │  - Update status: released                │
          └───────────────────────────────────────────┘
                                  │
                                  ▼
                    ✅ Payout RELEASED
                    💸 Money sent to cleaner
                    🎉 Job complete!
```

---

## Step-by-Step Process

### 1. Customer Signup (First Clean Prepaid)

**File:** `lib/actions/payment.actions.ts`

**What happens:**
1. Customer fills out booking form
2. Server calculates price using `PricingService`
3. Server validates price matches client-side calculation (security)
4. Stripe customer created or retrieved
5. Payment Intent created and **captured immediately**
6. Subscription record created with `isFirstCleanPrepaid = true`

**Result:**
- ✅ First clean is paid for
- ✅ Card validated
- ✅ Subscription active

**Code snippet:**
```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: serverAmountInCents,
  currency: 'usd',
  customer: stripeCustomer.id,
  automatic_payment_methods: { enabled: true },
  metadata: { /* job details */ },
});
// This PaymentIntent captures immediately (default behavior)
```

---

### 2. Pre-Authorization (Night Before Clean)

**File:** `app/api/cron/pre-authorize/route.ts`

**What happens:**
1. Cron runs daily (scheduled for ~8 PM)
2. Finds all jobs for tomorrow without `paymentIntentId`
3. For each job:
   - Calculate price from property/add-ons
   - Retrieve customer's saved payment method
   - Create PaymentIntent with `capture_method: "manual"`
   - Confirm immediately (holds funds)
   - Update job: `paymentStatus = 'authorized'`

**Result:**
- ⏸️  Funds held on customer's card
- ⏸️  Payment not captured yet
- ⏰ Authorization valid for 7 days

**Code snippet:**
```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountInCents,
  currency: "usd",
  customer: job.stripeCustomerId,
  payment_method: paymentMethodId,
  capture_method: "manual", // Key: don't charge yet
  confirm: true, // But confirm the authorization
});
```

**Schedule:** 
- Run daily at 8 PM
- Vercel Cron: `0 20 * * *`

---

### 3. Job Completion & Payment Capture

**File:** `app/api/jobs/complete-and-capture/route.ts`

**Trigger:** Called by cleaner app after evidence packet submitted

**What happens:**
1. Cleaner app submits evidence packet:
   - Photos uploaded
   - Checklist completed
   - GPS check-in/out recorded
   - Status marked as `complete`
2. App calls this endpoint with `jobId`
3. Endpoint validates:
   - Evidence packet is complete
   - Job has pre-authorized payment
   - Payment not already captured
4. **Captures the pre-authorized payment**
5. Calculates and records 2% reserve
6. Creates payout records for all assigned cleaners
   - Base pay: `expectedHours × $17`
   - Laundry bonus: `$5 × loads` (laundry lead only)
   - Urgent bonus: `$10` (if urgent job)

**Result:**
- ✅ Customer charged
- ✅ Reserve recorded
- ✅ Payout records created (status: `pending`)

**Authentication:**
```http
POST /api/jobs/complete-and-capture
Headers:
  Content-Type: application/json
  X-API-Key: <CLEANER_APP_API_KEY>
Body:
  { "jobId": "uuid-here" }
```

**Code snippet:**
```typescript
// Capture the pre-authorized payment
const paymentIntent = await stripe.paymentIntents.capture(job.paymentIntentId);

// Record 2% reserve
const reserveAmount = Math.round(capturedAmount * 0.02);
await db.insert(reserveTransactions).values({
  jobId,
  totalAmountCents: capturedAmount,
  reserveAmountCents: reserveAmount,
  netAmountCents: capturedAmount - reserveAmount,
});

// Create payout records
await db.insert(payouts).values({
  jobId,
  cleanerId,
  amount: totalPayout.toFixed(2),
  status: "pending",
});
```

---

### 4. Cleaner Payouts (Automated)

**File:** `app/api/cron/process-payouts/route.ts`

**What happens:**
1. Cron runs every 15-30 minutes
2. Finds all payouts with `status = 'pending'`
3. For each payout:
   - Validate cleaner has Stripe Connect account
   - Calculate total amount (base + bonuses)
   - Create Stripe Transfer to cleaner's account
   - Update payout: `status = 'released'`
4. If errors occur:
   - Permanent errors: mark `status = 'held'`
   - Temporary errors: keep as `pending` for retry

**Result:**
- ✅ Money transferred to cleaner's bank
- ✅ Payout marked as released
- ✅ Admin notified of any held payouts

**Code snippet:**
```typescript
const transfer = await stripe.transfers.create({
  amount: amountInCents,
  currency: "usd",
  destination: cleaner.stripeAccountId, // Stripe Connect account
  description: `CleanNami Job #${jobId}`,
});

await db.update(payouts)
  .set({
    stripePayoutId: transfer.id,
    status: "released",
  })
  .where(eq(payouts.id, payoutId));
```

**Schedule:**
- Run every 15-30 minutes during business hours
- Vercel Cron: `*/15 * * * *` (every 15 min)
- Or: `*/30 * * * *` (every 30 min)

---

## Endpoints

### 1. Customer Payment (Signup)
```
POST /actions/payment.actions (Server Action)
Body: { formData, clientSideAmount }
Returns: { clientSecret } or { error }
```

### 2. Pre-Authorization (Cron)
```
POST /api/cron/pre-authorize
Headers:
  Authorization: Bearer <CRON_SECRET>
Returns: { processedCount, results }
```

### 3. Job Completion & Capture
```
POST /api/jobs/complete-and-capture
Headers:
  X-API-Key: <CLEANER_APP_API_KEY>
Body: { jobId }
Returns: { success, capturedAmount, payoutsCreated }
```

### 4. Process Payouts (Cron)
```
POST /api/cron/process-payouts
Headers:
  Authorization: Bearer <CRON_SECRET>
Returns: { processed, failed, held, totalPaidOutUSD }
```

---

## Database Schema

### Required Tables

#### `jobs`
```typescript
{
  id: uuid,
  paymentIntentId: text, // Stripe PaymentIntent ID
  paymentStatus: enum, // pending, authorized, captured, failed, capture_failed
  expectedHours: numeric,
  // isUrgentBonus: boolean,
  addonsSnapshot: jsonb, // { laundryLoads, hotTubServiceLevel, etc }
}
```

#### `evidencePackets`
```typescript
{
  id: uuid,
  jobId: uuid,
  status: enum, // incomplete, complete, pending_review
  gpsCheckInTimestamp: timestamp,
  gpsCheckOutTimestamp: timestamp,
  isChecklistComplete: boolean,
  photoUrls: text[],
  cleanerNotes: text,
}
```

#### `reserveTransactions`
```typescript
{
  id: uuid,
  jobId: uuid,
  paymentIntentId: text,
  totalAmountCents: integer,
  reserveAmountCents: integer, // 2% of total
  netAmountCents: integer,
  createdAt: timestamp,
}
```

#### `payouts`
```typescript
{
  id: uuid,
  jobId: uuid,
  cleanerId: uuid,
  amount: numeric, // Total payout (base + bonuses)
  urgentBonusAmount: numeric, // $10 if urgent
  laundryBonusAmount: numeric, // $5/load if laundry lead
  stripePayoutId: text, // Stripe Transfer ID
  status: enum, // pending, released, held
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

#### `jobsToCleaners` (Join Table)
```typescript
{
  jobId: uuid,
  cleanerId: uuid,
  role: enum, // primary, backup, on-call, laundry_lead
}
```

---

## Security

### Environment Variables Required

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...

# API Keys
CLEANER_APP_API_KEY=<generate with crypto.randomBytes(32).toString('hex')>
CRON_SECRET=<generate with crypto.randomBytes(32).toString('hex')>
```

### Generate Secure Keys
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Security Measures

1. **Server-side price validation** prevents client tampering
2. **API Key authentication** on capture endpoint
3. **Cron secret** protects automated endpoints
4. **Evidence packet validation** prevents premature capture
5. **Idempotency** via `paymentStatus` checks (prevents double-capture)
6. **Reserve fund** protects against disputes

---

## Error Handling

### Payment Capture Failures

**Scenario:** Stripe capture fails (card declined, insufficient funds)

**What happens:**
1. Capture endpoint catches Stripe error
2. Updates job: `paymentStatus = 'capture_failed'`
3. Logs error message to `jobs.notes`
4. Returns 500 error to app

**Resolution:**
- Admin reviews failed captures in dashboard
- Contacts customer to update payment method
- Can retry capture manually or wait for customer to fix

### Payout Failures

**Scenario:** Cleaner missing Stripe account or transfer fails

**What happens:**
1. Payout marked as `status = 'held'`
2. Error logged to results
3. Admin notified

**Resolution:**
- Complete cleaner Stripe Connect onboarding
- Verify bank account is valid
- Retry payout manually from admin console

### Pre-Authorization Failures

**Scenario:** Card fails pre-auth night before

**What happens:**
1. Pre-auth endpoint catches error
2. Updates job: `paymentStatus = 'failed'`
3. Customer notified via email/SMS
4. Job flagged for admin intervention

**Resolution:**
- Customer updates payment method
- Admin retries pre-auth manually
- If unresolved, job canceled and customer notified

---

## Testing Checklist

### Local Testing

#### 1. First Clean Prepaid
- [ ] Customer signs up with valid card
- [ ] Payment Intent created and captured immediately
- [ ] Subscription record shows `isFirstCleanPrepaid = true`
- [ ] Customer receives confirmation email

#### 2. Pre-Authorization
- [ ] Cron finds jobs for tomorrow
- [ ] PaymentIntent created with `capture_method: manual`
- [ ] Job updated: `paymentStatus = 'authorized'`
- [ ] No charge appears on customer's card (just hold)

#### 3. Job Completion
- [ ] Evidence packet created with all required fields
- [ ] Capture endpoint validates evidence is complete
- [ ] Payment captured successfully
- [ ] Reserve transaction created (2% of total)
- [ ] Payout records created for all assigned cleaners
- [ ] Bonuses calculated correctly (urgent, laundry)

#### 4. Cleaner Payouts
- [ ] Cron finds pending payouts
- [ ] Stripe transfers created to cleaner accounts
- [ ] Payouts marked as `released`
- [ ] Total amounts match expected calculations

### Stripe Test Mode

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Insufficient funds: `4000 0000 0000 9995`

### Edge Cases

- [ ] Double-capture prevented (idempotency check)
- [ ] Incomplete evidence packet blocks capture
- [ ] Missing Stripe account puts payout on hold
- [ ] Pre-auth expiration handled (7 days)
- [ ] Multiple cleaners on same job get separate payouts
- [ ] Laundry bonus only goes to laundry_lead
- [ ] Urgent bonus applied correctly

---

## Monitoring & Admin Actions

### Dashboard Views Needed

1. **Reserve Balance**
   - Total reserve amount from `reserveTransactions`
   - 2% target vs actual
   - Alert if reserve < 1.5% or > 2.5%

2. **Failed Captures**
   - Jobs with `paymentStatus = 'capture_failed'`
   - Customer contact info for follow-up
   - Retry button

3. **Held Payouts**
   - Payouts with `status = 'held'`
   - Reason (missing Stripe account, transfer failed)
   - Manual retry option

4. **Daily Revenue Report**
   - Total captured
   - Total paid out
   - Reserve balance
   - Net margin

### Common Admin Actions

**Retry Failed Capture:**
```typescript
// Admin console action
const retryCapture = async (jobId: string) => {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  await stripe.paymentIntents.capture(job.paymentIntentId);
  await db.update(jobs).set({ paymentStatus: 'captured' });
};
```

**Retry Held Payout:**
```typescript
// Admin console action
const retryPayout = async (payoutId: string) => {
  const payout = await db.query.payouts.findFirst({ where: eq(payouts.id, payoutId) });
  // Manually trigger transfer logic
};
```

**Refund Customer:**
```typescript
// Admin console action (disputes)
const refundJob = async (jobId: string, amount?: number) => {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  await stripe.refunds.create({
    payment_intent: job.paymentIntentId,
    amount: amount, // Optional partial refund
  });
  // Refund drawn from reserve, not cleaner payouts
};
```

---

## Spec Compliance Summary

✅ **Section 1:** First clean prepaid at signup  
✅ **Section 3:** Pre-auth night before each clean  
✅ **Section 5:** 2% reserve held automatically  
✅ **Section 8:** Cleaner pay = $17/hr + bonuses  
✅ **Section 14:** Evidence packet required before capture  
✅ **Section 20:** Instant payouts via Stripe Connect  

---

## Contact & Support

For questions or issues with the payment flow:
- Check logs in admin console
- Review Stripe dashboard for transaction details
- Verify environment variables are set correctly
- Ensure cron jobs are running on schedule

**Critical:** Never expose `STRIPE_SECRET_KEY` or API keys in client-side code.