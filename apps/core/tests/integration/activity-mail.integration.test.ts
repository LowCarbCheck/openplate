/**
 * The activity reminders against a real Postgres and the committed
 * migrations: the consent columns, the due SQL, the claim, the admin routes
 * and the unsubscribe link.
 *
 * WHAT ONLY THIS TIER CAN PROVE:
 *
 * 1. **The SQL agrees with the pure rules.** The sender throws when the SQL
 *    selects a row the rule refuses, but a row the SQL MISSES is silent. Each
 *    refusal below therefore has a control: the same account, one fact
 *    changed back, IS mailed.
 * 2. **The claim holds under concurrency.** Two runs at once send one letter.
 * 3. **The consent columns move the way the contract says**: on, off, on
 *    again, off again, and an unsubscribe keeps the consent instant.
 *
 * THE CLOCK IS PINNED to a noon, so a day boundary never falls inside a test,
 * and every step between an opt-out and an opt-in advances it: a tie reads as
 * withdrawn by design.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { accounts, aiUsageDays, instanceSettings } from '../../src/db/schema.js';
import { createDrizzleActivityMailStore } from '../../src/db/activity-mail-store.js';
import { runActivityMailOnce, type ActivityMailRunResult } from '../../src/activity-mail/sender.js';
import { signUnsubscribeToken } from '../../src/activity-mail/unsubscribe-token.js';
import { sqlstate } from '../../src/lib/storage-conflict.js';
import type { JsonObject } from '../../src/lib/json.js';
import { createSilentLogger } from '../../src/logger.js';
import { createCapturingLogger } from '../unit/admin-harness.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleSignupBody, startService, type ServiceHarness } from './service-harness.js';

const ADMIN_TOKEN = 'integration-admin-token-for-activity-mail-0123456789';
const CLOCK_START = Date.parse('2026-11-02T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CHECK_VIOLATION = '23514';
const LINKS = { clientBaseUrl: 'https://app.example.org', serverPublicUrl: 'https://api.example.org' };

interface AccountBody {
  account: { id: number; activityMail: boolean };
}

interface SessionBody extends AccountBody {
  tokens: { accessToken: string; refreshToken: string };
}

interface SettingsBody {
  settings: {
    nutrientReferenceBasis: string;
    activityMail: { firstScan: { enabled: boolean; days: number }; quiet: { enabled: boolean; days: number } };
  };
}

interface HealthBody {
  instance: { activityMail: boolean };
}

interface StatsBody {
  optedIn: number;
  firstScan: { sent: number; cameBack: number };
  quiet: { sent: number; cameBack: number };
}

let database: TestDatabase;
let service: ServiceHarness;

before(async () => {
  database = await setupTestDatabase();
  service = await startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    links: LINKS,
    mailConfigured: true,
    clockStartsAt: CLOCK_START,
  });
});

after(async () => {
  await service.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  // The process-local copy outlives the TRUNCATE, so it is put back too.
  await service.settings.set({
    activityMail: { firstScan: { enabled: false, days: 7 }, quiet: { enabled: false, days: 14 } },
  });
  service.mailer.activityReminders.length = 0;
  service.mailer.activityRemindersFail = false;
});

async function setActivityMail(body: JsonObject): Promise<{ status: number; body: SettingsBody }> {
  return service.request<SettingsBody>({
    method: 'PATCH',
    path: '/v1/admin/settings',
    adminToken: ADMIN_TOKEN,
    body: { activityMail: body },
  });
}

async function bothKindsOn(): Promise<void> {
  const response = await setActivityMail({ firstScan: { enabled: true }, quiet: { enabled: true } });
  assert.equal(response.status, 200);
}

/** Signs up through the real route, with whatever reminder fields the body names. */
async function signUp(input: { email: string; fields?: JsonObject; dailyAiLimit?: number }): Promise<SessionBody> {
  const inviteToken = await service.mintInvite({ email: input.email, dailyAiLimit: input.dailyAiLimit ?? 10 });
  const response = await service.request<SessionBody>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), ...input.fields },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  // `created_at` is the DATABASE clock (`defaultNow()`), and this suite runs
  // on a pinned harness clock, so the row is moved onto the harness clock the
  // sender reads. In production both clocks are the same wall clock.
  await database.db
    .update(accounts)
    .set({ createdAt: new Date(service.now()) })
    .where(eq(accounts.id, response.body.account.id));
  return response.body;
}

