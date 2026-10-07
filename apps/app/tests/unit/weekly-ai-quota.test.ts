/**
 * THE AI ALLOWANCE COUNTS PER WEEK, AND THE APP SAYS SO (2026-10-07).
 *
 * The core reports the window per account: `aiLimitPeriod` and
 * `freeAiLimitPeriod` (`'day' | 'week'`) and `aiQuota`, the grant the proxy
 * holds the next request to. Legacy accounts and the Beta supporters stay per
 * day, so every case here has its day twin, and an older core that sends none
 * of the three must draw exactly what it drew before.
 *
 * ── The wire literals ────────────────────────────────────────────────────
 *
 * Transcribed from `apps/core/PROTOCOL.md` §5.15 (the account view) and §5.19
 * (the `429` body) as read on 2026-10-07, never imported from the other
 * repository. If the two disagree, this file is what fails.
 *
 * ── What is NOT pinned ───────────────────────────────────────────────────
 *
 * Wording that wordsmith owns. A sentence is asserted by SHAPE: the weekday
 * and the time the app computed are in it, no placeholder is left open, and
 * the weekly sentence carries none of the daily sentence's own words. The
 * English strings are hand-written source and are compared with the catalog,
 * not with a literal here.
 *
 * ── Controls ─────────────────────────────────────────────────────────────
 *
 * Each claim has a case beside it that must come out the other way: the day
 * beside the week, an old core beside a new one, one zone beside another.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { z } from 'zod';

import { AccountStripView, resolveAllowanceLine } from '../../app/components/avatar-account-strip';
import { TierList } from '../../app/components/plans/tier-list';
import { adminUsage } from '../../app/lib/admin/admin-usage';
import { decodeAiLimitPeriod, decodeAiQuota, describeQuotaReset, formatQuotaReset } from '../../app/lib/plans/ai-quota';
import { shownAiLimit, shownAllowance } from '../../app/lib/plans/free-grant';
import { NO_OWN_PLAN, tierAiLimitOf, tiersViewOf } from '../../app/lib/plans/tier-view';
import { classifyVisionHttpFailure } from '../../app/services/vision/failure-cause';
import { describeFailureBody, getFailureAlertTitle, shouldOfferPlansDoor } from '../../app/routes/add.photo';
import type { Translate } from '../../app/lib/sync/setup-flow';
import type { AccountViewWire } from '../../app/lib/sync/engine/client/auth-wire';
import { planOfferSchema, type PlanOffer } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureTiers from '../fixtures/plan-offer-tiers.json';
import { withI18n } from './trends-i18n-harness';

// ---------------------------------------------------------------------------
// The shipped catalogs, parsed, and a translator over them
// ---------------------------------------------------------------------------

type Catalog = { [key: string]: string | Catalog };
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));
const leafSchema = z.string();

function catalog(locale: string): Map<string, string> {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  const tree = catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
  const flat = new Map<string, string>();
  const walk = (node: Catalog, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      const leaf = leafSchema.safeParse(value);
      if (leaf.success) flat.set(path, leaf.data);
      else walk(catalogSchema.parse(value), path);
    }
  };
  walk(tree, '');
  return flat;
}

const EN = catalog('en');

/** i18next's `{{param}}` interpolation over a flat catalog, and a missing key answers as itself. */
function translatorFor(flat: Map<string, string>): Translate {
  return (key, params) => {
    const template = flat.get(key);
    if (template === undefined) return key;
    if (params === undefined) return template;
    return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''));
  };
}

const t = translatorFor(EN);

// ---------------------------------------------------------------------------
// The wire, as the protocol prints it
// ---------------------------------------------------------------------------

/** The `aiQuota` of §5.15's example: a weekly plan of 40 on a Wednesday, 13 used this week. */
const PROTOCOL_WEEK_QUOTA = {
  kind: 'paid',
  limit: 40,
  period: 'week',
  used: 13,
  resetsAt: '2026-10-12T00:00:00.000Z',
} as const;

