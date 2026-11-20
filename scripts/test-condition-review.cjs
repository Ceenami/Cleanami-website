const path = require('node:path'), assert = require('node:assert/strict');
exports.verify = async function(ctx, harness) {
  const { db, pg, schema, seed, contracts, test, replace, root, uuid } = ctx;
  const { publicBooking, portal, form, provider, intentMap, management } = harness;
  const { eq } = require('drizzle-orm');
  const condition = { unusualConditions: true, conditionDescription: '  Extensive debris in the living room.  ' };
  const review = { description: condition.conditionDescription.trim() };
  const messages = [], cleanerMessages = [], refundMap = new Map(), requests = [], refundKeys = new Map();
  let nextStatus = 'succeeded', timeoutAfter = false, failBefore = false, emailFails = false, pauseAfter;
  provider.refunds.list = async ({ payment_intent, starting_after, limit = 100 }) => {
    const all = [...refundMap.values()].filter(r => r.payment_intent === payment_intent), offset = starting_after ? all.findIndex(r => r.id === starting_after) + 1 : 0;
    return { data: all.slice(offset, offset + limit), has_more: all.length > offset + limit };
  };
  provider.refunds.create = async (input, options) => {
    requests.push({ input, key: options.idempotencyKey });
    if (refundKeys.has(options.idempotencyKey)) return refundKeys.get(options.idempotencyKey);
    if (failBefore) { failBefore = false; throw Error('Synthetic network unavailable'); }
    const intent = intentMap.get(input.payment_intent);
    const refund = { id: `re_${uuid()}`, amount: input.amount, currency: 'usd', status: nextStatus, metadata: input.metadata,
      payment_intent: intent.id, charge: intent.latest_charge.id };
    refundMap.set(refund.id, refund); refundKeys.set(options.idempotencyKey, refund);
    if (pauseAfter) { const pause = pauseAfter; pauseAfter = undefined; await pause(); }
    if (timeoutAfter) { timeoutAfter = false; throw Error('Synthetic timeout after acceptance'); }
    return refund;
  };
  provider.paymentIntents.cancel = async id => { const intent = intentMap.get(id); intent.status = 'canceled'; return intent; };
  replace('lib/services/email.service.ts', { sendCancellationEmail: async input => { messages.push(input); return { success: !emailFails }; } });
  replace('lib/services/notifications/notify.ts', { notifyCleaner: async input => { cleanerMessages.push(input); } });
  const service = require(path.join(root, 'lib/services/condition-review.service.ts'));
  const action = { action: 'reject', reason: 'We cannot safely perform the requested cleaning.' };
  const saved = id => db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  const audits = id => db.select().from(schema.phase2cAudit).where(eq(schema.phase2cAudit.subjectId, id));
  function bindPayment(job, amount) {
    const intent = { id: job.paymentIntentId, status: 'succeeded', amount, amount_received: amount, currency: 'usd',
      latest_charge: { id: `ch_${uuid()}`, payment_intent: job.paymentIntentId, amount, currency: 'usd', paid: true, captured: true, amount_refunded: 0 } };
    intentMap.set(intent.id, intent); return intent;
  }
  async function fixture({ legacy = false, v1 = false, oldV2 = false, skip = false } = {}) {
    const f = await seed();
    await db.update(schema.properties).set({ serviceType: 'residential_one_time', bedCount: 1, bathCount: '1', sqFt: 750 }).where(eq(schema.properties.id, f.property.id));
    const pricing = require(path.join(root, 'lib/pricing/residential.ts'));
    const sale = v1 ? pricing.evaluateResidentialPrice({ bedrooms: 1, bathrooms: 1, sqft: 750, cleaningLevel: 'deep', petsAllowed: false })
      : require(path.join(root, 'lib/pricing/residential-sales.ts')).evaluateResidentialSale({ bedrooms: 1, bathrooms: 1, sqft: 750, cleaningLevel: 'deep', purpose: 'move_in', petsAllowed: false, hotTub: 'none', inUnitLaundryLoads: 0 });
    assert.ok(sale.ok);
    if (oldV2) delete sale.terms.executionPolicy;
    const staffing = pricing.buildResidentialJobStaffing(sale.terms, sale.terms.amountCents);
    const values = { propertyId: f.property.id, serviceType: 'residential_one_time', jobSource: 'customer_one_off', calendarEventUid: uuid(),
      checkInTime: new Date(Date.now() + 30 * 60000), checkOutTime: new Date(Date.now() + 6 * 3600000), status: 'assigned',
      expectedHours: staffing.expectedHours, paymentIntentId: skip ? 'skipped_owner_payment' : `pi_${uuid()}`, paymentStatus: 'captured',
      addonsSnapshot: { ...(legacy ? { laundryType: 'none' } : staffing.addonsSnapshot), conditionReview: review },
      checklistSnapshot: require(path.join(root, 'lib/cleaner/checklist-snapshot.ts')).createChecklistSnapshot({ ...f.property, serviceType: 'residential_one_time', cleaningLevel: 'deep', ...(legacy ? {} : { residentialPricing: staffing.addonsSnapshot.residentialPricing }) }, []) };
    const [job] = legacy ? await db.insert(schema.jobs).values(values).returning() : await contracts.insertIssuedJobs(db, [values]);
    await db.update(schema.cleaners).set({ accountStatus: 'active', eligibleForAssignments: true, residentialQualified: true }).where(eq(schema.cleaners.id, f.cleaner.id));
    await db.insert(schema.availabilityDays).values({ cleanerId: f.cleaner.id, date: require('date-fns-tz').formatInTimeZone(job.checkInTime, 'America/New_York', 'yyyy-MM-dd'), isAvailable: true, onCallEligible: false, openPoolEligible: false, actorId: 'synthetic' });
    await db.insert(schema.jobsToCleaners).values({ jobId: job.id, cleanerId: f.cleaner.id, role: 'primary', urgentBonus: !oldV2 });
    const intent = bindPayment(job, sale.terms.amountCents);
    return { ...f, job, intent };
  }
  await test('condition validation rejects whitespace/oversize and keeps ordinary historical payment identities unchanged', async () => {
    const input = form('move_in', { ...condition, conditionDescription: '  ' });
    const result = await publicBooking.evaluateResidentialBooking(input); assert.equal(result.ok, false); assert.match(result.error, /Describe/);
    assert.equal((await publicBooking.evaluateResidentialBooking({ ...input, conditionDescription: 'x'.repeat(2001) })).ok, false);
    const { residentialPaymentIdentity } = require(path.join(root, 'lib/pricing/residential-payment-identity.ts'));
    const base = { inputIdentity: 'synthetic', email: 'A@example.invalid', address: 'Synthetic', cleanDate: '2030-11-04', arrivalWindow: '9-11am', amountCents: 1000, promoCode: null, promoDiscountCents: 0 };
    assert.equal(residentialPaymentIdentity(base), require('node:crypto').createHash('sha256').update(JSON.stringify(['synthetic', 'a@example.invalid', 'synthetic', base.cleanDate, base.arrivalWindow, 1000, '', 0])).digest('hex'));
    assert.notEqual(residentialPaymentIdentity(base), residentialPaymentIdentity({ ...base, conditionReview: review }));
  });
  await test('public normal paid booking freezes condition through checkout/recovery and refuses changed descriptions before refund/issuance', async () => {
    const input = form('move_in', condition), token = uuid();
    const created = await publicBooking.createResidentialPaymentIntent({ formData: input, sessionToken: token }); assert.ok(created.ok, JSON.stringify(created));
    const intent = [...intentMap.values()].at(-1);
    assert.ok(intent.metadata.condition_review_hash); assert.equal(JSON.stringify(intent.metadata).includes(review.description), false);
    const attempt = await db.query.residentialCheckoutAttempts.findFirst({ where: eq(schema.residentialCheckoutAttempts.paymentIntentId, intent.id) });
    assert.deepEqual(attempt.terms.conditionReview, review);
    const { getArrivalInstant } = require(path.join(root, 'lib/scheduling/residential-notice.ts'));
    const recovery = await publicBooking.evaluateResidentialBooking(input, new Date(+getArrivalInstant(input.cleanDate, input.arrivalWindow) - 3600000), false,
      { version: attempt.terms.ruleVersion, configHash: attempt.terms.configHash, executionPolicy: attempt.terms.executionPolicy });
    assert.equal(recovery.ok, true); assert.deepEqual(recovery.residentialTerms.conditionReview, review);
    assert.equal((await publicBooking.completeResidentialBooking({ ...input, conditionDescription: 'Different debris' }, intent.id)).success, false);
    assert.equal((await publicBooking.completeResidentialBooking({ ...input, unusualConditions: false }, intent.id)).success, false);
    const completed = await publicBooking.completeResidentialBooking(input, intent.id); assert.ok(completed.success, JSON.stringify(completed));
    const job = await saved(completed.data.job.id); assert.deepEqual(job.addonsSnapshot.conditionReview, review);
    assert.equal(job.status, 'unassigned'); assert.equal(job.paymentStatus, 'captured'); assert.ok(await contracts.getExecutionContract(job.id));
    assert.equal(job.addonsSnapshot.requiresManualStaffing, false);
    assert.equal((await db.query.properties.findFirst({ where: eq(schema.properties.id, job.propertyId) })).specialInstructions, null);
    assert.equal(management.at(-1).email, true);
    const count = management.length; assert.ok((await publicBooking.completeResidentialBooking(input, intent.id)).success); assert.equal(management.length, count);
    assert.equal((await publicBooking.createResidentialPaymentIntent({ formData: { ...input, conditionDescription: 'Changed condition' }, sessionToken: token })).ok, false);
  });
  await test('portal flags are owner scoped, persist only on this paid booking, and cannot change during retries', async () => {
    const f = await seed();
    await db.update(schema.properties).set({ serviceType: 'residential_one_time', bedCount: 1, bathCount: '1', sqFt: 750 }).where(eq(schema.properties.id, f.property.id));
    await db.update(schema.customers).set({ stripeCustomerId: `cus_${uuid()}` }).where(eq(schema.customers.id, f.property.customerId));
    const base = { propertyId: f.property.id, date: '2030-11-10', cleaningLevel: 'deep', purpose: 'move_out', hotTub: 'none', inUnitLaundryLoads: 0, pricingVersion: 'residential-v2' };
    const quote = await portal.quoteResidentialOneOff(f.property.customerId, base);
    const input = { ...base, ...condition, quoteIdentity: quote.inputIdentity, arrivalWindow: quote.arrivalWindowKeys[0] };
    assert.equal((await portal.bookOneOffClean(uuid(), input)).success, false);
    assert.equal((await portal.bookOneOffClean(f.property.customerId, { ...input, conditionDescription: ' ' })).success, false);
    const booking = await portal.bookOneOffClean(f.property.customerId, input); assert.ok(booking.success, JSON.stringify(booking));
    assert.deepEqual((await saved(booking.jobId)).addonsSnapshot.conditionReview, review);
    assert.equal(management.at(-1).email, true);
    assert.equal((await portal.bookOneOffClean(f.property.customerId, { ...input, conditionDescription: 'Changed' })).success, false);
    assert.equal((await portal.bookOneOffClean(f.property.customerId, input)).jobId, booking.jobId);
    const next = { ...base, date: '2030-11-11', quoteIdentity: quote.inputIdentity, arrivalWindow: quote.arrivalWindowKeys[0] };
    const unflagged = await portal.bookOneOffClean(f.property.customerId, next); assert.ok(unflagged.success, JSON.stringify(unflagged));
    assert.equal((await saved(unflagged.jobId)).addonsSnapshot.conditionReview, undefined);
  });
  for (const variant of [{}, { legacy: true }, { v1: true }, { oldV2: true }]) await test(`rejection 30 minutes before start refunds fully with no penalty; preserves issued terms/history/pay ${JSON.stringify(variant)}`, async () => {
    const f = await fixture(variant), before = await saved(f.job.id);
    // Existing agreed pay is left untouched while compensation is separately reviewed.
    const assignment = await db.query.jobsToCleaners.findFirst({ where: eq(schema.jobsToCleaners.jobId, f.job.id) });
    const pay = require(path.join(root, 'lib/pricing/cleaner-pay.ts')).computeCleanerPay({ residentialPricing: f.job.addonsSnapshot.residentialPricing,
      assignmentTerms: assignment.residentialPayTerms, expectedHours: Number(f.job.expectedHours), hourlyRateCents: assignment.frozenHourlyRateCents, role: 'primary', urgentBonus: assignment.urgentBonus });
    await db.insert(schema.payouts).values({ jobId: f.job.id, cleanerId: f.cleaner.id, amount: pay.total.toFixed(2), urgentBonusAmount: pay.urgentBonus?.toFixed(2) ?? null, payReceipt: pay.receipt ?? null, status: 'pending' });
    const payouts = JSON.stringify(await db.select().from(schema.payouts).where(eq(schema.payouts.jobId, f.job.id)));
    const result = await service.actOnConditionReview(f.job.id, 'synthetic-admin', action);
    assert.equal(result.status, 'refunded', JSON.stringify(result));
    const after = await saved(f.job.id); assert.equal(after.status, 'canceled'); assert.equal(after.paymentStatus, 'refunded');
    const overview = await service.loadConditionReview(f.job.id); assert.equal(overview.refund.refundedCents, f.intent.amount); assert.ok(overview.refund.refundIds.length);
    for (const key of ['addonsSnapshot', 'checklistSnapshot', 'expectedHours', 'paymentIntentId', 'checkInTime', 'checkOutTime']) assert.deepEqual(after[key], before[key]);
    assert.equal(JSON.stringify(await db.select().from(schema.payouts).where(eq(schema.payouts.jobId, f.job.id))), payouts);
    assert.equal((await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId, f.job.id))).length, 0);
    const audit = await audits(f.job.id), rejection = audit.find(r => r.kind === 'condition_rejection');
    assert.equal(rejection.actorId, 'synthetic-admin'); assert.equal(rejection.payload.assignments[0].cleanerId, f.cleaner.id);
    assert.ok(messages.some(m => m.detail.includes(action.reason) && m.detail.includes('No customer cancellation penalty')));
    assert.ok(cleanerMessages.some(m => m.cleanerId === f.cleaner.id));
    const count = requests.length, emails = messages.length;
    assert.equal((await service.actOnConditionReview(f.job.id, 'another-admin', action)).status, 'refunded');
    assert.equal(requests.length, count); assert.equal(messages.length, emails);
    await assert.rejects(() => service.actOnConditionReview(f.job.id, 'synthetic-admin', { ...action, reason: 'Different decision' }), /already recorded/);
  });
  await test('pending refund stays captured until successful provider observation; no repeated refund or notices', async () => {
    const f = await fixture(); nextStatus = 'pending';
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'pending');
    assert.equal((await saved(f.job.id)).paymentStatus, 'captured'); const count = requests.length;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', { ...action, retryRefund: true })).status, 'pending'); assert.equal(requests.length, count);
    [...refundMap.values()].filter(r => r.payment_intent === f.intent.id).forEach(r => r.status = 'succeeded');
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'refunded'); nextStatus = 'succeeded';
  });
  await test('known failed refund needs an explicit retry with a new persisted identity', async () => {
    const f = await fixture(); nextStatus = 'failed';
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'failed'); const first = requests.at(-1).key;
    assert.equal((await saved(f.job.id)).paymentStatus, 'captured'); const count = requests.length;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'failed'); assert.equal(requests.length, count);
    nextStatus = 'succeeded'; assert.equal((await service.actOnConditionReview(f.job.id, 'admin', { ...action, retryRefund: true })).status, 'refunded');
    assert.notEqual(requests.at(-1).key, first);
  });
  await test('unknown provider result after acceptance reconciles without another refund', async () => {
    const f = await fixture(); timeoutAfter = true;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'review_required'); assert.equal((await saved(f.job.id)).paymentStatus, 'captured');
    const count = requests.length;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'refunded'); assert.equal(requests.length, count);
  });
  await test('failed transport retries the same identity; expired uncertain identity requires reconciliation', async () => {
    const f = await fixture(); failBefore = true;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'review_required'); const key = requests.at(-1).key;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'refunded'); assert.equal(requests.at(-1).key, key);
    const old = await fixture(); failBefore = true; await service.actOnConditionReview(old.job.id, 'admin', action);
    const attempt = (await audits(old.job.id)).find(r => r.kind === 'condition_refund_attempt');
    await db.update(schema.phase2cAudit).set({ createdAt: new Date(Date.now() - 25 * 3600000) }).where(eq(schema.phase2cAudit.id, attempt.id));
    const count = requests.length; assert.equal((await service.actOnConditionReview(old.job.id, 'admin', action)).status, 'review_required'); assert.equal(requests.length, count);
  });
  await test('prior successful partial/full refunds use remaining balance only; pending prior refunds block a new request', async () => {
    for (const state of ['partial', 'full', 'pending']) {
      const f = await fixture(), amount = state === 'partial' ? 100 : f.intent.amount;
      refundMap.set(`prior_${uuid()}`, { id: `re_${uuid()}`, amount, currency: 'usd', status: state === 'pending' ? 'pending' : 'succeeded', payment_intent: f.intent.id, charge: f.intent.latest_charge.id, metadata: {} });
      const count = requests.length; const result = await service.actOnConditionReview(f.job.id, 'admin', action);
      assert.equal(result.status, state === 'pending' ? 'pending' : 'refunded');
      if (state === 'partial') assert.equal(requests.at(-1).input.amount, f.intent.amount - 100); else assert.equal(requests.length, count);
    }
  });
  await test('provider mismatch/missing payment identity never claims a refund or creates a charge', async () => {
    const f = await fixture(); f.intent.amount += 1;
    const count = requests.length; assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'review_required'); assert.equal(requests.length, count);
    const missing = await fixture({ legacy: true }); await db.update(schema.jobs).set({ paymentIntentId: null }).where(eq(schema.jobs.id, missing.job.id));
    assert.equal((await service.actOnConditionReview(missing.job.id, 'admin', action)).status, 'review_required'); assert.equal(requests.length, count);
    const authorized = await fixture(); authorized.intent.status = 'requires_capture'; authorized.intent.amount_received = 0;
    assert.equal((await service.actOnConditionReview(authorized.job.id, 'admin', action)).status, 'no_charge');
    const skipped = await fixture({ skip: true }); const skipCount = requests.length;
    assert.equal((await service.actOnConditionReview(skipped.job.id, 'admin', action)).status, 'no_charge'); assert.equal(requests.length, skipCount);
    const inconsistent = await fixture(); inconsistent.intent.status = 'canceled';
    assert.equal((await service.actOnConditionReview(inconsistent.job.id, 'admin', action)).status, 'review_required'); assert.equal(requests.length, skipCount);
  });
  await test('refund history pagination and misleading charge refund totals cannot over-refund or fake success', async () => {
    const f = await fixture();
    for (let i = 0; i < 101; i++) {
      const refund = { id: `re_${uuid()}`, amount: 1, currency: 'usd', status: 'succeeded', payment_intent: f.intent.id, charge: f.intent.latest_charge.id, metadata: {} };
      refundMap.set(refund.id, refund);
    }
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', action)).status, 'refunded'); assert.equal(requests.at(-1).input.amount, f.intent.amount - 101);
    const pending = await fixture(); pending.intent.latest_charge.amount_refunded = pending.intent.amount;
    const refund = { id: `re_${uuid()}`, amount: pending.intent.amount, currency: 'usd', status: 'pending', payment_intent: pending.intent.id, charge: pending.intent.latest_charge.id, metadata: {} };
    refundMap.set(refund.id, refund); const count = requests.length;
    assert.equal((await service.actOnConditionReview(pending.job.id, 'admin', action)).status, 'pending');
    assert.equal((await saved(pending.job.id)).paymentStatus, 'captured'); assert.equal(requests.length, count);
  });
  await test('interleaved retries share one provider request; notification failure cannot block refund', async () => {
    const f = await fixture();
    let reached, resume;
    const barrier = new Promise(resolve => { reached = resolve; }), hold = new Promise(resolve => { resume = resolve; });
    pauseAfter = async () => { reached(); await hold; };
    const first = service.actOnConditionReview(f.job.id, 'admin-one', action);
    // First action is paused ONLY at provider I/O, outside its DB transaction.
    // The second action's DB queries remain sequential; no Promise.all DB use.
    await barrier; const count = requests.length;
    const second = await service.actOnConditionReview(f.job.id, 'admin-two', action);
    assert.equal(second.status, 'refunded'); resume(); assert.equal((await first).status, 'refunded'); assert.equal(requests.length, count);
    assert.equal((await audits(f.job.id)).filter(r => r.kind === 'condition_rejection').length, 1);
    assert.equal((await audits(f.job.id)).filter(r => r.kind === 'condition_refund_attempt').length, 1);
    const emailFailure = await fixture(); emailFails = true;
    assert.equal((await service.actOnConditionReview(emailFailure.job.id, 'admin', action)).status, 'refunded');
    assert.ok((await service.loadConditionReview(emailFailure.job.id)).notices.some(n => n.status === 'failed')); emailFails = false;
  });
  await test('started/completed/unflagged work and blank reasons are protected; marking reviewed does not change assignment/payment', async () => {
    assert.equal(service.conditionReviewActionSchema.safeParse({ action: 'reject', reason: ' ' }).success, false);
    const f = await fixture(), before = await saved(f.job.id), count = requests.length;
    assert.equal((await service.actOnConditionReview(f.job.id, 'admin', { action: 'reviewed' })).status, 'reviewed');
    assert.deepEqual(await saved(f.job.id), before); assert.equal(requests.length, count); assert.equal((await service.loadConditionReview(f.job.id)).reviewed, true);
    await db.insert(schema.evidencePackets).values({ jobId: f.job.id, gpsCheckInTimestamp: new Date() });
    await assert.rejects(() => service.actOnConditionReview(f.job.id, 'admin', action), /Started/);
    const done = await fixture({ legacy: true }); await db.update(schema.jobs).set({ status: 'completed' }).where(eq(schema.jobs.id, done.job.id));
    await assert.rejects(() => service.actOnConditionReview(done.job.id, 'admin', action), /Started/);
    const unflagged = await seed(), [job] = await db.insert(schema.jobs).values({ propertyId: unflagged.property.id, calendarEventUid: uuid(), status: 'unassigned' }).returning();
    await assert.rejects(() => service.actOnConditionReview(job.id, 'admin', action), /no exceptional/);
    assert.equal(requests.length, count);
  });
  await test('admin API authorizes before reads/actions and validates reason without trusting posted actors', async () => {
    let authorized = false;
    replace('lib/admin-auth.ts', { getAdminAuth: async () => ({ isAdmin: authorized, actorId: 'trusted-admin' }) });
    const route = require(path.join(root, 'app/api/admin/jobs/[id]/condition-review/route.ts'));
    const f = await fixture(), params = { params: Promise.resolve({ id: f.job.id }) };
    assert.equal((await route.GET(new Request('https://example.invalid'), params)).status, 401);
    assert.equal((await route.POST(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(action) }), params)).status, 401);
    assert.equal((await saved(f.job.id)).status, 'assigned'); authorized = true;
    for (const body of [{ action: 'reject', reason: ' ' }, { ...action, actorId: 'forged' }, { action: 'reject' }])
      assert.equal((await route.POST(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(body) }), params)).status, 400);
    const response = await route.GET(new Request('https://example.invalid'), params); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.json()).description, review.description);
    assert.equal((await route.POST(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(action) }), params)).status, 200);
    assert.equal((await audits(f.job.id)).find(r => r.kind === 'condition_rejection').actorId, 'trusted-admin');
  });
  await test('admin condition filter includes flagged history and customer queries remain owner scoped without exposing description', async () => {
    const queries = require(path.join(root, 'lib/queries/jobs.ts'));
    const result = await queries.getJobsWithDetails({ conditionReviewOnly: true, limit: 500 });
    assert.ok(result.data.length > 0); assert.ok(result.data.every(j => j.conditionReviewRequired));
    const flagged = result.data.find(j => j.purpose === 'move_in'); assert.ok(flagged);
    assert.match(require(path.join(root, 'lib/constants/service-type.ts')).getJobDisplay(flagged).label, /Move-In/);
    const f = await fixture();
    const own = await queries.getJobsWithDetails({ customerId: f.property.customerId, conditionReviewOnly: true, limit: 500 });
    assert.equal(own.data.length, 1); assert.equal(own.data[0].id, f.job.id);
    const dto = require(path.join(root, 'lib/customer/job-list.ts')).toCustomerJobListItem(own.data[0]);
    assert.equal('conditionReview' in dto, false); assert.equal('conditionReviewRequired' in dto, false); assert.equal('addonsSnapshot' in dto, false);
    const requestsBefore = requests.length;
    // Load the ordinary cancellation facade after restoring its current mocks.
    delete require.cache[require.resolve(path.join(root, 'lib/services/customer-cancellation.service.ts'))];
    await assert.rejects(() => require(path.join(root, 'lib/services/customer-cancellation.service.ts')).cancelJobAsAdmin(f.job.id), /Use Condition Review/);
    assert.equal(requests.length, requestsBefore); assert.equal((await saved(f.job.id)).status, 'assigned');
  });
  if (process.argv.includes('--checklist-viewers')) await require('./test-checklist-viewers.cjs').verify(ctx);
};
if (require.main === module) {
  const env = { ...process.env, PHASE3A_OFFLINE_BOOTSTRAP: '1' };
  for (const key of Object.keys(env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid/i.test(key)) delete env[key];
  const run = require('node:child_process').spawnSync(process.execPath, ['--require', path.join(__dirname, 'test-residential-purposes.cjs'), path.join(__dirname, 'test-job-execution.cjs'), '--with-schedule-upgrade', '--phase2c', '--residential-purposes', '--condition-review'], { env, stdio: 'inherit', windowsHide: true });
  process.exitCode = run.status ?? 1;
}
