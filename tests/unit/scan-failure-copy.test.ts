/**
 * WHAT A FAILED PHOTO ESTIMATE SAYS, and that it says anything at all.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Walking 0.10.0 on 2026-09-04 with the server answering `413`: pressing
 * "Analyze" did nothing. No toast, no card, nothing in the console, and the
 * same oversized photo uploaded twice. Two separate faults met there, and both
 * are pinned below.
 *
 *  1. CLASSIFICATION. A `413` fell into the unmatched-4xx bucket, whose advice
 *     is "check your model and connection settings" — wrong for a size problem
 *     and meaningless on a managed instance, which has no settings to check.
 *     The two managed `403`s were worse: they landed on `auth`, which tells
 *     somebody to fix an API key they do not have.
 *  2. RETRY. A `413` is a 4xx that is not in the non-retryable set, so the
 *     adapter read it as "this server rejects `response_format`" and sent the
 *     photo a second time. Dropping a body field cannot make a photo smaller.
 *
 * ── And the one thing the mapping cannot fix ─────────────────────────────
 *
 * A round trip that ends with NEITHER a result nor a message. The route now
 * treats that as a failure of its own, which is asserted here on the copy it
 * reaches for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { classifyVisionHttpFailure } from '../../app/services/vision/failure-cause';
import { describeFailureBody, getFailureAlertTitle } from '../../app/routes/scan';
import type { Translate } from '../../app/lib/sync/setup-flow';
import type { VisionFailureCause } from '../../app/services/vision/failure-cause';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/** The on-disk catalog, PARSED rather than asserted — the same schema every other catalog test uses. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));
const leafSchema = z.string();

/** The shipped catalog, flattened, so an assertion here pins the sentence a person reads. */
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
const DE = catalog('de');

/** A translator over the real catalog, with i18next's `{{param}}` interpolation. */
function translatorFor(flat: Map<string, string>): Translate {
  return (key, params) => {
    const template = flat.get(key);
    if (template === undefined) return key;
    if (params === undefined) return template;
    return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''));
  };
}

const t = translatorFor(EN);
const tDe = translatorFor(DE);

/** A response as the sync service sends it, headers and all. */
function refusal({ status, body, retryAfter }: { status: number; body?: unknown; retryAfter?: string }): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return new Response(JSON.stringify(body ?? {}), { status, headers });
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('413 is its own cause, not "check your settings"', async () => {
  const classification = await classifyVisionHttpFailure(refusal({ status: 413 }));
  assert.equal(classification.cause, 'photo-too-large');
  assert.match(classification.message, /too large/i);
  assert.doesNotMatch(classification.message, /settings/i, 'nothing in settings makes a photo smaller');
});

test('403 ai-not-allowed points at the administrator, never at an API key', async () => {
  const classification = await classifyVisionHttpFailure(refusal({ status: 403, body: { error: 'ai-not-allowed' } }));
  assert.equal(classification.cause, 'ai-not-allowed');
  assert.doesNotMatch(classification.message, /API key|AI settings/i);
});

test('403 account-suspended is its own cause, and it is not an auth failure', async () => {
  const classification = await classifyVisionHttpFailure(
    refusal({ status: 403, body: { error: 'account-suspended' } }),
  );
  assert.equal(classification.cause, 'account-suspended');
});

test('a 403 with no marker is still the ordinary key rejection', async () => {
  // The open-instance branch has to keep working: a provider that refuses a
  // pasted key answers 403 with its own envelope and no code we know.
  const classification = await classifyVisionHttpFailure(refusal({ status: 403 }));
  assert.equal(classification.cause, 'auth');
});

test('a 429 carries Retry-After through, so a burst can be told from a spent day', async () => {
  const soon = await classifyVisionHttpFailure(refusal({ status: 429, retryAfter: '30' }));
  assert.equal(soon.cause, 'rate-limit');
  assert.equal(soon.retryAfterSeconds, 30);

  const tomorrow = await classifyVisionHttpFailure(refusal({ status: 429, retryAfter: '43200' }));
  assert.equal(tomorrow.retryAfterSeconds, 43_200);

  const bare = await classifyVisionHttpFailure(refusal({ status: 429 }));
  assert.equal(bare.retryAfterSeconds, null, 'an absent header is null, never a guessed number');
});