/** A day window of the same account family: a legacy account, 3 of 10 today. */
const PROTOCOL_DAY_QUOTA = {
  kind: 'free',
  limit: 10,
  period: 'day',
  used: 3,
  resetsAt: '2026-10-08T00:00:00.000Z',
} as const;

/** §5.19's `429` body for a spent week. `error` is the sentence an older client reads. */
const SPENT_WEEK_BODY = {
  error: 'weekly quota spent: 40 of 40 units used, and this request needs 1. It resets at 2026-10-12T00:00:00.000Z.',
  code: 'ai-quota-spent',
  period: 'week',
  used: 40,
  limit: 40,
  weight: 1,
  resetsAt: '2026-10-12T00:00:00.000Z',
};

/** The same refusal for a day window: `error` is word for word the old sentence. */
const SPENT_DAY_BODY = {
  error: 'daily quota spent: 10 of 10 units used, and this request needs 1. It resets at 2026-10-08T00:00:00.000Z.',
  code: 'ai-quota-spent',
  period: 'day',
  used: 10,
  limit: 10,
  weight: 1,
  resetsAt: '2026-10-08T00:00:00.000Z',
};

function refusal({ status, body, retryAfter }: { status: number; body?: unknown; retryAfter?: string }): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// 1. Decoding, and the older core
// ---------------------------------------------------------------------------

describe('decodeAiLimitPeriod', () => {
  it('reads a week as a week', () => {
    assert.equal(decodeAiLimitPeriod('week'), 'week');
  });

  it('reads a day, an absent key and anything unknown as a day', () => {
    assert.equal(decodeAiLimitPeriod('day'), 'day');
    // THE OLDER CORE: no key at all.
    assert.equal(decodeAiLimitPeriod(undefined), 'day');
    assert.equal(decodeAiLimitPeriod(null), 'day');
    // A newer core with a window this build does not know must not invent one.
    assert.equal(decodeAiLimitPeriod('month'), 'day');
    assert.equal(decodeAiLimitPeriod('WEEK'), 'day');
  });
});

describe('decodeAiQuota', () => {
  it('reads the protocol example for a week, and drops its kind', () => {
    const quota = decodeAiQuota(PROTOCOL_WEEK_QUOTA);
    assert.deepEqual(quota, { limit: 40, period: 'week', used: 13, resetsAt: '2026-10-12T00:00:00.000Z' });
    // `kind` can say "free" for somebody who pays (the paid floor), so it is
    // not carried at all: no screen can name a plan from a field that is not there.
    assert.ok(quota !== null && !('kind' in quota));
  });

  it('draws the same quota for a payer whose grant is called free and for one whose grant is called paid', () => {
    const asFree = decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, kind: 'free' });
    const asPaid = decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, kind: 'paid' });
    assert.deepEqual(asFree, asPaid);
    // THE CONTROL: the numbers are what differ a quota, and they do.
    assert.notDeepEqual(asFree, decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, used: 14 }));
  });

  it('reads a day window of a legacy account', () => {
    assert.deepEqual(decodeAiQuota(PROTOCOL_DAY_QUOTA), {
      limit: 10,
      period: 'day',
      used: 3,
      resetsAt: '2026-10-08T00:00:00.000Z',
    });
  });

  it('reads null (the proxy would refuse), an absent key (an older core) and nonsense as no quota', () => {
    assert.equal(decodeAiQuota(null), null);
    assert.equal(decodeAiQuota(undefined), null);
    assert.equal(decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, period: 'month' }), null, 'an unknown window voids the quota');
    assert.equal(decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, limit: 0 }), null, 'a limit is above zero');
    assert.equal(decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, used: -1 }), null);
    assert.equal(decodeAiQuota({ ...PROTOCOL_WEEK_QUOTA, resetsAt: 'next monday' }), null);
  });
});

/** A signed-in account as the snapshot holds it, before the new fields. An older core's whole view. */
const OLDER_CORE_ACCOUNT = {
  dailyAiLimit: 20,
  aiUsedToday: 3,
  freeDailyAiLimit: 0,
  allowanceExpiresAt: null,
} as const;

const NOW = new Date('2026-10-07T12:00:00.000Z');

