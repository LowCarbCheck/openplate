/**
 * What the English consent sentence says (M3/04, 2026-10-04).
 *
 * The privacy notice uses this consent as the legal basis for a photo going to
 * the AI, so the sentence has to name what the notice names: the chain, the
 * country, and the key that lets the operator read the diary. A sentence
 * that stops naming one of them fails here, in the source language, before it
 * is translated.
 *
 * It reads the shipped catalog and pins FACTS, not wording: a word per fact,
 * the way the privacy notice itself names them. The control is the sentence this
 * replaced, which named none of the four, so each assertion fails against it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const catalogSchema = z.object({ healthConsent: z.object({ checkbox: z.string() }) });

const SENTENCE = catalogSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).healthConsent.checkbox;

/** The sentence before 2026-10-04, for the control. */
const REPLACED_SENTENCE =
  'I agree that openplate processes my health data, such as what I eat, my weight and my fasting times, to run my account and sync my diary. The <privacy>privacy notice</privacy> explains how. I can withdraw my consent at any time by deleting my account.';

const FACTS = [
  { fact: 'the AI service the photo goes to', pattern: /OpenRouter/u },
  { fact: 'the company it passes the photo on to', pattern: /Google/u },
  { fact: 'the country', pattern: /USA/u },
  { fact: 'the recovery key the operator holds', pattern: /recovery key/u },
  { fact: 'what is sent, including text', pattern: /photo or text/u },
] as const;

describe('healthConsent.checkbox', () => {
  for (const { fact, pattern } of FACTS) {
    it(`names ${fact}`, () => {
      assert.match(SENTENCE, pattern);
    });

    it(`control: the replaced sentence did not name ${fact}`, () => {
      assert.doesNotMatch(REPLACED_SENTENCE, pattern);
    });
  }

  it('keeps the privacy notice a link target and the way to withdraw', () => {
    assert.match(SENTENCE, /<privacy>privacy notice<\/privacy>/u);
    assert.match(SENTENCE, /withdraw my consent at any time by deleting my account/u);
  });

  it('has no em dash or en dash', () => {
    assert.doesNotMatch(SENTENCE, /[–—]/u);
  });
});