async function row(accountId: number) {
  const [found] = await database.db
    .select({
      optInAt: accounts.activityMailOptInAt,
      optOutAt: accounts.activityMailOptOutAt,
      language: accounts.mailLanguage,
      firstScanMailSentAt: accounts.firstScanMailSentAt,
      quietMailSentAt: accounts.quietMailSentAt,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (found === undefined) throw new Error(`account ${accountId} is gone`);
  return found;
}

function runSender(logger = createSilentLogger()): Promise<ActivityMailRunResult> {
  return runActivityMailOnce({
    store: createDrizzleActivityMailStore(database.db),
    mailer: service.mailer,
    settings: () => service.settings.activityMail(),
    unsubscribeKey: service.unsubscribeKey,
    defaultLanguage: 'en',
    instanceDefaultFreeAiLimit: { limit: 0, period: 'day' },
    isAiAvailable: true,
    logger,
    now: () => new Date(service.now()),
  });
}

function sentTo(email: string): number {
  return service.mailer.activityReminders.filter((mail) => mail.email === email).length;
}

// ── sign-up and the settings switch ──────────────────────────────────────

test('the handshake offers the box only once an administrator turned a kind on', async () => {
  const offered = await service.request<HealthBody>({ method: 'GET', path: '/health' });
  assert.equal(offered.body.instance.activityMail, false);
  await setActivityMail({ quiet: { enabled: true } });
  const afterOn = await service.request<HealthBody>({ method: 'GET', path: '/health' });
  assert.equal(afterOn.body.instance.activityMail, true);
});

test('sign-up with the box ticked records consent and the language; without it, nothing', async () => {
  await bothKindsOn();
  const ticked = await signUp({ email: 'ticked@example.org', fields: { activityMail: true, language: 'it' } });
  assert.equal(ticked.account.activityMail, true);
  const tickedRow = await row(ticked.account.id);
  assert.equal(tickedRow.optInAt?.getTime(), service.now());
  assert.equal(tickedRow.optOutAt, null);
  assert.equal(tickedRow.language, 'it');

  // The control: the same door, the box left unticked.
  const plain = await signUp({ email: 'plain@example.org', fields: { activityMail: false } });
  assert.equal(plain.account.activityMail, false);
  assert.deepEqual(await row(plain.account.id), {
    optInAt: null,
    optOutAt: null,
    language: null,
    firstScanMailSentAt: null,
    quietMailSentAt: null,
  });
});

test('a ticked box on an instance that offers nothing records nothing', async () => {
  const session = await signUp({ email: 'early@example.org', fields: { activityMail: true } });
  assert.equal(session.account.activityMail, false);
  assert.equal((await row(session.account.id)).optInAt, null);
});

test('a non-boolean box is a 400 and spends no invite', async () => {
  await bothKindsOn();
  const inviteToken = await service.mintInvite({ email: 'typo@example.org' });
  const refused = await service.request<{ error: string }>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), activityMail: 'yes' },
  });
  assert.equal(refused.status, 400);
  const created = await service.request<SessionBody>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: { ...sampleSignupBody({ inviteToken }), activityMail: true },
  });
  assert.equal(created.status, 201, 'the control: the same invite still redeems');
});

