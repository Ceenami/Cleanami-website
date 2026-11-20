// In-memory PostgreSQL + actual middleware/actions/callbacks, with Auth/channel
// transports controlled. Root environment files and every network path blocked.
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto'), vm = require('node:vm');
for (const key of Object.keys(process.env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid/i.test(key)) delete process.env[key];
const root = path.resolve(__dirname, '..');
Object.assign(process.env, { TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.json'), NEXT_PUBLIC_APP_URL: 'https://return.example.invalid', NEXT_PUBLIC_SUPABASE_URL: 'https://sbdoazaoxgwgsfpcbqjx.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-no-network' });
require('tsx/cjs');
const Module = require('node:module'), originalLoad = Module._load;
let edgeClaims = null, authUser = null, loginFails = false, verificationFails = false, verificationThrows = false, databaseAvailable = true, cookieRefresh = true, edgeToken;
const verified = [], emailCalls = [], smsCalls = [], revalidated = [];
Module._load = function(name, ...args) {
  if (name === 'server-only') return {};
  if (['dotenv', 'postgres', 'twilio', 'resend', 'web-push'].includes(name)) throw Error('Provider/env import prohibited: ' + name);
  if (name === '@supabase/ssr') return { createServerClient: (_url, _key, options) => ({ auth: { getClaims: async token => {
    edgeToken = token;
    if (cookieRefresh) options.cookies.setAll([{ name: 'synthetic_session', value: 'rotated', options: { path: '/', httpOnly: true, sameSite: 'lax' } }]);
    return { data: { claims: edgeClaims } };
  } } }) };
  return originalLoad.call(this, name, ...args);
};
global.fetch = async () => { throw Error('Network prohibited'); };
for (const name of ['node:http', 'node:https']) { const transport = require(name); transport.request = transport.get = () => { throw Error('Network prohibited'); }; }
require('node:net').Socket.prototype.connect = function() { throw Error('Network prohibited'); };
function replace(file, exports) { const key = require.resolve(path.join(root, file)); require.cache[key] = { id: key, filename: key, loaded: true, exports }; }
const { PGlite } = require('@electric-sql/pglite'), { drizzle } = require('drizzle-orm/pglite'), { PgDialect, PgTable, getTableConfig, isPgEnum } = require('drizzle-orm/pg-core'), { is, SQL, eq } = require('drizzle-orm');
const schema = require('../db/schema.ts'), pg = new PGlite(), db = drizzle(pg, { schema }), uuid = () => crypto.randomUUID();
replace('db/index.ts', { db, schema, getDbOrNull: () => databaseAvailable ? db : null,
  sequentialQueries: async (...queries) => { const values = []; for (const query of queries) values.push(await query()); return values; } });
const provider = { auth: {
  signInWithPassword: async () => ({ data: { user: authUser }, error: loginFails ? { message: 'Synthetic invalid password' } : null }),
  getClaims: async () => ({ data: { claims: authUser ? { sub: authUser.id, email: authUser.email, user_metadata: { role: 'super_admin' } } : null } }),
  exchangeCodeForSession: async code => { verified.push({ code }); if (verificationThrows) throw Error('Synthetic Auth transport unavailable'); return { error: verificationFails ? { message: 'Synthetic expired code' } : null }; },
  verifyOtp: async input => { verified.push(input); if (verificationThrows) throw Error('Synthetic Auth transport unavailable'); return { error: verificationFails ? { message: 'Synthetic expired OTP' } : null }; },
} };
replace('lib/supabase/server.ts', { createClient: async () => provider, getBearerToken: async () => null, createAdminClient: () => { throw Error('Admin auth mutation prohibited'); } });
class Redirect extends Error { constructor(destination) { super('Synthetic Next redirect'); this.destination = destination; } }
replace('node_modules/next/navigation.js', { redirect: destination => { throw new Redirect(destination); } });
replace('node_modules/next/cache.js', { revalidatePath: destination => revalidated.push(destination) });
replace('lib/services/sms.service.ts', { sendSmsOutcome: async (phone, message, meta) => { smsCalls.push({ phone, message, meta }); return {status:'sent'}; } });
replace('lib/services/push.service.ts', { sendPushToCleaner: async () => 0 });
replace('lib/services/notifications/notification-log.ts', { recordNotificationAttempt: async () => {} });
replace('lib/resend.ts', { EMAIL_FROM: 'synthetic@example.invalid', getEmailUnavailableMessage: () => 'Synthetic disabled',
  getResend: () => ({ emails: { send: async input => { emailCalls.push(input); return { data: { id: 'synthetic' }, error: null }; } } }) });
replace('lib/emails/TransactionalEmail.tsx', { __esModule: true, default: props => props });
const { NextRequest } = require('next/server'), redirects = require('../lib/auth-redirects.ts'), { updateSession } = require('../lib/supabase/middleware.ts'), actions = require('../lib/actions/auth.actions.ts');
const callback = require('../app/auth/callback/route.ts'), confirm = require('../app/auth/confirm/route.ts');
const { notifyCleaner } = require('../lib/services/notifications/notify.ts'), email = require('../lib/services/email.service.ts');
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
async function setup() {
  const dialect = new PgDialect(), tables = new Map(), enums = new Map();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) enums.set(value.enumName, value.enumValues);
    if (is(value, PgTable)) { const table = getTableConfig(value); tables.set(table.name, table); for (const c of table.columns) if (c.enum?.enumName) enums.set(c.enum.enumName, c.enum.enumValues); }
  }
  for (const [name, values] of enums) await pg.exec(`CREATE TYPE "${name}" AS ENUM (${values.map(v => `'${v}'`).join(',')});`);
  for (const table of tables.values()) await pg.exec(`CREATE TABLE "${table.name}" (${table.columns.map(c => {
    let def = c.default === undefined ? '' : is(c.default, SQL) ? ' DEFAULT ' + dialect.sqlToQuery(c.default).sql : c.default === null ? ' DEFAULT NULL' : typeof c.default === 'string' ? " DEFAULT '" + c.default.replaceAll("'", "''") + "'" : typeof c.default === 'boolean' ? ' DEFAULT ' + c.default : typeof c.default === 'object' ? " DEFAULT '" + JSON.stringify(c.default) + "'::jsonb" : ' DEFAULT ' + c.default;
    return `"${c.name}" ${c.getSQLType()}${c.notNull ? ' NOT NULL' : ''}${def}`;
  }).join(',')});`);
}
function loginForm(next) { const data = new FormData(); data.set('email', authUser?.email ?? 'synthetic@example.invalid'); data.set('password', 'Synthetic-password'); if (next != null) data.set('next', next); return data; }
async function signInDestination(next) { try { const response = await actions.signInUser(undefined, loginForm(next)); return response; } catch (error) { if (error instanceof Redirect) return error.destination; throw error; } }
async function makeUser(role) { const [user] = await db.insert(schema.users).values({ id: uuid(), supabaseUserId: uuid(), email: `${uuid()}@example.invalid`, role }).returning(); return user; }
function authenticate(user) { authUser = { id: user.supabaseUserId, email: user.email, user_metadata: { role: 'super_admin' } }; }
function location(response) { return new URL(response.headers.get('location')); }
function loadUi(file, mocks = {}, footer = '') {
  const ts = require('typescript'), js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${js}\n${footer}\n})`)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? require(path.join(root, name.slice(2))) : name.startsWith('.') ? require(path.resolve(path.dirname(path.join(root, file)), name)) : require(name), mod, mod.exports); return mod.exports;
}
async function run() {
  await setup();
  const cleaner = await makeUser('cleaner'), customer = await makeUser('user'), admin = await makeUser('admin'), superAdmin = await makeUser('super_admin');
  const jobId = uuid(), period = '/cleaner/availability?periodStart=2026-11-09', jobLink = `/cleaner/jobs/${jobId}?role=backup&version=7&offerId=${uuid()}`;
  await test('local portal allowlist rejects open redirects, traversal, encoded separators, controls and auth/API paths', () => {
    for (const next of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/cleaner/../admin', '/cleaner/%2e%2e/admin', '/cleaner/%252f%252fevil.invalid', '/cleaner/jobs\\x', '/cleaner/jobs?x=%0d%0aLocation:evil', '/cleaner/jobs\n', '/cleaner-evil/jobs', '/api/cleaner/jobs', '/sign-in?next=/admin', '/auth/callback', '', '/cleaner/' + 'a'.repeat(2050)]) assert.equal(redirects.safePortalReturnPath(next), null, next);
    assert.equal(redirects.safePortalReturnPath([period]), null); assert.equal(redirects.safePortalReturnPath(period), period); assert.equal(redirects.safePortalReturnPath(jobLink), jobLink);
  });
  await test('callback destinations respect portal boundaries and use safe role defaults', () => {
    for (const [role, next, expected] of [['cleaner', jobLink, jobLink], ['cleaner', '/admin/dashboard', '/cleaner/jobs'], ['user', '/admin/job-oversight', '/customer/dashboard'], ['user', '/customer/job-oversight/' + jobId, '/customer/job-oversight/' + jobId], ['admin', '/cleaner/jobs', '/admin/dashboard'], ['super_admin', '/admin/job-oversight/' + jobId, '/admin/job-oversight/' + jobId], [undefined, jobLink, '/customer/dashboard']]) assert.equal(redirects.resolveAuthCallbackDestination(role, next), expected);
  });
  await test('middleware preserves cleaner availability, job version and admin/customer detail destinations and refreshed cookies', async () => {
    edgeClaims = null;
    for (const next of [period, jobLink, `/admin/job-oversight/${jobId}?view=review`, `/customer/job-oversight/${jobId}`, '/cleaner']) {
      const response = await updateSession(new NextRequest('https://return.example.invalid' + next));
      const target = location(response); assert.equal(target.pathname, '/sign-in'); assert.equal(target.searchParams.get('next'), next);
      assert.equal(response.cookies.get('synthetic_session').value, 'rotated'); assert.equal(response.cookies.get('synthetic_session').httpOnly, true);
      assert.equal(target.searchParams.has('periodStart'), false);
    }
  });
  await test('middleware uses trusted role, avoids wrong-portal loops and retains native CORS/bearer handling', async () => {
    edgeClaims = { sub: cleaner.supabaseUserId, app_metadata: { role: 'cleaner' }, user_metadata: { role: 'admin' } };
    assert.equal((await updateSession(new NextRequest('https://return.example.invalid' + period))).headers.get('location'), null);
    assert.equal(location(await updateSession(new NextRequest('https://return.example.invalid/admin/dashboard'))).pathname, '/cleaner/jobs');
    edgeClaims = { sub: customer.supabaseUserId, app_metadata: { role: 'user' }, user_metadata: { role: 'cleaner' } };
    assert.equal(location(await updateSession(new NextRequest('https://return.example.invalid' + jobLink))).pathname, '/customer/dashboard');
    const options = await updateSession(new NextRequest('https://return.example.invalid/api/cleaner/jobs', { method: 'OPTIONS', headers: { origin: 'https://localhost' } }));
    assert.equal(options.status, 204); assert.match(options.headers.get('access-control-allow-methods'), /PATCH/);
    edgeClaims = { sub: cleaner.supabaseUserId, app_metadata: { role: 'cleaner' } };
    const native = await updateSession(new NextRequest('https://return.example.invalid/api/cleaner/jobs', { headers: { authorization: 'Bearer synthetic.token.signature', origin: 'https://localhost' } }));
    assert.equal(edgeToken, 'synthetic.token.signature'); assert.equal(native.headers.get('access-control-allow-origin'), 'https://localhost');
  });
  await test('password action completes signed-out period/job round trips using DB role, never posted/user metadata role', async () => {
    authenticate(cleaner); edgeClaims = null;
    for (const next of [period, jobLink]) {
      const signIn = location(await updateSession(new NextRequest('https://return.example.invalid' + next)));
      const data = loginForm(signIn.searchParams.get('next')); data.set('role', 'admin');
      try { await actions.signInUser(undefined, data); assert.fail('Expected Next redirect'); } catch (error) { assert.ok(error instanceof Redirect); assert.equal(error.destination, next); }
    }
    authenticate(customer); assert.equal(await signInDestination('/admin/dashboard'), '/customer/dashboard');
    authenticate(admin); assert.equal(await signInDestination('/cleaner/jobs'), '/admin/dashboard');
    authenticate(superAdmin); assert.equal(await signInDestination(`/admin/job-oversight/${jobId}`), `/admin/job-oversight/${jobId}`);
    assert.ok(revalidated.every(path => !path.includes('?')));
  });
  await test('invalid password keeps the destination available for explicit retry; malformed/file next falls back', async () => {
    authenticate(cleaner); loginFails = true;
    const failed = await signInDestination(period); assert.equal(failed.success, false); assert.match(failed.error.message, /invalid password/);
    loginFails = false; assert.equal(await signInDestination(period), period);
    assert.equal(await signInDestination('https://evil.invalid'), '/cleaner/jobs');
    const data = loginForm(); data.set('next', new Blob(['synthetic']), 'next.txt');
    try { await actions.signInUser(undefined, data); assert.fail('Expected redirect'); } catch (error) { assert.equal(error.destination, '/cleaner/jobs'); }
  });
  await test('missing/unavailable DB profile cannot authorize metadata role or lose the form retry state', async () => {
    authUser = { id: uuid(), email: 'missing@example.invalid', user_metadata: { role: 'super_admin' } };
    assert.equal((await signInDestination('/admin/dashboard')).success, false);
    authenticate(cleaner); databaseAvailable = false; assert.equal((await signInDestination(period)).success, false); databaseAvailable = true;
    assert.equal(await signInDestination(period), period);
  });
  await test('code callbacks retain valid destinations and errors retain next without copying auth codes', async () => {
    authenticate(cleaner);
    const url = `https://return.example.invalid/auth/callback?code=synthetic-code&next=${encodeURIComponent(jobLink)}`;
    const completed = location(await callback.GET(new Request(url))); assert.equal(completed.pathname + completed.search, jobLink);
    verificationFails = true; const failed = location(await callback.GET(new Request(url))); verificationFails = false;
    assert.equal(failed.pathname, '/sign-in'); assert.equal(failed.searchParams.get('next'), jobLink); assert.equal(failed.searchParams.has('code'), false); assert.ok(failed.searchParams.get('error'));
    verificationThrows = true; const offline = location(await callback.GET(new Request(url))); verificationThrows = false; assert.equal(offline.searchParams.get('next'), jobLink);
    authenticate(customer); assert.equal(location(await callback.GET(new Request(url))).pathname, '/customer/dashboard');
    authenticate(cleaner); authUser = null; assert.equal(location(await callback.GET(new Request(url))).pathname, '/sign-in');
  });
  await test('OTP/PKCE confirmation checks current DB role and preserves availability return; recovery still reaches reset form', async () => {
    authenticate(cleaner);
    for (const auth of ['token_hash=synthetic-hash&type=magiclink', 'code=synthetic-code']) {
      const target = location(await confirm.GET(new Request(`https://return.example.invalid/auth/confirm?${auth}&next=${encodeURIComponent(period)}`)));
      assert.equal(target.pathname + target.search, period);
    }
    verificationFails = true;
    const failed = location(await confirm.GET(new Request(`https://return.example.invalid/auth/confirm?token_hash=synthetic&type=magiclink&next=${encodeURIComponent(period)}`))); verificationFails = false;
    assert.equal(failed.searchParams.get('next'), period); assert.equal(failed.searchParams.has('token_hash'), false);
    verificationThrows = true; const offline = location(await confirm.GET(new Request(`https://return.example.invalid/auth/confirm?token_hash=synthetic&type=magiclink&next=${encodeURIComponent(period)}`))); verificationThrows = false;
    assert.equal(offline.searchParams.get('next'), period);
    databaseAvailable = false;
    for (const auth of ['token_hash=synthetic&type=recovery', 'code=synthetic']) assert.equal(location(await confirm.GET(new Request(`https://return.example.invalid/auth/confirm?${auth}&next=/reset-password`))).pathname, '/reset-password');
    databaseAvailable = true; authenticate(admin);
    assert.equal(location(await confirm.GET(new Request(`https://return.example.invalid/auth/confirm?token_hash=synthetic&type=magiclink&next=${encodeURIComponent(period)}`))).pathname, '/admin/dashboard');
  });
  await test('actual sign-in page/form carries validated hidden next, including after action error, and drops duplicate next arrays', async () => {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const form = loadUi('app/(auth)/sign-in/credentials-signin-form.tsx', {
      react: { ...React, useActionState: () => [{ success: false, data: { email: 'fixture@example.invalid' }, error: { message: 'Synthetic invalid password' } }, () => {}, false] },
      'next/form': ({ action, children, ...props }) => React.createElement('form', props, children),
      'lucide-react': { LockIcon: () => null, MailIcon: () => null },
    }).default;
    const Page = loadUi('app/(auth)/sign-in/page.tsx', { './credentials-signin-form': form, 'next/font/local': () => ({ className: 'synthetic' }), 'next/link': ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) }).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ next: period }) }));
    assert.ok(html.includes('name="next"')); assert.ok(html.includes('periodStart=2026-11-09')); assert.ok(html.includes('Synthetic invalid password'));
    for (const next of ['//evil.invalid', [period, '/admin/dashboard']]) assert.ok(!renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ next }) })).includes('name="next"'));
  });
  await test('SMS appends validated absolute destination including period and role/version hints; removed/untrusted links stay safe', async () => {
    const [worker] = await db.insert(schema.cleaners).values({ id: uuid(), userId: cleaner.id, email: cleaner.email, fullName: 'Synthetic Cleaner', phone: '+12025550123', onboardingCompleted: true }).returning();
    for (const url of [period, jobLink]) {
      await notifyCleaner({ cleanerId: worker.id, type: 'assignment', title: 'Synthetic', message: 'Synthetic notice', jobId, url, sms: true });
      assert.ok(smsCalls.at(-1).message.endsWith('https://return.example.invalid' + url));
    }
    await notifyCleaner({ cleanerId: worker.id, type: 'assignment', title: 'Removed', message: 'You are off this job', jobId, url: '/cleaner/jobs', sms: true });
    assert.ok(smsCalls.at(-1).message.endsWith('/cleaner/jobs')); assert.ok(!smsCalls.at(-1).message.includes(jobId));
    await notifyCleaner({ cleanerId: worker.id, type: 'assignment', title: 'Synthetic', message: 'Synthetic', jobId, url: 'https://evil.invalid', sms: true });
    assert.ok(!smsCalls.at(-1).message.includes('evil.invalid'));
  });
  await test('assignment email links to the bound job; optional backup/version URL remains read-only navigation', async () => {
    const base = { to: 'fixture@example.invalid', propertyAddress: 'Synthetic property', jobDate: 'Synthetic date' };
    await email.sendCleanerAssignmentEmail({ ...base, jobId });
    assert.ok(JSON.stringify(emailCalls.at(-1)).includes('https://return.example.invalid/cleaner/jobs/' + jobId));
    await email.sendCleanerAssignmentEmail({ ...base, jobId, url: jobLink });
    const serialized = JSON.stringify(emailCalls.at(-1)); assert.ok(serialized.includes('version=7')); assert.ok(serialized.includes('role=backup'));
    await email.sendCleanerAssignmentEmail({ ...base, jobId, url: '/cleaner/jobs/' + uuid() }); assert.ok(!JSON.stringify(emailCalls.at(-1)).includes('/cleaner/jobs/' + jobId));
  });
  await test('assignment caller supplies exact job destination and still attempts email when cleaner channels fail', async () => {
    const worker = await db.query.cleaners.findFirst({ where: eq(schema.cleaners.userId, cleaner.id) });
    const [owner] = await db.insert(schema.customers).values({ id: uuid(), name: 'Synthetic owner', email: `${uuid()}@example.invalid` }).returning();
    const [property] = await db.insert(schema.properties).values({ id: uuid(), customerId: owner.id, address: 'Synthetic property', bedCount: 1, bathCount: '1', laundryType: 'none', entryInstructions: 'PRIVATE-ENTRY-CODE' }).returning();
    let notice;
    const engine = loadUi('lib/services/assignment/assignment-engine.service.ts', {
      '@/lib/services/notifications/notify': { notifyCleaner: async input => { notice = input; throw Error('Synthetic channel failure'); } },
    }, 'exports.fixtureNotify = notifyAssignedPrimary;');
    const count = emailCalls.length;
    await engine.fixtureNotify(jobId, worker.id, property.id, new Date('2030-11-10T15:00Z'), 'vacation_rental_subscription');
    assert.equal(notice.url, `/cleaner/jobs/${jobId}`); assert.equal(emailCalls.length, count + 1);
    assert.ok(JSON.stringify(emailCalls.at(-1)).includes(`/cleaner/jobs/${jobId}`)); assert.ok(!JSON.stringify(emailCalls.at(-1)).includes('PRIVATE-ENTRY-CODE'));
  });
  await test('GET job links recheck live assignment and cannot accept via query role/version/action hints', async () => {
    authenticate(cleaner);
    const worker = await db.query.cleaners.findFirst({ where: eq(schema.cleaners.userId, cleaner.id) });
    await db.insert(schema.jobs).values({ id: jobId, calendarEventUid: uuid(), status: 'assigned' });
    await db.insert(schema.jobsToCleaners).values({ jobId, cleanerId: worker.id, role: 'backup' });
    replace('lib/queries/cleaner-job-detail.ts', { getCleanerJobDetail: async () => ({ jobId, role: 'backup' }) });
    const route = require('../app/api/cleaner/jobs/[id]/route.ts'), params = { params: Promise.resolve({ id: jobId }) };
    assert.equal((await route.GET(new Request('https://return.example.invalid' + jobLink + '&action=accept'), params)).status, 200);
    assert.equal((await db.query.jobsToCleaners.findFirst({ where: eq(schema.jobsToCleaners.jobId, jobId) })).role, 'backup');
    await db.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId, jobId));
    assert.equal((await route.GET(new Request('https://return.example.invalid' + jobLink), params)).status, 403);
  });
  console.log(`${passed}/${passed} notification return checks passed; in-memory PostgreSQL, controlled Auth/providers, no hosted sends or sessions.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pg.close());
