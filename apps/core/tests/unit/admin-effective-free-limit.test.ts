/**
 * The admin account view carries the free limit the PROXY enforces
 * (2026-10-12), beside the row's own value.
 *
 * THE BUG THIS PINS. A new account holds `free_daily_ai_limit = 0`, because the
 * instance default is never written to the row. The admin view sent only that
 * column, so the console read "0" and printed "no photos" for a person whom
 * `DEFAULT_FREE_WEEKLY_AI_LIMIT=10` lets read ten a week. The view now adds
 * `effectiveFreeAiLimit` and `effectiveFreeAiLimitPeriod`, resolved by the
 * proxy's own function over the same `standing`.
 *
 * EVERY ASSERTION IS ON A BODY THAT CAME BACK OVER A SOCKET, from the REAL
 * app. Each case that expects a resolved default has a control beside it that
 * would fail if the route echoed the own column or ignored the default: the
 * own-limit account must keep its own number and its day window under the very
 * same weekly default, and an instance with no default must resolve to zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asArray, asNumber, asObject, asString, type JsonObject, type JsonValue } from '../../src/lib/json.js';
import { NO_INSTANCE_STANDING, type InstanceStanding } from '../../src/accounts/instance-standing.js';
import { startAdminHarness, type AdminHarness } from './admin-harness.js';

const ADMIN_TOKEN = 'admin-token-for-the-effective-limit-suite-0123456789';

const WEEKLY_TEN: InstanceStanding = {
  ...NO_INSTANCE_STANDING,
  defaultFreeAiLimit: { limit: 10, period: 'week' },
};

const DAILY_THREE: InstanceStanding = {
  ...NO_INSTANCE_STANDING,
  defaultFreeAiLimit: { limit: 3, period: 'day' },
};

/** The parsed body of an admin response. */
async function jsonBody(answered: Response): Promise<JsonValue> {
  // SAFETY: every admin endpoint answers `application/json` by contract, and a
  // body that did not parse throws inside `json()` rather than reaching this
  // line. `JsonValue` is the boundary type `lib/json.ts` decodes, and every
  // reader below goes through `asObject` / `asNumber` / `asString`.
  return (await answered.json()) as JsonValue;
}

/** Runs one case over its own app, so the standing under test is the only difference between cases. */
async function withInstance(
  standing: InstanceStanding | undefined,
  run: (harness: AdminHarness) => Promise<void>,
): Promise<void> {
  const harness = await startAdminHarness({ adminToken: ADMIN_TOKEN, standing });
  try {
    await run(harness);
  } finally {
    await harness.close();
  }
}

/** Seeds an account in BOTH stores, with the OWN free limit the row holds. */
async function seedAccount(input: {
  harness: AdminHarness;
  email: string;
  ownFreeLimit: number;
  aiUsedThisWeek?: number;
}): Promise<number> {
  const { harness } = input;
  const account = await harness.fakeAccounts.seedAccount({ email: input.email, role: 'member', dailyAiLimit: 0 });
  await harness.fakeAccounts.updateStanding({
    accountId: account.id,
    dailyAiLimit: 0,
    freeDailyAiLimit: input.ownFreeLimit,
  });
  harness.admin.seed({
    id: account.id,
    email: input.email,
    freeDailyAiLimit: input.ownFreeLimit,
    aiUsedThisWeek: input.aiUsedThisWeek,
  });
  return account.id;
}

async function readAccount(input: { harness: AdminHarness; id: number }): Promise<JsonObject> {
  const response = await input.harness.request({
    method: 'GET',
    path: `/v1/admin/accounts/${input.id}`,
    token: ADMIN_TOKEN,
  });
  assert.equal(response.status, 200);
  const account = asObject(asObject(await jsonBody(response))?.account);
  assert.ok(account !== null, 'the body wraps the account view');
  return account;
}

test('a new account on a weekly-default instance reads the default, and its own column stays 0', async () => {
  await withInstance(WEEKLY_TEN, async (harness) => {
    const id = await seedAccount({ harness, email: 'new@example.org', ownFreeLimit: 0 });

    const account = await readAccount({ harness, id });

    assert.equal(asNumber(account.effectiveFreeAiLimit), 10);
    assert.equal(asString(account.effectiveFreeAiLimitPeriod), 'week');
    // The operator edits the own column, so it must not be overwritten by the default.
    assert.equal(asNumber(account.freeDailyAiLimit), 0);
    assert.equal(asString(account.freeAiLimitPeriod), 'day');
  });
});

test('an account with its own free limit keeps it, per day, under the same weekly default', async () => {
  await withInstance(WEEKLY_TEN, async (harness) => {
    const id = await seedAccount({ harness, email: 'supporter@example.org', ownFreeLimit: 5 });

    const account = await readAccount({ harness, id });

    // The control for the case above: a route that applied the default to
    // everybody would answer 10 and "week" here.
    assert.equal(asNumber(account.effectiveFreeAiLimit), 5);
    assert.equal(asString(account.effectiveFreeAiLimitPeriod), 'day');
    assert.equal(asNumber(account.freeDailyAiLimit), 5);
  });
});

test('a daily default resolves per day', async () => {
  await withInstance(DAILY_THREE, async (harness) => {
    const id = await seedAccount({ harness, email: 'daily@example.org', ownFreeLimit: 0 });

    const account = await readAccount({ harness, id });

    assert.equal(asNumber(account.effectiveFreeAiLimit), 3);
    assert.equal(asString(account.effectiveFreeAiLimitPeriod), 'day');
  });
});

test('an instance with no default resolves an own-less account to zero, per day', async () => {
  await withInstance(undefined, async (harness) => {
    const id = await seedAccount({ harness, email: 'none@example.org', ownFreeLimit: 0 });

    const account = await readAccount({ harness, id });

    // The control that the weekly figure above comes from the default and not
    // from a constant: with no standing the same row resolves to nothing.
    assert.equal(asNumber(account.effectiveFreeAiLimit), 0);
    assert.equal(asString(account.effectiveFreeAiLimitPeriod), 'day');
  });
});

test('the list and the PATCH answer carry the same resolved figures as the single read', async () => {
  await withInstance(WEEKLY_TEN, async (harness) => {
    const fresh = await seedAccount({ harness, email: 'fresh@example.org', ownFreeLimit: 0 });
    const granted = await seedAccount({ harness, email: 'granted@example.org', ownFreeLimit: 7 });

    const list = await harness.request({ method: 'GET', path: '/v1/admin/accounts', token: ADMIN_TOKEN });
    assert.equal(list.status, 200);
    const rows = (asArray(asObject(await jsonBody(list))?.accounts) ?? []).map((row) => asObject(row));
    const byId = new Map(rows.map((row) => [asNumber(row?.id), row]));
    assert.equal(asNumber(byId.get(fresh)?.effectiveFreeAiLimit), 10);
    assert.equal(asString(byId.get(fresh)?.effectiveFreeAiLimitPeriod), 'week');
    assert.equal(asNumber(byId.get(granted)?.effectiveFreeAiLimit), 7);
    assert.equal(asString(byId.get(granted)?.effectiveFreeAiLimitPeriod), 'day');

    const patched = await harness.request({
      method: 'PATCH',
      path: `/v1/admin/accounts/${fresh}`,
      token: ADMIN_TOKEN,
      body: { displayName: 'Fresh' },
    });
    assert.equal(patched.status, 200);
    const view = asObject(asObject(await jsonBody(patched))?.account);
    assert.equal(asNumber(view?.effectiveFreeAiLimit), 10);
    assert.equal(asString(view?.effectiveFreeAiLimitPeriod), 'week');
  });
});