describe('shownAllowance', () => {
  it('prefers the quota the core states: the limit, the week, the count in it and the reset', () => {
    const quota = decodeAiQuota(PROTOCOL_WEEK_QUOTA);
    const shown = shownAllowance({
      ...OLDER_CORE_ACCOUNT,
      dailyAiLimit: 40,
      aiUsedToday: 2,
      aiLimitPeriod: 'week',
      aiQuota: quota,
      now: NOW,
    });
    assert.deepEqual(shown, { limit: 40, period: 'week', used: 13, resetsAt: '2026-10-12T00:00:00.000Z' });
  });

  it('draws the paid floor as the proxy counts it: a payer on the free grant shows the free limit and window', () => {
    // A Beta supporter on a paid plan at 20 a week is counted on 10 a day, and the
    // quota says so. The paid limit (20, week) must not be drawn instead.
    const shown = shownAllowance({
      dailyAiLimit: 20,
      aiUsedToday: 4,
      aiLimitPeriod: 'week',
      freeDailyAiLimit: 10,
      freeAiLimitPeriod: 'day',
      allowanceExpiresAt: '2026-12-01T00:00:00.000Z',
      aiQuota: decodeAiQuota({ ...PROTOCOL_DAY_QUOTA, used: 4 }),
      now: NOW,
    });
    assert.deepEqual(shown, { limit: 10, period: 'day', used: 4, resetsAt: '2026-10-08T00:00:00.000Z' });
  });

  it('draws an older core exactly as before: the daily limit, counted by today', () => {
    // NO `aiLimitPeriod`, NO `freeAiLimitPeriod`, NO `aiQuota`.
    assert.deepEqual(shownAllowance({ ...OLDER_CORE_ACCOUNT, now: NOW }), {
      limit: 20,
      period: 'day',
      used: 3,
      resetsAt: null,
    });
  });

  it('draws a null quota from the limits the account names, and a weekly one without a count', () => {
    const daily = shownAllowance({ ...OLDER_CORE_ACCOUNT, aiQuota: null, now: NOW });
    assert.deepEqual(daily, { limit: 20, period: 'day', used: 3, resetsAt: null });
    // THE CONTROL: a weekly limit with no quota has only today's count, and a
    // week's limit against it would be a number nobody measured.
    const weekly = shownAllowance({ ...OLDER_CORE_ACCOUNT, aiLimitPeriod: 'week', aiQuota: null, now: NOW });
    assert.deepEqual(weekly, { limit: 20, period: 'week', used: null, resetsAt: null });
  });

  it('says nothing while the account is not read', () => {
    assert.equal(
      shownAllowance({ ...OLDER_CORE_ACCOUNT, dailyAiLimit: null, aiUsedToday: null, aiQuota: null, now: NOW }),
      null,
    );
  });
});

describe('shownAiLimit', () => {
  it('names the free grant with ITS window once the paid one ended', () => {
    const shown = shownAiLimit({
      dailyAiLimit: 20,
      aiLimitPeriod: 'week',
      freeDailyAiLimit: 10,
      freeAiLimitPeriod: 'week',
      allowanceExpiresAt: '2026-09-01T00:00:00.000Z',
      now: NOW,
    });
    assert.deepEqual(shown, { limit: 10, period: 'week' });
  });

  it('names the paid limit with the paid window while it runs, and a day without one', () => {
    const live = { dailyAiLimit: 20, freeDailyAiLimit: 10, allowanceExpiresAt: '2026-12-01T00:00:00.000Z', now: NOW };
    assert.deepEqual(shownAiLimit({ ...live, aiLimitPeriod: 'week' }), { limit: 20, period: 'week' });
    assert.deepEqual(shownAiLimit(live), { limit: 20, period: 'day' });
  });
});

// ---------------------------------------------------------------------------
// 2. The reset moment, in two locales and two zones
// ---------------------------------------------------------------------------

/** Monday 12 October 2026, 00:00 UTC: the first reset after the contract's example. */
const MONDAY = '2026-10-12T00:00:00.000Z';