test('PATCH on, off, on again, off again moves the two instants and never clears the first', async () => {
  await bothKindsOn();
  const session = await signUp({ email: 'switch@example.org' });
  const patch = (body: JsonObject) =>
    service.request<AccountBody>({
      method: 'PATCH',
      path: '/v1/auth/account',
      accessToken: session.tokens.accessToken,
      body,
    });

  const onAt = service.now();
  assert.equal((await patch({ activityMail: true, language: 'es' })).body.account.activityMail, true);
  assert.equal((await row(session.account.id)).optInAt?.getTime(), onAt);

  service.advance(MINUTE_MS);
  const offAt = service.now();
  assert.equal((await patch({ activityMail: false })).body.account.activityMail, false);
  const off = await row(session.account.id);
  assert.equal(off.optInAt?.getTime(), onAt, 'withdrawing keeps the consent instant');
  assert.equal(off.optOutAt?.getTime(), offAt);

  service.advance(MINUTE_MS);
  const againAt = service.now();
  assert.equal((await patch({ activityMail: true })).body.account.activityMail, true);
  const again = await row(session.account.id);
  assert.equal(again.optInAt?.getTime(), againAt, 'a fresh consent gets a fresh instant');
  assert.equal(again.optOutAt?.getTime(), offAt, 'turning on never touches the withdrawal');
  assert.equal(again.language, 'es');

  // A repeat while active keeps the instant.
  service.advance(MINUTE_MS);
  await patch({ activityMail: true });
  assert.equal((await row(session.account.id)).optInAt?.getTime(), againAt);

  service.advance(MINUTE_MS);
  const offAgainAt = service.now();
  assert.equal((await patch({ activityMail: false })).body.account.activityMail, false);
  const offAgain = await row(session.account.id);
  assert.equal(offAgain.optInAt?.getTime(), againAt);
  assert.equal(offAgain.optOutAt?.getTime(), offAgainAt);

  // And the account view reads the same answer back.
  const view = await service.request<AccountBody>({
    method: 'GET',
    path: '/v1/auth/account',
    accessToken: session.tokens.accessToken,
  });
  assert.equal(view.body.account.activityMail, false);
});

// ── the sender ───────────────────────────────────────────────────────────

test('first-scan goes once across two runs, at the configured days and not before', async () => {
  await bothKindsOn();
  const session = await signUp({ email: 'new@example.org', fields: { activityMail: true } });

  service.advance(6 * DAY_MS);
  assert.equal((await runSender()).firstScan.sent, 0, 'six days is too early');

  service.advance(DAY_MS);
  const first = await runSender();
  assert.equal(first.firstScan.sent, 1);
  assert.equal(sentTo('new@example.org'), 1);
  const mail = service.mailer.activityReminders[0];
  assert.equal(mail?.kind, 'first-scan');
  assert.equal(mail?.days, 7);
  assert.equal(mail?.isTest, false);
  assert.equal((await row(session.account.id)).firstScanMailSentAt?.getTime(), service.now());

  service.advance(60 * MINUTE_MS);
  assert.equal((await runSender()).firstScan.sent, 0, 'the second run finds the stamp');
  assert.equal(sentTo('new@example.org'), 1);
});

test('two runs at once send one letter, because each account is claimed before the send', async () => {
  await bothKindsOn();
  await signUp({ email: 'race@example.org', fields: { activityMail: true } });
  service.advance(8 * DAY_MS);
  const [one, two] = await Promise.all([runSender(), runSender()]);
  assert.equal(one.firstScan.sent + two.firstScan.sent, 1);
  assert.equal(sentTo('race@example.org'), 1);
});

test('a failed send is logged with the account id, keeps its claim and is not retried', async () => {
  await bothKindsOn();
  const session = await signUp({ email: 'bounce@example.org', fields: { activityMail: true } });
  service.advance(8 * DAY_MS);
  service.mailer.activityRemindersFail = true;
  const captured = createCapturingLogger();
  const failed = await runSender(captured.logger);
  assert.deepEqual(failed.firstScan, { claimed: 1, sent: 0, failed: 1 });
  const warning = captured.lines.find((line) => line.level === 'warn');
  assert.equal(warning?.fields?.accountId, session.account.id);
  assert.ok(!JSON.stringify(captured.lines).includes('bounce@example.org'), 'the address is never logged');
  assert.notEqual((await row(session.account.id)).firstScanMailSentAt, null);

  service.mailer.activityRemindersFail = false;
  service.advance(60 * MINUTE_MS);
  assert.deepEqual((await runSender()).firstScan, { claimed: 0, sent: 0, failed: 0 });
  assert.equal(sentTo('bounce@example.org'), 1, 'asked for once, the failed one');
});

