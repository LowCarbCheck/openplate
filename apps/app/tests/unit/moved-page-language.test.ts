/**
 * Which language the moved page speaks: the cookie, then `Accept-Language`, then
 * `DEFAULT_UI_LANGUAGE` (`app/lib/moved/moved-copy.ts`, `app/i18n/accept-language.ts`), and the
 * words it then draws.
 *
 * THE CONTROLS. Each step of the order is shown winning over the step after it AND losing to the
 * step before it, so a resolver that skipped a step, or swapped two, fails here. The header reader
 * is fed the cases that trick a naive one: a weight that puts a later entry first, a weight of 0,
 * a region, the wildcard, and a weight that does not parse.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { pickAcceptedLanguage } from '../../app/i18n/accept-language';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { movedPageCopy, resolveMovedPageLanguage } from '../../app/lib/moved/moved-copy';

describe('pickAcceptedLanguage', () => {
  const cases: { header: string | null; expected: string | null; why: string }[] = [
    { header: null, expected: null, why: 'no header names nothing' },
    { header: '', expected: null, why: 'an empty header names nothing' },
    { header: 'de', expected: 'de', why: 'a bare code' },
    { header: 'de-AT', expected: 'de', why: 'a region asks for its language' },
    { header: 'FR-ca', expected: 'fr', why: 'letter case does not matter' },
    { header: 'pt-BR, it;q=0.4', expected: 'it', why: 'a language the app lacks is passed over' },
    { header: 'en;q=0.5, tr', expected: 'tr', why: 'the heavier weight wins over the earlier place' },
    { header: 'es, fr', expected: 'es', why: 'equal weights keep the browser order' },
    { header: 'de;q=0, it', expected: 'it', why: 'a weight of 0 means not this one' },
    { header: '*', expected: null, why: 'the wildcard names no language' },
    { header: 'de;q=banana, fr;q=0.2', expected: 'fr', why: 'an entry whose weight does not parse is dropped' },
    { header: 'de;q=5, es;q=0.3', expected: 'es', why: 'a weight above 1 does not parse either' },
    { header: 'ja, zh-CN;q=0.8', expected: null, why: 'none of the six' },
  ];

  for (const testCase of cases) {
    it(`${testCase.why}: ${JSON.stringify(testCase.header)} -> ${String(testCase.expected)}`, () => {
      assert.equal(pickAcceptedLanguage(testCase.header), testCase.expected);
    });
  }
});

describe('resolveMovedPageLanguage', () => {
  it('takes the cookie first, over a header that asks for another language', () => {
    assert.equal(
      resolveMovedPageLanguage({ cookieHeader: 'openplate-language=tr', acceptLanguage: 'de', instanceDefault: 'en' }),
      'tr',
    );
  });

  it('takes the header when there is no cookie, over the instance default', () => {
    assert.equal(resolveMovedPageLanguage({ cookieHeader: null, acceptLanguage: 'de-DE,de;q=0.9', instanceDefault: 'fr' }), 'de');
  });

  it('takes the header when the cookie holds a language the app does not ship', () => {
    assert.equal(
      resolveMovedPageLanguage({ cookieHeader: 'openplate-language=pt', acceptLanguage: 'it', instanceDefault: 'en' }),
      'it',
    );
  });

  it('falls back to the instance default when neither names one of the six', () => {
    assert.equal(resolveMovedPageLanguage({ cookieHeader: null, acceptLanguage: 'ja', instanceDefault: 'es' }), 'es');
    assert.equal(resolveMovedPageLanguage({ cookieHeader: null, acceptLanguage: null, instanceDefault: 'de' }), 'de');
  });
});

/** The `moved` block every catalog carries. */
const movedCatalogSchema = z.object({
  moved: z.object({
    title: z.string(),
    body: z.string(),
    signIn: z.string(),
    homeScreen: z.string(),
    iphone: z.string(),
    android: z.string(),
  }),
});

/** One shipped catalog's `moved` block, read off disk rather than through the module under test. */
function catalogMoved(language: string): z.infer<typeof movedCatalogSchema>['moved'] {
  const path = fileURLToPath(new URL(`../../app/i18n/locales/${language}/common.json`, import.meta.url));
  return movedCatalogSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).moved;
}

describe('movedPageCopy', () => {
  const HOST = 'app.openplate.example';

  for (const language of SUPPORTED_LANGUAGES) {
    it(`draws the ${language} catalog with the host written in, and no placeholder left`, () => {
      const copy = movedPageCopy({ language, host: HOST });
      const catalog = catalogMoved(language);
      assert.equal(copy.title, catalog.title);
      assert.equal(copy.body, catalog.body.replaceAll('{{host}}', HOST));
      for (const text of [copy.body, copy.signIn, copy.homeScreen]) {
        assert.ok(text.includes(HOST), `${language}: "${text}" names the new host`);
      }
      for (const text of Object.values(copy)) {
        assert.doesNotMatch(text, /\{\{/, `${language}: "${text}" has a placeholder left in it`);
      }
    });
  }

  it('control: the English catalog really carries the placeholder the host replaces', () => {
    assert.match(catalogMoved('en').body, /\{\{host\}\}/);
  });
});