describe('formatQuotaReset', () => {
  it('names the weekday and the time in English, in the reader’s zone', () => {
    const berlin = formatQuotaReset({ resetsAt: MONDAY, language: 'en', timeZone: 'Europe/Berlin' });
    assert.equal(berlin?.weekday, 'Monday');
    assert.match(berlin?.time ?? '', /^2:00\s?AM$/);
  });

  it('names the weekday and the time in German', () => {
    const berlin = formatQuotaReset({ resetsAt: MONDAY, language: 'de', timeZone: 'Europe/Berlin' });
    assert.equal(berlin?.weekday, 'Montag');
    assert.equal(berlin?.time, '02:00');
  });

  it('reads the weekday in the reader’s zone, so Monday 00:00 UTC is Sunday evening in New York', () => {
    const newYork = formatQuotaReset({ resetsAt: MONDAY, language: 'en', timeZone: 'America/New_York' });
    assert.equal(newYork?.weekday, 'Sunday');
    assert.match(newYork?.time ?? '', /^8:00\s?PM$/);
    // THE CONTROL: the same instant, another zone, another weekday. A formatter
    // that read the UTC day would give "Monday" for both.
    const berlin = formatQuotaReset({ resetsAt: MONDAY, language: 'en', timeZone: 'Europe/Berlin' });
    assert.notEqual(newYork?.weekday, berlin?.weekday);
    const germanNewYork = formatQuotaReset({ resetsAt: MONDAY, language: 'de', timeZone: 'America/New_York' });
    assert.equal(germanNewYork?.weekday, 'Sonntag');
    assert.equal(germanNewYork?.time, '20:00');
  });

  it('answers null for an instant that does not parse, rather than a blank date', () => {
    assert.equal(formatQuotaReset({ resetsAt: 'soon', language: 'en' }), null);
  });
});

describe('describeQuotaReset', () => {
  const base = { resetsAt: MONDAY, language: 'en', timeZone: 'Europe/Berlin', t } as const;

  it('says the weekday and the time for a week, and only the time for a day', () => {
    const week = describeQuotaReset({ ...base, period: 'week' });
    assert.ok(week !== null && week.includes('Monday') && /2:00\s?AM/.test(week), String(week));
    assert.ok(!week.includes('{{'), 'a placeholder was left open');
    const day = describeQuotaReset({ ...base, period: 'day' });
    assert.ok(day !== null && /2:00\s?AM/.test(day) && !day.includes('Monday'), String(day));
    assert.notEqual(week, day);
  });

  it('draws nothing for a count with no instant behind it', () => {
    assert.equal(describeQuotaReset({ ...base, period: 'week', resetsAt: null }), null);
    assert.equal(describeQuotaReset({ ...base, period: 'week', resetsAt: 'soon' }), null);
  });
});

// ---------------------------------------------------------------------------
// 3. The account strip: "N of M this week", and today for a daily account
// ---------------------------------------------------------------------------

function renderInMenu(node: ReturnType<typeof createElement>): string {
  const content = createElement(
    DropdownMenuPrimitive.Root,
    { open: true },
    createElement(DropdownMenuPrimitive.Content, { forceMount: true }, node),
  );
  const router = createMemoryRouter([{ path: '/', element: withI18n(content) }], { initialEntries: ['/'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function renderStripWith(allowance: Parameters<typeof AccountStripView>[0]['allowance']): string {
  return renderInMenu(
    createElement(AccountStripView, {
      state: { status: 'synced', lastSyncedAt: Date.now() },
      title: 'ada@example.org',
      allowance,
      timeZone: 'Europe/Berlin',
    }),
  );
}

describe('resolveAllowanceLine with a window', () => {
  const base = { aiComesFromTheInstance: true, plansAvailable: false } as const;

  it('carries the week, the count in it and the reset', () => {
    const line = resolveAllowanceLine({ ...base, limit: 40, used: 13, period: 'week', resetsAt: MONDAY });
    assert.deepEqual(line, { kind: 'usage', used: 13, limit: 40, period: 'week', resetsAt: MONDAY });
  });

  it('keeps a limit with no window a day, which is what an older core means', () => {
    const line = resolveAllowanceLine({ ...base, limit: 20, used: 3 });
    assert.deepEqual(line, { kind: 'usage', used: 3, limit: 20, period: 'day', resetsAt: null });
  });

  it('prints no count for a weekly limit it cannot count', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, limit: 40, used: null, period: 'week' }), { kind: 'none' });
    // THE CONTROL: a daily limit with the same missing count still prints, as
    // none used, which is the line the strip has always drawn.
    assert.equal(resolveAllowanceLine({ ...base, limit: 20, used: null, period: 'day' }).kind, 'usage');
  });
});