test('the first-scan SQL skips each account the rule refuses, and each control is mailed', async () => {
  await bothKindsOn();
  const used = await signUp({ email: 'used@example.org', fields: { activityMail: true } });
  const noAi = await signUp({ email: 'noai@example.org', fields: { activityMail: true }, dailyAiLimit: 0 });
  const suspended = await signUp({ email: 'suspended@example.org', fields: { activityMail: true } });
  const unticked = await signUp({ email: 'unticked@example.org' });
  const control = await signUp({ email: 'control@example.org', fields: { activityMail: true } });
  await database.db.insert(aiUsageDays).values({ accountId: used.account.id, day: '2026-11-02', count: 1 });
  await database.db
    .update(accounts)
    .set({ suspendedAt: new Date(service.now()) })
    .where(eq(accounts.id, suspended.account.id));

  service.advance(8 * DAY_MS);
  await runSender();
  assert.equal(sentTo('control@example.org'), 1, 'the control is mailed');
  for (const email of ['used@example.org', 'noai@example.org', 'suspended@example.org', 'unticked@example.org']) {
    assert.equal(sentTo(email), 0, `${email} must not be mailed`);
  }
  assert.ok([used, noAi, suspended, unticked].every((s) => s.account.id !== control.account.id));
});

test('a quiet mail ever sent keeps the account out of the first-scan select and the claim', async () => {
  await bothKindsOn();
  const quieted = await signUp({ email: 'quieted@example.org', fields: { activityMail: true } });
  const twin = await signUp({ email: 'twin@example.org', fields: { activityMail: true } });
  await database.db
    .update(accounts)
    .set({ quietMailSentAt: new Date(service.now()) })
    .where(eq(accounts.id, quieted.account.id));

  service.advance(8 * DAY_MS);
  const store = createDrizzleActivityMailStore(database.db);
  const query = { now: new Date(service.now()), days: 7, instanceDefaultFreeAiLimit: { limit: 0, period: 'day' } as const };

  const due = await store.findDueFirstScan({ ...query, limit: 10 });
  assert.deepEqual(
    due.map((candidate) => candidate.accountId),
    [twin.account.id],
    'only the twin without a quiet mail is selected',
  );
  assert.equal(due[0]?.quietMailSentAt, null, 'the selected row carries the fact the sender re-checks');
  assert.equal(await store.claimFirstScan({ ...query, accountId: quieted.account.id }), 'taken');
  assert.equal((await row(quieted.account.id)).firstScanMailSentAt, null, 'a refused claim stamps nothing');
  // The control: the same claim for the twin succeeds.
  assert.equal(await store.claimFirstScan({ ...query, accountId: twin.account.id }), 'claimed');
});

test('first-scan closes after its window: an account fourteen days old is never mailed', async () => {
  await bothKindsOn();
  await signUp({ email: 'late@example.org', fields: { activityMail: true } });
  service.advance(14 * DAY_MS);
  assert.equal((await runSender()).firstScan.sent, 0);
  assert.equal(
    service.mailer.activityReminders.filter((mail) => mail.kind === 'first-scan').length,
    0,
    'only the quiet kind may reach a fourteen day old account',
  );
  // The control lives in the test above: seven to thirteen days IS mailed.
});

test('quiet goes once per spell, never close behind a first-scan, and again after a return', async () => {
  await setActivityMail({ quiet: { enabled: true } });
  const session = await signUp({ email: 'quiet@example.org', fields: { activityMail: true } });

  service.advance(15 * DAY_MS);
  assert.equal((await runSender()).quiet.sent, 1);
  service.advance(60 * MINUTE_MS);
  assert.equal((await runSender()).quiet.sent, 0, 'once per spell');

  // The person comes back: a refresh is a door that writes last_seen_at.
  service.advance(DAY_MS);
  const refreshed = await service.request<SessionBody>({
    method: 'POST',
    path: '/v1/auth/refresh',
    body: { refreshToken: session.tokens.refreshToken },
  });
  assert.equal(refreshed.status, 200);
  service.advance(15 * DAY_MS);
  assert.equal((await runSender()).quiet.sent, 1, 'a new spell, a new letter');
  assert.equal(sentTo('quiet@example.org'), 2);
});

test('a first-scan mail inside the quiet days blocks the quiet one', async () => {
  await bothKindsOn();
  await signUp({ email: 'both@example.org', fields: { activityMail: true } });
  service.advance(13 * DAY_MS);
  assert.equal((await runSender()).firstScan.sent, 1);
  service.advance(2 * DAY_MS);
  // Fifteen days quiet, but the first-scan letter is two days old.
  assert.equal((await runSender()).quiet.sent, 0);
  assert.equal(sentTo('both@example.org'), 1);
});

