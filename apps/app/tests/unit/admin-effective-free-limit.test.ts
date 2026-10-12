/**
 * The admin screens read the free limit the PROXY enforces, not the row's own
 * column (2026-10-12).
 *
 * THE BUG. A new account holds `free_daily_ai_limit = 0`, because the instance
 * default (`DEFAULT_FREE_WEEKLY_AI_LIMIT=10` in production) is never written to
 * the row. The core sent only that column, so "Heute genutzt" printed
 * `admin.usageNone` for a person who may read ten photos a week. The core now
 * adds `effectiveFreeAiLimit` and `effectiveFreeAiLimitPeriod`
 * (`apps/core/PROTOCOL.md` §5.20), and the list row, the bar, the sort and the
 * detail page all read them through `admin-usage.ts`.
 *
 * THE LINES ARE ASSERTED AS KEY PLUS PARAMETERS through an echoing translator,
 * so no German or English wording is pinned (wordsmith owns it) and an
 * assertion cannot match unrelated text. Each case that expects the resolved
 * limit has a control beside it: the same person with the fields removed, which
 * is what the old core sent and what the old code read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { adminUsage, adminUsageFigures } from '../../app/lib/admin/admin-usage';
import { accountViewSchema, type AdminAccountView } from '../../app/lib/admin/admin-wire';
import { sortPeople } from '../../app/lib/admin/people-filter';

const NOW = new Date('2026-10-12T12:00:00.000Z');

/** A translator that answers the key and its parameters, so a case reads which sentence was chosen. */
function echoKey(name: string, params?: Readonly<Record<string, string | number>>): string {
  return params === undefined ? name : `${name} ${JSON.stringify(params)}`;
}

/** A new account on an instance with a weekly default: no limit of its own, nothing paid. */
const NEW_ACCOUNT = {
  dailyAiLimit: 0,
  freeDailyAiLimit: 0,
  allowanceExpiresAt: null,
  aiUsedToday: 1,
  aiUsedThisWeek: 4,
} as const;

const WEEKLY_TEN = { effectiveFreeAiLimit: 10, effectiveFreeAiLimitPeriod: 'week' } as const;

describe('the usage line', () => {
  it('names the weekly default and the week’s count for a new account', () => {
    const line = adminUsage({ person: { ...NEW_ACCOUNT, ...WEEKLY_TEN }, t: echoKey, now: NOW });
    // The week's 4, never today's 1 against a week's limit.
    assert.equal(line, 'admin.usageWeek {"used":4,"limit":10}');
  });

  it('is "no photos" for the same account when the core sent no effective fields', () => {
    // THE CONTROL, and the reading of an older core: the own column is 0.
    assert.equal(adminUsage({ person: NEW_ACCOUNT, t: echoKey, now: NOW }), 'admin.usageNone');
  });

  it('is "no photos" when the instance has no default either', () => {
    const person = { ...NEW_ACCOUNT, effectiveFreeAiLimit: 0, effectiveFreeAiLimitPeriod: 'day' } as const;
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'admin.usageNone');
  });

  it('keeps the row’s own limit, per day, under the same weekly default', () => {
    // The core resolves an own limit to itself, per day, whatever the default is.
    const person = {
      ...NEW_ACCOUNT,
      freeDailyAiLimit: 5,
      aiUsedToday: 2,
      aiUsedThisWeek: 9,
      effectiveFreeAiLimit: 5,
      effectiveFreeAiLimitPeriod: 'day',
    } as const;
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'admin.usage {"used":2,"limit":5}');
  });

  it('reads an old core’s own limit per day, as before', () => {
    const person = { ...NEW_ACCOUNT, freeDailyAiLimit: 10, aiUsedToday: 3 };
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'admin.usage {"used":3,"limit":10}');
  });

  it('names the weekly limit alone when the core sent no week count', () => {
    const person = { dailyAiLimit: 0, freeDailyAiLimit: 0, allowanceExpiresAt: null, aiUsedToday: 1, ...WEEKLY_TEN };
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'account.allowance.limitWeek {"count":10}');
  });

  it('reads a missing window beside an effective limit as a day', () => {
    // A malformed period decodes to `undefined` on the wire (see below).
    const person = { ...NEW_ACCOUNT, effectiveFreeAiLimit: 10 };
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'admin.usage {"used":1,"limit":10}');
  });

  it('leaves a live paid window in charge', () => {
    const paid = {
      ...NEW_ACCOUNT,
      dailyAiLimit: 40,
      allowanceExpiresAt: '2026-12-01T00:00:00.000Z',
      ...WEEKLY_TEN,
    };
    assert.equal(adminUsage({ person: paid, t: echoKey, now: NOW }), 'admin.usage {"used":1,"limit":40}');
  });
});