describe('the strip, by window', () => {
  const week = renderStripWith({ kind: 'usage', used: 13, limit: 40, period: 'week', resetsAt: MONDAY });
  const day = renderStripWith({
    kind: 'usage',
    used: 3,
    limit: 10,
    period: 'day',
    resetsAt: '2026-10-08T00:00:00.000Z',
  });
  const undated = renderStripWith({ kind: 'usage', used: 3, limit: 10, period: 'day', resetsAt: null });

  it('says "this week" with the numbers for a week, and the weekday it resets', () => {
    assert.ok(week.includes(t('account.allowance.thisWeek', { used: 13, limit: 40 })), week.slice(0, 900));
    assert.ok(week.includes('Monday'), week.slice(0, 900));
    assert.ok(!week.includes(t('account.allowance.today', { used: 13, limit: 40 })), 'a week was drawn as a day');
  });

  it('says today for a day, with the reset time and no weekday', () => {
    assert.ok(day.includes(t('account.allowance.today', { used: 3, limit: 10 })), day.slice(0, 900));
    assert.ok(!day.includes(t('account.allowance.thisWeek', { used: 3, limit: 10 })), 'a day was drawn as a week');
    assert.ok(day.includes(t('account.allowance.resetsDay', { time: '2:00 AM' })), day.slice(0, 1400));
    assert.ok(!/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(day), 'a day names no weekday');
  });

  it('draws no reset line for a count with no instant, the older core’s strip', () => {
    assert.ok(undated.includes(t('account.allowance.today', { used: 3, limit: 10 })));
    assert.ok(!undated.includes('Resets'), undated.slice(0, 1400));
    // THE CONTROL: the same strip with an instant does draw it.
    assert.ok(day.includes('Resets'), day.slice(0, 1400));
  });
});

// ---------------------------------------------------------------------------
// 4. The refusal: `429 ai-quota-spent`
// ---------------------------------------------------------------------------

describe('classifying a 429', () => {
  it('reads a spent week by its code and carries the window', async () => {
    const failure = await classifyVisionHttpFailure(
      refusal({ status: 429, body: SPENT_WEEK_BODY, retryAfter: '345600' }),
    );
    assert.equal(failure.cause, 'ai-quota-spent');
    assert.deepEqual(failure.quota, { period: 'week', used: 40, limit: 40, resetsAt: '2026-10-12T00:00:00.000Z' });
    assert.equal(failure.retryAfterSeconds, 345_600);
  });

  it('reads a spent day by its code, and keeps the window it names', async () => {
    const failure = await classifyVisionHttpFailure(
      refusal({ status: 429, body: SPENT_DAY_BODY, retryAfter: '43200' }),
    );
    assert.equal(failure.cause, 'ai-quota-spent');
    assert.equal(failure.quota?.period, 'day');
  });

  it('branches on the code and never on the sentence', async () => {
    // THE CONTROL: the sentence alone, as an older core sends it, is the old
    // reading of a managed 429, and a code with another sentence is the new one.
    const sentenceOnly = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { error: SPENT_WEEK_BODY.error }, retryAfter: '345600' }),
    );
    assert.equal(sentenceOnly.cause, 'rate-limit');
    assert.equal(sentenceOnly.quota, undefined);
    const codeOnly = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { ...SPENT_WEEK_BODY, error: 'something else entirely' } }),
    );
    assert.equal(codeOnly.cause, 'ai-quota-spent');
  });

  it('keeps the burst limit a rate limit, and a window it does not know a rate limit too', async () => {
    const burst = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { error: 'rate limit: 30 requests per minute' }, retryAfter: '12' }),
    );
    assert.equal(burst.cause, 'rate-limit');
    const future = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { ...SPENT_WEEK_BODY, period: 'month' }, retryAfter: '9000' }),
    );
    assert.equal(future.cause, 'rate-limit', 'an unknown window falls back to the older reading');
  });

  it('keeps a provider’s own quota code a credit refusal', async () => {
    const credit = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { error: { code: 'insufficient_quota' } } }),
    );
    assert.equal(credit.cause, 'credit');
  });

  it('drops an instant that does not parse, and keeps the rest of the window', async () => {
    const failure = await classifyVisionHttpFailure(
      refusal({ status: 429, body: { ...SPENT_WEEK_BODY, resetsAt: 'monday' } }),
    );
    assert.equal(failure.quota?.resetsAt, null);
    assert.equal(failure.quota?.period, 'week');
  });
});