test('a withdrawn consent stops the sender', async () => {
  await bothKindsOn();
  const session = await signUp({ email: 'gone@example.org', fields: { activityMail: true } });
  service.advance(MINUTE_MS);
  await service.request({
    method: 'PATCH',
    path: '/v1/auth/account',
    accessToken: session.tokens.accessToken,
    body: { activityMail: false },
  });
  service.advance(8 * DAY_MS);
  await runSender();
  assert.equal(sentTo('gone@example.org'), 0);
});

// ── the admin routes ─────────────────────────────────────────────────────

test('admin settings round trip, partial patches, and the bounds', async () => {
  const initial = await service.request<SettingsBody>({
    method: 'GET',
    path: '/v1/admin/settings',
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.settings.activityMail, {
    firstScan: { enabled: false, days: 7 },
    quiet: { enabled: false, days: 14 },
  });

  const patched = await setActivityMail({ firstScan: { days: 10 } });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.settings.activityMail, {
    firstScan: { enabled: false, days: 10 },
    quiet: { enabled: false, days: 14 },
  });
  const both = await service.request<SettingsBody>({
    method: 'PATCH',
    path: '/v1/admin/settings',
    adminToken: ADMIN_TOKEN,
    body: { nutrientReferenceBasis: 'efsa', activityMail: { quiet: { enabled: true, days: 30 } } },
  });
  assert.equal(both.status, 200);
  assert.equal(both.body.settings.nutrientReferenceBasis, 'efsa');

  const [stored] = await database.db.select().from(instanceSettings);
  assert.equal(stored?.activityMailFirstScanDays, 10);
  assert.equal(stored?.activityMailQuietEnabled, true);
  assert.equal(stored?.activityMailQuietDays, 30);

  const tooLow = await service.request<{ error: string }>({
    method: 'PATCH',
    path: '/v1/admin/settings',
    adminToken: ADMIN_TOKEN,
    body: { activityMail: { quiet: { days: 6 } } },
  });
  assert.equal(tooLow.status, 400);
  assert.match(tooLow.body.error, /7 to 60/);
  const tooHigh = await setActivityMail({ firstScan: { days: 31 } });
  assert.equal(tooHigh.status, 400);
  const [unchanged] = await database.db.select().from(instanceSettings);
  assert.equal(unchanged?.activityMailQuietDays, 30, 'a refused patch writes nothing');
  assert.equal(unchanged?.activityMailFirstScanDays, 10);
});

test('the check constraints refuse out-of-range days that bypass the route', async () => {
  await setActivityMail({ quiet: { enabled: true } });
  await assert.rejects(
    database.db.update(instanceSettings).set({ activityMailFirstScanDays: 2 }),
    (error: Error) => sqlstate(error) === CHECK_VIOLATION,
  );
  await assert.rejects(
    database.db.update(instanceSettings).set({ activityMailQuietDays: 61 }),
    (error: Error) => sqlstate(error) === CHECK_VIOLATION,
  );
  // The control: an in-range write passes.
  await database.db.update(instanceSettings).set({ activityMailQuietDays: 60 });
});