describe('the figures behind the bar and the sort', () => {
  it('give the week’s count against the weekly default', () => {
    assert.deepEqual(adminUsageFigures({ person: { ...NEW_ACCOUNT, ...WEEKLY_TEN }, now: NOW }), {
      used: 4,
      limit: 10,
    });
  });

  it('give nothing for the same account when the core sent no effective fields', () => {
    // THE CONTROL: no limit, so no bar.
    assert.equal(adminUsageFigures({ person: NEW_ACCOUNT, now: NOW }), null);
  });

  it('give today’s count against an own limit, whatever the week holds', () => {
    const person = {
      ...NEW_ACCOUNT,
      freeDailyAiLimit: 5,
      aiUsedToday: 2,
      aiUsedThisWeek: 9,
      effectiveFreeAiLimit: 5,
      effectiveFreeAiLimitPeriod: 'day',
    } as const;
    assert.deepEqual(adminUsageFigures({ person, now: NOW }), { used: 2, limit: 5 });
  });
});

/** A complete admin view, so the sort runs on the real shape. */
function viewOf(overrides: Partial<AdminAccountView> & { id: number; email: string }): AdminAccountView {
  return {
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 0,
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: null,
    label: null,
    ...overrides,
  };
}

describe('the usage sort', () => {
  it('ranks a new account by its share of the weekly default', () => {
    const heavy = viewOf({ id: 1, email: 'heavy@example.org', aiUsedThisWeek: 8, ...WEEKLY_TEN });
    const light = viewOf({ id: 2, email: 'light@example.org', dailyAiLimit: 200, aiUsedToday: 20 });
    const idle = viewOf({ id: 3, email: 'idle@example.org' });

    // 0.8 of ten a week, then 0.1 of 200 a day, then no allowance at all. Read
    // off the own column, `heavy` has no allowance and files last.
    const sorted = sortPeople({ people: [idle, light, heavy], sort: 'usage', now: NOW });
    assert.deepEqual(
      sorted.map((row) => row.id),
      [1, 2, 3],
    );
  });
});

describe('the wire', () => {
  /** A view as the core sends it, written out by hand and not built from the schema. */
  const BODY = {
    id: 7,
    email: 'new@example.org',
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiLimitPeriod: 'day',
    aiUsedToday: 0,
    aiUsedThisWeek: 0,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 0,
    freeAiLimitPeriod: 'day',
    effectiveFreeAiLimit: 10,
    effectiveFreeAiLimitPeriod: 'week',
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    createdAt: '2026-10-12T08:00:00.000Z',
    lastSeenAt: null,
    label: null,
  };

  it('carries the effective pair next to the own column', () => {
    const view = accountViewSchema.parse(BODY);
    assert.equal(view.effectiveFreeAiLimit, 10);
    assert.equal(view.effectiveFreeAiLimitPeriod, 'week');
    assert.equal(view.freeDailyAiLimit, 0);
  });

  it('leaves both undefined for a core older than the fields, not 0', () => {
    const { effectiveFreeAiLimit, effectiveFreeAiLimitPeriod, ...older } = BODY;
    // Named only to be dropped: the old core sends neither key.
    assert.equal(effectiveFreeAiLimit, 10);
    assert.equal(effectiveFreeAiLimitPeriod, 'week');
    const view = accountViewSchema.parse(older);
    assert.equal(view.effectiveFreeAiLimit, undefined);
    assert.equal(view.effectiveFreeAiLimitPeriod, undefined);
  });

  it('reads a broken value as absent, so the own column decides', () => {
    const view = accountViewSchema.parse({ ...BODY, effectiveFreeAiLimit: 'ten', effectiveFreeAiLimitPeriod: 'month' });
    assert.equal(view.effectiveFreeAiLimit, undefined);
    assert.equal(view.effectiveFreeAiLimitPeriod, undefined);
    assert.equal(accountViewSchema.parse({ ...BODY, effectiveFreeAiLimit: -1 }).effectiveFreeAiLimit, undefined);
  });
});