/** Words the daily sentence is made of, which a spent WEEK must never say. */
const TOMORROW = /tomorrow|today/i;

describe('what a spent allowance says', () => {
  const week = {
    failureCause: 'ai-quota-spent',
    language: 'en',
    timeZone: 'Europe/Berlin',
    quota: { period: 'week', used: 40, limit: 40, resetsAt: '2026-10-12T00:00:00.000Z' },
  } as const;
  const day = {
    failureCause: 'ai-quota-spent',
    language: 'en',
    timeZone: 'Europe/Berlin',
    quota: { period: 'day', used: 10, limit: 10, resetsAt: '2026-10-08T00:00:00.000Z' },
  } as const;

  it('says WHEN a spent week returns, and never says tomorrow', () => {
    const body = describeFailureBody(week, t);
    assert.ok(body !== undefined && body.includes('Monday') && /2:00\s?AM/.test(body), String(body));
    assert.ok(!body.includes('{{') && !body.includes('scan.errors'), 'a placeholder or a key fell through');
    assert.doesNotMatch(body, TOMORROW);
  });

  it('keeps the daily wording for a day', () => {
    assert.equal(describeFailureBody(day, t), EN.get('scan.errors.provider.allowanceSpent'));
    // THE CONTROL over the loop above: the daily sentence DOES say tomorrow,
    // so the pattern in the week test can fail.
    assert.match(describeFailureBody(day, t) ?? '', TOMORROW);
  });

  it('names the plans for a spent week or day only where plans are sold and no paid window runs', () => {
    const open = { plansAvailable: true, hasPaidWindow: false } as const;
    assert.notEqual(describeFailureBody({ ...week, ...open }, t), describeFailureBody(week, t));
    assert.equal(describeFailureBody({ ...day, ...open }, t), EN.get('scan.errors.provider.allowanceSpentPlans'));
    assert.equal(
      describeFailureBody({ ...week, plansAvailable: true, hasPaidWindow: true }, t),
      describeFailureBody(week, t),
    );
    assert.equal(describeFailureBody({ ...week, plansAvailable: false }, t), describeFailureBody(week, t));
  });

  it('says only that the week turns over when the refusal carried no instant', () => {
    const body = describeFailureBody({ ...week, quota: { ...week.quota, resetsAt: null } }, t);
    assert.equal(body, EN.get('scan.errors.provider.allowanceSpentWeekUndated'));
    assert.doesNotMatch(body ?? '', TOMORROW);
  });

  it('keeps the older core’s spent day by its header, the control for the branch above', () => {
    // No `quota`: a bare 429 with a long Retry-After, which is what a core
    // older than the code sends for a spent day.
    const older = { failureCause: 'rate-limit', retryAfterSeconds: 43_200, language: 'en' } as const;
    assert.equal(describeFailureBody(older, t), EN.get('scan.errors.provider.allowanceSpent'));
  });

  it('has its own headline, which names neither a day nor a week', () => {
    const title = getFailureAlertTitle('ai-quota-spent', t);
    assert.ok(!title.includes('scan.errors'), 'the key fell through');
    assert.notEqual(title, getFailureAlertTitle('rate-limit', t));
    assert.doesNotMatch(title, /day|week|today/i);
  });

  it('offers the plan page for a spent allowance without a paid window, and not with one', () => {
    const spent = { failureCause: 'ai-quota-spent', plansAvailable: true } as const;
    assert.equal(shouldOfferPlansDoor({ ...spent, hasPaidWindow: false }), true);
    assert.equal(shouldOfferPlansDoor({ ...spent, hasPaidWindow: true }), false, 'already paying');
    assert.equal(shouldOfferPlansDoor({ ...spent, plansAvailable: false }), false, 'no door');
    // THE CONTROL: a burst, with no code, is still not a spent allowance.
    assert.equal(
      shouldOfferPlansDoor({ failureCause: 'rate-limit', retryAfterSeconds: 12, plansAvailable: true }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The plan page: a tier counts per day or per week
// ---------------------------------------------------------------------------

describe('a tier’s AI limit', () => {
  it('reads aiLimit with its window, and a weekly tier’s null daily limit does not blank it', () => {
    assert.deepEqual(tierAiLimitOf({ dailyAiLimit: null, aiLimit: 20, aiLimitPeriod: 'week' }), {
      limit: 20,
      period: 'week',
    });
  });

  it('reads a biller older than the pair as a daily limit', () => {
    assert.deepEqual(tierAiLimitOf({ dailyAiLimit: 25 }), { limit: 25, period: 'day' });
    assert.deepEqual(tierAiLimitOf({ dailyAiLimit: 0 }), { limit: 0, period: 'day' });
    // THE CONTROL: a tier that states no limit at all is still no limit.
    assert.deepEqual(tierAiLimitOf({ dailyAiLimit: null }), { limit: null, period: 'day' });
  });
});

/** The fixture offer with tiers, and a tier of it. Parsed by the app's own decoder, so the new fields go through it too. */
const FIXTURE_TIER = planOfferSchema.parse(fixtureTiers).tiers?.[1];

/** The fixture offer carrying one tier with the given limit fields, decoded the way the app decodes the biller's answer. */
function offerWithTier(limits: Readonly<Record<string, string | number | null>>): PlanOffer {
  return planOfferSchema.parse({ ...fixtureTiers, tiers: [{ ...FIXTURE_TIER, ...limits }] });
}

function renderTiers(offer: PlanOffer): string {
  const view = tiersViewOf({ offer, own: NO_OWN_PLAN });
  assert.ok(view !== null);
  return renderToStaticMarkup(
    withI18n(createElement(TierList, { rows: view.rows, pickedTierId: null, canPick: false, onPick: () => undefined })),
  );
}

describe('the tier list', () => {
  it('draws a weekly tier as scans a week, and a daily one as scans a day', () => {
    const weekly = renderTiers(offerWithTier({ dailyAiLimit: null, aiLimit: 20, aiLimitPeriod: 'week' }));
    assert.ok(weekly.includes(t('plan.tiers.weeklyLimit_other', { count: 20 })), weekly);
    assert.ok(!weekly.includes(t('plan.tiers.dailyLimit_other', { count: 20 })));
    // THE CONTROL: the same count as a day, from a biller older than the pair.
    const daily = renderTiers(offerWithTier({ dailyAiLimit: 20 }));
    assert.ok(daily.includes(t('plan.tiers.dailyLimit_other', { count: 20 })), daily);
    assert.ok(!daily.includes(t('plan.tiers.weeklyLimit_other', { count: 20 })));
  });

  it('reads an unknown window from a newer biller as a day, never as a blank line', () => {
    const odd = renderTiers(offerWithTier({ dailyAiLimit: 20, aiLimit: 20, aiLimitPeriod: 'month' }));
    assert.ok(odd.includes(t('plan.tiers.dailyLimit_other', { count: 20 })), odd);
  });
});

// ---------------------------------------------------------------------------
// 6. The admin's line
// ---------------------------------------------------------------------------

/** A translator that answers the key and its parameters, so a case reads which sentence was chosen. */
function echoKey(name: string, params?: Readonly<Record<string, string | number>>): string {
  return params === undefined ? name : `${name} ${JSON.stringify(params)}`;
}

describe('the admin’s usage line', () => {
  const person = {
    dailyAiLimit: 40,
    freeDailyAiLimit: 0,
    allowanceExpiresAt: '2026-12-01T00:00:00.000Z',
    aiUsedToday: 2,
  };

  it('reads the week’s count against a weekly limit, never today’s', () => {
    const line = adminUsage({ person: { ...person, aiLimitPeriod: 'week', aiUsedThisWeek: 13 }, t: echoKey, now: NOW });
    assert.equal(line, 'admin.usageWeek {"used":13,"limit":40}');
  });

  it('reads today’s count against a daily limit, whatever the week holds', () => {
    const line = adminUsage({ person: { ...person, aiLimitPeriod: 'day', aiUsedThisWeek: 13 }, t: echoKey, now: NOW });
    assert.equal(line, 'admin.usage {"used":2,"limit":40}');
    // An older core: no window, no week count.
    assert.equal(adminUsage({ person, t: echoKey, now: NOW }), 'admin.usage {"used":2,"limit":40}');
  });

  it('names the limit alone for a weekly limit it cannot count', () => {
    const line = adminUsage({ person: { ...person, aiLimitPeriod: 'week' }, t: echoKey, now: NOW });
    assert.equal(line, 'account.allowance.limitWeek {"count":40}');
  });
});

// ---------------------------------------------------------------------------
// 7. The wire type and the one rule about `kind`
// ---------------------------------------------------------------------------

describe('the account view', () => {
  it('accepts the protocol example, and an older core’s view without the three fields', () => {
    const weeklyPlan: AccountViewWire = {
      id: 1,
      email: 'anna@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit: 40,
      aiLimitPeriod: 'week',
      aiUsedToday: 2,
      freeDailyAiLimit: 10,
      freeAiLimitPeriod: 'week',
      aiQuota: PROTOCOL_WEEK_QUOTA,
      allowanceExpiresAt: null,
      suspendedAt: null,
      invitesLeft: null,
      createdAt: '2026-09-04T10:11:12.000Z',
    };
    assert.equal(weeklyPlan.aiQuota?.limit, 40);
    const older: AccountViewWire = { ...weeklyPlan };
    delete older.aiLimitPeriod;
    delete older.freeAiLimitPeriod;
    delete older.aiQuota;
    assert.equal(older.aiQuota, undefined);
  });
});

/** Every `.ts` and `.tsx` source under `app/`, as `[path, text]`. */
function appSources(): Array<[string, string]> {
  const root = fileURLToPath(new URL('../../app/', import.meta.url));
  const found: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}${name}`;
      if (statSync(path).isDirectory()) walk(`${path}/`);
      else if (/\.tsx?$/.test(name)) found.push([path, readFileSync(path, 'utf8')]);
    }
  };
  walk(root);
  return found;
}

/** A read of the quota's `kind`, off the account's field or off a decoded quota. */
const KIND_READ = /aiQuota\??\.kind|quota\??\.kind\s*===\s*['"](paid|free|trial)['"]/;

/** Source without its comments, because the header of `ai-quota.ts` names `aiQuota.kind` to say it is not read. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('no screen names a plan from the quota’s kind', () => {
  it('reads no `.kind` off an aiQuota anywhere under app/', () => {
    const offenders = appSources()
      .filter(([, text]) => KIND_READ.test(withoutComments(text)))
      .map(([path]) => path);
    assert.deepEqual(offenders, []);
  });

  it('would notice one, the control for the scan above', () => {
    assert.ok(KIND_READ.test(withoutComments('const plan = account.aiQuota?.kind;')));
    assert.ok(KIND_READ.test(withoutComments('if (aiQuota.kind === "free") {}')));
    assert.ok(!KIND_READ.test(withoutComments('// the aiQuota.kind is not read\n/* aiQuota.kind */')));
  });
});