test('a 5xx is still transient, and a 400 is still the settings bucket', async () => {
  assert.equal((await classifyVisionHttpFailure(refusal({ status: 503 }))).cause, 'transient');
  assert.equal((await classifyVisionHttpFailure(refusal({ status: 400 }))).cause, 'invalid-request');
});

// ---------------------------------------------------------------------------
// The sentence a person reads
// ---------------------------------------------------------------------------

test('every managed failure has a translated sentence in BOTH locales', () => {
  const expected = [
    { cause: 'photo-too-large', pattern: /too large for this server/i },
    { cause: 'ai-not-allowed', pattern: /not switched on for your account/i },
    { cause: 'account-suspended', pattern: /suspended/i },
  ] as const satisfies readonly { cause: VisionFailureCause; pattern: RegExp }[];
  for (const { cause, pattern } of expected) {
    const english = describeFailureBody({ failureCause: cause }, t);
    assert.ok(english !== undefined, `${cause} has no body`);
    assert.match(english, pattern);
    // The German is a different sentence, not the English one falling through
    // a missing key: `translatorFor` returns the KEY on a miss, so a hole shows
    // up as a dotted path here.
    const german = describeFailureBody({ failureCause: cause }, tDe);
    assert.ok(german !== undefined && !german.includes('scan.errors'), `${cause} is missing in German`);
    assert.notEqual(german, english);
  }
});

test('a 429 under a minute says "in a minute", and one over it says "tomorrow"', () => {
  const soon = describeFailureBody({ failureCause: 'rate-limit', retryAfterSeconds: 30 }, t);
  assert.match(String(soon), /in a minute/i);

  const tomorrow = describeFailureBody({ failureCause: 'rate-limit', retryAfterSeconds: 43_200 }, t);
  assert.match(String(tomorrow), /tomorrow/i);
  assert.notEqual(soon, tomorrow, 'the whole point of reading the header');
});

test('a 429 with no header keeps the generic wording rather than inventing a deadline', () => {
  const body = describeFailureBody({ failureCause: 'rate-limit' }, t);
  assert.doesNotMatch(String(body), /tomorrow/i);
});

test("OpenRouter's own rate-limit copy still wins on an open instance", () => {
  // The free tier resets daily and says so; the managed branch must not have
  // taken that over.
  const body = describeFailureBody({ failureCause: 'rate-limit', provider: 'openrouter', retryAfterSeconds: 30 }, t);
  assert.equal(body, EN.get('scan.errors.openrouterRateLimit'));
});

test('every cause has a headline, in both locales', () => {
  const causes = [
    'auth',
    'reconsent-required',
    'credit',
    'rate-limit',
    'model-not-found',
    'invalid-request',
    'transient',
    'photo-too-large',
    'ai-not-allowed',
    'account-suspended',
  ] as const;
  for (const cause of causes) {
    for (const [locale, translate] of [
      ['en', t],
      ['de', tDe],
    ] as const) {
      const title = getFailureAlertTitle(cause, translate);
      assert.ok(!title.startsWith('scan.errors'), `${cause} has no ${locale} headline`);
    }
  }
});

// ---------------------------------------------------------------------------
// The silent case
// ---------------------------------------------------------------------------

test('the route treats a round trip that returns nothing as a failure', () => {
  // Structural, because the state it produces cannot be reached without a
  // router and a fetcher. What is asserted is that the branch EXISTS: before
  // this, a submission that never reached the action left the screen exactly
  // as it was, which is what "the button does nothing" looked like.
  const route = readFileSync(new URL('../../app/routes/scan.tsx', import.meta.url), 'utf8');
  assert.match(route, /setDidSettleWithNothing\(fetcher\.data === undefined\)/);
  assert.match(route, /const silentFailure = didSettleWithNothing \? t\('scan\.errors\.identifyFailed'\)/);
  assert.ok(EN.has('scan.errors.identifyFailed'), 'and the sentence exists');
});

test('413 is not retried', () => {
  // The second upload was the larger cost of the two.
  const adapter = readFileSync(new URL('../../app/services/vision/openai-compatible.ts', import.meta.url), 'utf8');
  assert.match(adapter, /NON_RETRYABLE_CLIENT_ERROR_STATUSES[^=]*=\s*new Set\(\[401, 402, 403, 413, 429\]\)/);
});
