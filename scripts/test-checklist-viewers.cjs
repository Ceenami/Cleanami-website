const path = require('node:path'), assert = require('node:assert/strict');
exports.verify = async function(ctx) {
  const { db, pg, schema, seed, contracts, test, replace, root, uuid } = ctx;
  const { eq } = require('drizzle-orm');
  let signMode = 'ok', signed = [], generation = 0;
  replace('lib/storage/signed-url.ts', { CHECKLISTS_BUCKET: 'synthetic-checklists', EVIDENCE_BUCKET: 'synthetic-evidence',
    createSignedUrls: async (_bucket, paths) => {
      signed.push(...paths); generation++;
      if (signMode === 'throw') throw Error('Synthetic storage unavailable');
      return paths.map(() => signMode === 'missing' ? null : `https://files.example.invalid/signed?generation=${generation}`);
    } });
  const view = require(path.join(root, 'lib/services/checklist-view.service.ts'));
  const propertyService = require(path.join(root, 'lib/services/property-checklists.ts'));
  const rental = require(path.join(root, 'lib/checklists/rental-library.ts'));
  const pure = require(path.join(root, 'lib/checklists/view.ts'));
  const admin = { kind: 'admin' };
  const jobRow = id => db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  async function issued(f, snapshot, extra = {}) {
    const [job] = await contracts.insertIssuedJobs(db, [{ propertyId: f.property.id, serviceType: 'vacation_rental_subscription',
      calendarEventUid: uuid(), status: 'unassigned', jobSource: 'ical', expectedHours: '3',
      checkInTime: new Date('2030-11-10T15:00Z'), checkOutTime: new Date('2030-11-10T21:00Z'),
      addonsSnapshot: { laundryType: 'none', petsAllowed: false, hotTubServiceLevel: 'none' }, checklistSnapshot: snapshot, ...extra }]);
    return job;
  }
  await test('current default rental without documents displays Default and all effective tasks without writes', async () => {
    const f = await seed(), before = JSON.stringify(await db.query.properties.findFirst({ where: eq(schema.properties.id, f.property.id) }));
    const result = await view.loadPropertyChecklistView(f.property.id, 'standard', f.property.customerId);
    assert.equal(result.sourceLabel, 'Default'); assert.equal(result.record, 'current'); assert.ok(result.items.length > 0); assert.equal(result.files.length, 0);
    assert.equal(JSON.stringify(await db.query.properties.findFirst({ where: eq(schema.properties.id, f.property.id) })), before);
    assert.equal((await db.select().from(schema.propertyChecklistState).where(eq(schema.propertyChecklistState.propertyId, f.property.id))).length, 0);
    await assert.rejects(() => view.loadPropertyChecklistView(f.property.id, 'standard', uuid()), view.ChecklistNotFound);
  });
  await test('published library selection is Customer Custom; pending/rejected drafts retain active published items', async () => {
    const f = await seed(), draft = rental.basicRentalDraft(f.property), optional = rental.rentalLibrary(f.property).find(item => !item.mandatory);
    assert.ok(optional); draft.libraryIds = draft.libraryIds.filter(id => id !== optional.id);
    await propertyService.savePropertyChecklist(f.property.id, draft, 0, 'synthetic-owner');
    const published = await view.loadPropertyChecklistView(f.property.id, 'standard');
    assert.equal(published.sourceLabel, 'Customer Custom'); assert.equal(published.revision, 1); assert.ok(!published.items.some(i => i.id === optional.id));
    const pending = { ...draft, customTasks: [{ id: 'custom-review-test', task: 'Synthetic pending task', section: 'Kitchen' }] };
    await propertyService.savePropertyChecklist(f.property.id, pending, 1, 'synthetic-owner');
    const waiting = await view.loadPropertyChecklistView(f.property.id, 'standard');
    assert.deepEqual(waiting.items, published.items); assert.match(waiting.publicationNotice, /await admin review/); assert.equal(waiting.sourceLabel, 'Customer Custom');
    await propertyService.savePropertyChecklist(f.property.id, pending, 2, 'synthetic-admin', { action: 'reject', reason: 'Synthetic review rejection' });
    const rejected = await view.loadPropertyChecklistView(f.property.id, 'standard'); assert.deepEqual(rejected.items, published.items); assert.match(rejected.publicationNotice, /rejected/);
    await propertyService.savePropertyChecklist(f.property.id, pending, 3, 'synthetic-owner');
    await propertyService.savePropertyChecklist(f.property.id, pending, 4, 'synthetic-admin', { action: 'approve', reason: 'Synthetic approval' });
    const approved = await view.loadPropertyChecklistView(f.property.id, 'standard'); assert.equal(approved.sourceLabel, 'Customer Custom'); assert.ok(approved.items.some(i => i.id === 'custom-review-test'));
  });
  await test('residential current Standard/Deep preview reuses exact V2 company tasks without repricing or changing booked terms', async () => {
    const f = await seed(); await db.update(schema.properties).set({ serviceType: 'residential_one_time' }).where(eq(schema.properties.id, f.property.id));
    const snapshots = require(path.join(root, 'lib/cleaner/checklist-snapshot.ts'));
    for (const level of ['standard', 'deep']) {
      const result = await view.loadPropertyChecklistView(f.property.id, level, f.property.customerId);
      assert.equal(result.sourceLabel, 'Default'); assert.match(result.description, /template/);
      assert.deepEqual(result.items.map(({ state, ...item }) => item), snapshots.residentialV2ChecklistTasks({ cleaningLevel: level, hotTub: 'none', inUnitLaundryLoads: 0 }));
      if (level === 'deep') assert.ok(result.items.some(i => i.id === 'res-v2-oven-interior'));
    }
  });
  await test('issued job keeps original tasks after property customization; approved reissue resolves from audit without mutation', async () => {
    const f = await seed(), initial = await propertyService.issuePropertyChecklist(f.property, []), job = await issued(f, initial);
    const original = JSON.stringify(await jobRow(job.id));
    const originalContract = JSON.stringify(await contracts.getExecutionContract(job.id));
    const draft = rental.basicRentalDraft(f.property); draft.customTasks.push({ id: 'custom-later-test', task: 'Later approved task', section: 'Kitchen' });
    await propertyService.savePropertyChecklist(f.property.id, draft, 0, 'owner');
    await propertyService.savePropertyChecklist(f.property.id, draft, 1, 'admin', { action: 'approve', reason: 'Synthetic approval' });
    const property = await view.loadPropertyChecklistView(f.property.id, 'standard'), before = await view.loadJobChecklistView(job.id, admin);
    assert.ok(property.items.some(i => i.id === 'custom-later-test')); assert.ok(!before.items.some(i => i.id === 'custom-later-test'));
    const next = await propertyService.issuePropertyChecklist(f.property, []);
    await db.insert(schema.phase2cAudit).values({ subjectId: job.id, actorId: 'synthetic-admin', kind: 'checklist_reissued', payload: { next, executionRevision: 1 } });
    const revised = await view.loadJobChecklistView(job.id, admin);
    assert.equal(revised.executionRevision, 1); assert.equal(revised.sourceLabel, 'Customer Custom'); assert.ok(revised.items.some(i => i.id === 'custom-later-test'));
    assert.equal(JSON.stringify(await jobRow(job.id)), original);
    // Original contract row is unchanged; the established reader returns effective reissue terms.
    const stored = await db.query.jobExecutionContracts.findFirst({ where: eq(schema.jobExecutionContracts.jobId, job.id) });
    assert.ok(!stored.terms.checklist.some(i => i.id === 'custom-later-test')); assert.ok(originalContract);
  });
  await test('completion shows submitted/draft/unknown truthfully; customers cannot read cleaner drafts or private notes', async () => {
    const f = await seed(), snapshot = await propertyService.issuePropertyChecklist(f.property, []), job = await issued(f, snapshot);
    const [first, second] = snapshot.items;
    await db.insert(schema.jobEvidenceDrafts).values({ jobId: job.id, items: [{ ...first, completed: true }, { ...second, completed: false }], notes: 'PRIVATE-DRAFT-NOTE' });
    const staff = await view.loadJobChecklistView(job.id, admin); assert.equal(staff.completion, 'draft'); assert.equal(staff.items[0].state, 'completed'); assert.equal(staff.items[1].state, 'not_completed');
    const customer = await view.loadJobChecklistView(job.id, { kind: 'customer', customerId: f.property.customerId }); assert.equal(customer.completion, null); assert.ok(customer.items.every(i => i.state === 'not_recorded'));
    assert.equal(JSON.stringify(staff).includes('PRIVATE-DRAFT-NOTE'), false);
    await db.insert(schema.evidencePackets).values({ jobId: job.id, isChecklistComplete: true, checklistLog: { items: [{ ...first, completed: true }, { ...second, completed: false }], notes: 'PRIVATE-PACKET-NOTE' } });
    const submitted = await view.loadJobChecklistView(job.id, { kind: 'customer', customerId: f.property.customerId }); assert.equal(submitted.completion, 'submitted'); assert.equal(submitted.items[0].state, 'completed'); assert.equal(submitted.items[1].state, 'not_completed'); assert.equal(submitted.items[2].state, 'not_recorded');
    const changed = { ...snapshot, items: snapshot.items.map(i => i.id === first.id ? { ...i, task: 'Revised task with same ID' } : i) };
    await db.insert(schema.phase2cAudit).values({ subjectId: job.id, actorId: 'admin', kind: 'checklist_reissued', payload: { next: changed, executionRevision: 1 } });
    assert.equal((await view.loadJobChecklistView(job.id, admin)).items[0].state, 'not_recorded');
    assert.equal(JSON.stringify(submitted).includes('PRIVATE-PACKET-NOTE'), false);
  });
  await test('legacy job uses recorded history only; missing and corrupt issued records never fall back to today’s property', async () => {
    const f = await seed(), [job] = await db.insert(schema.jobs).values({ propertyId: f.property.id, calendarEventUid: uuid(), status: 'completed' }).returning();
    const before = JSON.stringify(await jobRow(job.id));
    const missing = await view.loadJobChecklistView(job.id, admin); assert.equal(missing.sourceLabel, 'Missing'); assert.equal(missing.items.length, 0);
    await db.insert(schema.evidencePackets).values({ jobId: job.id, isChecklistComplete: true, checklistLog: { items: [{ id: 'original-legacy', task: 'Original historical task', completed: true }] } });
    const recorded = await view.loadJobChecklistView(job.id, admin); assert.equal(recorded.sourceLabel, 'Recorded legacy checklist'); assert.equal(recorded.items[0].task, 'Original historical task'); assert.equal(recorded.items[0].state, 'completed');
    assert.equal(JSON.stringify(await jobRow(job.id)), before);
    const broken = { version: 1, source: 'default', defaultVersion: 'turnover-v2', items: [{ id: 'bad' }], files: [] };
    const [corrupt] = await db.insert(schema.jobs).values({ propertyId: f.property.id, calendarEventUid: uuid(), status: 'completed', checklistSnapshot: broken }).returning();
    await assert.rejects(() => view.loadJobChecklistView(corrupt.id, admin));
    assert.equal((await jobRow(corrupt.id)).checklistSnapshot.items[0].task, undefined);
  });
  await test('historical structured snapshots distinguish library customizations without relying on source=default', async () => {
    const f = await seed(), original = await propertyService.issuePropertyChecklist(f.property, []);
    delete original.origin;
    const defaultJob = await issued(f, original);
    assert.equal((await view.loadJobChecklistView(defaultJob.id, admin)).sourceLabel, 'Default');
    const optional = rental.rentalLibrary(f.property).find(i => !i.mandatory);
    const custom = { ...original, propertyRevision: 1, items: original.items.filter(i => i.id !== optional.id) };
    const customJob = await issued(f, custom);
    assert.equal((await view.loadJobChecklistView(customJob.id, admin)).sourceLabel, 'Customer Custom');
    const unknown = await issued(f, original, { addonsSnapshot: { laundryType: 'none' } });
    assert.equal((await view.loadJobChecklistView(unknown.id, admin)).sourceLabel, 'Issued source not recorded');
  });
  await test('document signing failures retain files and tasks; refresh remints links; unsafe source URLs never become anchors', async () => {
    const f = await seed();
    const snapshot = { version: 1, source: 'property_files', defaultVersion: null, items: [{ id: 'guide', task: 'Complete the issued guide' }], files: [
      { id: 'guide', fileName: 'Issued guide', storagePath: 'synthetic/issued.pdf', sourceUrl: null },
      { id: 'unsafe', fileName: 'Unsafe link', storagePath: null, sourceUrl: 'javascript:alert(1)' },
    ] };
    const job = await issued(f, snapshot), before = JSON.stringify(await jobRow(job.id));
    signMode = 'throw'; const unavailable = await view.loadJobChecklistView(job.id, admin); assert.equal(unavailable.sourceLabel, 'Customer Custom'); assert.equal(unavailable.files.length, 2); assert.ok(unavailable.files.every(f => f.url === null)); assert.ok(unavailable.items.length);
    signMode = 'ok'; const refreshed = await view.loadJobChecklistView(job.id, admin), again = await view.loadJobChecklistView(job.id, admin);
    assert.notEqual(refreshed.files[0].url, again.files[0].url); assert.equal(again.files[1].url, null); assert.equal(JSON.stringify(again).includes('synthetic/issued.pdf'), false);
    assert.equal(JSON.stringify(await jobRow(job.id)), before);
  });
  await test('owner and assignment checks run before signing; admin/customer/cleaner APIs enforce scope and no-store', async () => {
    const f = await seed(), snapshot = { version: 1, source: 'property_files', defaultVersion: null, items: [{ id: 'private', task: 'Complete the private guide' }], files: [{ id: 'private', fileName: 'Private guide', storagePath: 'private/guide.pdf', sourceUrl: null }] };
    const job = await issued(f, snapshot); const count = signed.length;
    await assert.rejects(() => view.loadJobChecklistView(job.id, { kind: 'customer', customerId: uuid() }), view.ChecklistNotFound);
    await assert.rejects(() => view.loadJobChecklistView(job.id, { kind: 'cleaner', cleanerId: f.cleaner.id }), view.ChecklistNotFound); assert.equal(signed.length, count);
    // Backup membership is still an assigned job and may read its issued checklist.
    await db.update(schema.cleaners).set({ accountStatus: 'active', eligibleForAssignments: true }).where(eq(schema.cleaners.id, f.cleaner.id));
    await db.insert(schema.jobsToCleaners).values({ jobId: job.id, cleanerId: f.cleaner.id, role: 'backup' });
    assert.equal((await view.loadJobChecklistView(job.id, { kind: 'cleaner', cleanerId: f.cleaner.id })).files.length, 1);
    let scope = { isAdmin: false, error: 'Unauthorized' }, cleanerId = null;
    replace('lib/customer-auth.ts', { resolvePortalCustomerScope: async () => scope, customerAuthErrorStatus: () => 401 });
    replace('lib/cleaner-auth.ts', { getCleanerAuth: async () => ({ cleanerId, error: cleanerId ? null : 'Unauthorized' }), cleanerAuthErrorStatus: () => 401 });
    const { NextRequest } = require('next/server'), jobRoute = require(path.join(root, 'app/api/jobs/[id]/checklist/route.ts')),
      propertyRoute = require(path.join(root, 'app/api/properties/[id]/checklist-view/route.ts')), cleanerRoute = require(path.join(root, 'app/api/cleaner/jobs/[id]/checklist/route.ts'));
    const request = new NextRequest('https://example.invalid'), params = { params: Promise.resolve({ id: job.id }) };
    assert.equal((await jobRoute.GET(request, params)).status, 401); assert.equal((await cleanerRoute.GET(request, params)).status, 401);
    scope = { isAdmin: false, customerId: uuid(), error: null };
    const before = signed.length; assert.equal((await jobRoute.GET(request, params)).status, 404); assert.equal(signed.length, before);
    assert.equal((await propertyRoute.GET(request, { params: Promise.resolve({ id: f.property.id }) })).status, 404);
    scope = { isAdmin: false, customerId: f.property.customerId, error: null };
    const own = await jobRoute.GET(request, params); assert.equal(own.status, 200); assert.match(own.headers.get('cache-control'), /private, no-store/);
    const body = await own.json(); assert.equal(body.snapshot, true); assert.equal(body.files.length, 1); assert.equal(body.checklist.files.length, 1);
    cleanerId = f.cleaner.id; assert.equal((await cleanerRoute.GET(request, params)).status, 200);
    scope = { isAdmin: true, error: null }; assert.equal((await propertyRoute.GET(request, { params: Promise.resolve({ id: f.property.id }) })).status, 200);
    const invalid = await propertyRoute.GET(new NextRequest('https://example.invalid?level=invalid'), { params: Promise.resolve({ id: f.property.id }) }); assert.equal(invalid.status, 400);
    const [broken] = await db.insert(schema.jobs).values({ propertyId: f.property.id, calendarEventUid: uuid(), checklistSnapshot: { invalid: true } }).returning();
    assert.equal((await jobRoute.GET(request, { params: Promise.resolve({ id: broken.id }) })).status, 500);
  });
  await test('shared viewer renders sectioned issued tasks, draft status, unavailable documents and real missing state safely', async () => {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const file = path.join(root, 'components/checklists/ChecklistViewer.tsx');
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const mod = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`)(name => name.startsWith('@/') ? require(path.join(root, name.slice(2))) : require(name), mod, mod.exports);
    const base = pure.checklistViewSchema.parse({ scope: 'job', record: 'issued', source: 'default', sourceLabel: 'Default', description: 'Issued clean', revision: 1, executionRevision: 0, publicationNotice: null,
      completion: 'draft', items: [{ id: 'a', task: '<script>unsafe text</script>', section: 'Kitchen', state: 'not_recorded' }], files: [{ id: 'a', fileName: 'Guide', url: null }] });
    const html = renderToStaticMarkup(React.createElement(mod.exports.ChecklistContents, { checklist: base }));
    for (const text of ['Kitchen', 'Draft progress', 'Not recorded', 'link unavailable', '&lt;script&gt;']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('<script>')); assert.ok(!html.includes('No checklist tasks'));
    const missing = renderToStaticMarkup(React.createElement(mod.exports.ChecklistContents, { checklist: { ...base, record: 'missing', source: 'missing', items: [], files: [] } }));
    assert.ok(missing.includes('No checklist tasks or documents are recorded'));
    const { QueryClient, QueryClientProvider } = require('@tanstack/react-query'), endpoint = '/api/jobs/synthetic/checklist';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const key = ['checklist-view', endpoint]; client.setQueryData(key, base);
    const renderViewer = () => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(mod.exports.ChecklistViewer, { endpoint })));
    const ready = renderViewer(); assert.ok(ready.includes('<summary')); assert.ok(ready.includes('View Checklist')); assert.ok(ready.includes('Default'));
    client.getQueryCache().find({ queryKey: key }).setState({ status: 'error', error: new Error('Synthetic load failure') });
    const failed = renderViewer(); assert.ok(failed.includes('Error — checklist could not be loaded')); assert.ok(failed.includes('Retry loading checklist')); assert.ok(!failed.includes('>Default<')); client.clear();
  });
};
if (require.main === module) {
  const env = { ...process.env, PHASE3A_OFFLINE_BOOTSTRAP: '1' };
  for (const key of Object.keys(env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid/i.test(key)) delete env[key];
  const run = require('node:child_process').spawnSync(process.execPath, ['--require', path.join(__dirname, 'test-residential-purposes.cjs'), path.join(__dirname, 'test-job-execution.cjs'), '--with-schedule-upgrade', '--phase2c', '--residential-purposes', '--condition-review', '--checklist-viewers'], { env, stdio: 'inherit', windowsHide: true });
  process.exitCode = run.status ?? 1;
}
