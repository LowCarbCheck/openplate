/**
 * What `POST /v1/auth/signup-request` reads off a body as the person's pick
 * (`readSignupIntent`): the plan, the tier it belongs to and the language.
 *
 * THE TIER IS A LABEL, NOT A KEY FROM A LIST. This service knows the two plan
 * keys and never reads the biller's catalogue, so a tier is judged by its
 * shape alone: a lowercase label of one to 32 characters, a letter first. The
 * shape is also what keeps a value from carrying anything into the fragment of
 * the link it rides in. Nothing is trimmed, folded or coerced, and an unfit
 * value is `null` and never an error, because the door answers the same `202`
 * whatever these fields say.
 *
 * Every refusal below has its control: a value one step inside the rule that
 * is kept. Without them a reader that dropped every tier would pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSignupIntent, SIGNUP_TIER_PATTERN } from '../../src/accounts/open-signup.js';
import type { JsonObject, JsonValue } from '../../src/lib/json.js';

function tierOf(value: JsonValue | undefined): string | null {
  const fields: JsonObject = { tier: value };
  return readSignupIntent(fields).tier;
}

test('a label of one to 32 lowercase characters is kept as it was written', () => {
  const kept = ['a', 'alpha', 'tier-a', 'plus', 'a1', 'a-', `a${'b'.repeat(31)}`];
  for (const label of kept) assert.equal(tierOf(label), label, label);
  // THE EDGE: 32 characters is the longest, and it is kept.
  assert.equal(`a${'b'.repeat(31)}`.length, 32);
});

test('anything that is not such a label reads as no tier, silently', () => {
  const dropped: (JsonValue | undefined)[] = [
    'Alpha', // case
    'ALPHA',
    `a${'b'.repeat(32)}`, // 33 characters
    ' alpha', // padding
    'alpha ',
    'alpha\n',
    '', // empty
    '1alpha', // a letter first
    '-alpha',
    'alpha_beta',
    'alpha.beta',
    'ålpha',
    'a&plan=monthly', // a second parameter in disguise
    'alpha#frag',
    'alpha%26x',
    null,
    undefined,
    42,
    true,
    { id: 'alpha' },
    ['alpha'],
    [],
  ];
  for (const value of dropped) assert.equal(tierOf(value), null, JSON.stringify(value) ?? 'undefined');
});

test('a tier is read whether or not a plan is beside it, and neither changes the other', () => {
  assert.deepEqual(readSignupIntent({ plan: 'yearly', tier: 'alpha', locale: 'de' }), {
    plan: 'yearly',
    tier: 'alpha',
    locale: 'de',
  });
  assert.deepEqual(readSignupIntent({ tier: 'alpha' }), { plan: null, tier: 'alpha', locale: null });
  // THE CONTROL: an unfit tier leaves a valid plan and language alone.
  assert.deepEqual(readSignupIntent({ plan: 'monthly', tier: 'Alpha', locale: 'fr' }), {
    plan: 'monthly',
    tier: null,
    locale: 'fr',
  });
  assert.deepEqual(readSignupIntent({}), { plan: null, tier: null, locale: null });
});

test('the pattern is anchored, so a label with trailing text never matches', () => {
  assert.equal(SIGNUP_TIER_PATTERN.test('alpha'), true);
  assert.equal(SIGNUP_TIER_PATTERN.test('alpha\n'), false);
  assert.equal(SIGNUP_TIER_PATTERN.test('x alpha'), false);
});