test('stats count the opted in, the sent and the people who came back', async () => {
  await bothKindsOn();
  const back = await signUp({ email: 'back@example.org', fields: { activityMail: true } });
  await signUp({ email: 'away@example.org', fields: { activityMail: true } });
  await signUp({ email: 'never@example.org' });
  service.advance(8 * DAY_MS);
  await runSender();
  service.advance(DAY_MS);
  await service.request({ method: 'POST', path: '/v1/auth/refresh', body: { refreshToken: back.tokens.refreshToken } });

  const stats = await service.request<StatsBody>({
    method: 'GET',
    path: '/v1/admin/activity-mail/stats',
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.body, {
    optedIn: 2,
    firstScan: { sent: 2, cameBack: 1 },
    quiet: { sent: 0, cameBack: 0 },
  });
});

test('a test send goes to the calling administrator, stamps nothing, and stops at five an hour', async () => {
  await bothKindsOn();
  const admin = await service.signupThroughInvite({ email: 'admin@example.org', role: 'admin' });
  let accessToken = admin.tokens.accessToken;
  const send = (kind: string) =>
    service.request<{ kind?: string; error?: string }>({
      method: 'POST',
      path: '/v1/admin/activity-mail/test',
      accessToken,
      body: { kind },
    });

  const untouched = await row(admin.account.id);
  const first = await send('quiet');
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.deepEqual(first.body, { kind: 'quiet' });
  const mail = service.mailer.activityReminders[0];
  assert.equal(mail?.email, 'admin@example.org');
  assert.equal(mail?.isTest, true);
  // Nothing on the row moves: no send stamp, no consent, no language.
  assert.deepEqual(await row(admin.account.id), untouched);
  assert.equal(untouched.quietMailSentAt, null);

  assert.equal((await send('weekly')).status, 400);
  for (let sent = 2; sent <= 5; sent += 1) assert.equal((await send('first-scan')).status, 202, `send ${sent}`);
  const sixth = await send('first-scan');
  assert.equal(sixth.status, 429);
  assert.ok(sixth.headers.get('retry-after'));
  assert.equal(service.mailer.activityReminders.length, 5);

  // The window slides: an hour on, it opens again. The access token has
  // expired by then, so the session is refreshed first.
  service.advance(61 * MINUTE_MS);
  const refreshed = await service.request<SessionBody>({
    method: 'POST',
    path: '/v1/auth/refresh',
    body: { refreshToken: admin.tokens.refreshToken },
  });
  assert.equal(refreshed.status, 200);
  accessToken = refreshed.body.tokens.accessToken;
  assert.equal((await send('quiet')).status, 202);

  const staticToken = await service.request<{ error: string }>({
    method: 'POST',
    path: '/v1/admin/activity-mail/test',
    adminToken: ADMIN_TOKEN,
    body: { kind: 'quiet' },
  });
  assert.equal(staticToken.status, 400, 'the operator token has no address to send to');
});

// ── unsubscribe ──────────────────────────────────────────────────────────

function unsubscribePath(token: string): string {
  return `/v1/mail/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function optedIn(email: string): Promise<{ accountId: number; token: string }> {
  await bothKindsOn();
  const session = await signUp({ email, fields: { activityMail: true } });
  service.advance(MINUTE_MS);
  return {
    accountId: session.account.id,
    token: signUnsubscribeToken({ key: service.unsubscribeKey, accountId: session.account.id }),
  };
}

test('GET shows a page and changes nothing; POST turns reminders off and keeps the consent instant', async () => {
  const { accountId, token } = await optedIn('link@example.org');
  const rowBefore = await row(accountId);

  const page = await fetch(`${service.baseUrl}${unsubscribePath(token)}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /<form method="post"/);
  assert.deepEqual(await row(accountId), rowBefore, 'a GET writes nothing');

  const posted = await fetch(`${service.baseUrl}${unsubscribePath(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(posted.status, 200);
  const rowAfter = await row(accountId);
  assert.equal(rowAfter.optInAt?.getTime(), rowBefore.optInAt?.getTime(), 'the consent instant is kept');
  assert.equal(rowAfter.optOutAt?.getTime(), service.now());
});

test('the one-click POST of RFC 8058 turns reminders off', async () => {
  const { accountId, token } = await optedIn('oneclick@example.org');
  const posted = await fetch(`${service.baseUrl}${unsubscribePath(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(posted.status, 200);
  assert.notEqual((await row(accountId)).optOutAt, null);
});

test('a bad token, an altered one, or one for a deleted account answers one 400 page on both verbs', async () => {
  const { accountId, token } = await optedIn('bad@example.org');
  const otherKey = signUnsubscribeToken({ key: 'not-the-key', accountId });
  const altered = `${token.slice(0, -2)}AA`;
  const pages: string[] = [];
  for (const bad of ['', 'nonsense', otherKey, altered]) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${service.baseUrl}${unsubscribePath(bad)}`, { method });
      assert.equal(response.status, 400, `${method} ${bad}`);
      pages.push(await response.text());
    }
  }
  assert.equal(new Set(pages).size, 1, 'one page for every bad link');
  assert.equal((await row(accountId)).optOutAt, null, 'nothing was turned off');

  await database.db.delete(accounts).where(eq(accounts.id, accountId));
  const gone = await fetch(`${service.baseUrl}${unsubscribePath(token)}`, { method: 'POST' });
  assert.equal(gone.status, 400);
  assert.equal(await gone.text(), pages[0]);
});
