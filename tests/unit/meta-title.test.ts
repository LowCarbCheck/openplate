/**
 * Unit tests for `#app/i18n/meta-title` — the pure `(language, key)` lookup a
 * route's `meta()` translates its `<title>` through.
 *
 * The whole point of the module is that it is NOT the i18next singleton, so
 * these tests exist to pin the two properties that matter: it answers per
 * call (never per process), and a junk/absent language degrades to English
 * rather than throwing inside the document head.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { metaLanguage, metaTitle } from '../../app/i18n/meta-title';

/** Everything the root loader's `language` field has been observed to hold, tampering included. */
type RootLanguageValue = string | number | null | undefined;

/** A `matches` array shaped like the one React Router hands `meta()`. */
function matches(language: RootLanguageValue, { withRoot = true }: { withRoot?: boolean } = {}) {
  return [
    ...(withRoot ? [{ id: 'root', loaderData: { language } }] : []),
    { id: 'routes/diary', loaderData: { days: [] } },
  ];
}

describe('metaTitle', () => {
  it('translates a key into English', () => {
    assert.strictEqual(metaTitle('en', 'meta.diary'), 'Diary · openplate');
  });

  it('translates the same key into German', () => {
    assert.strictEqual(metaTitle('de', 'meta.diary'), 'Tagebuch · openplate');
  });

  it('answers per call, so two languages never contend for one process-wide state', () => {
    // The bug this module exists to prevent: request A setting the singleton's
    // language and request B rendering its title in it. `meta.trends` is a
    // placeholder in German right now (M239/02, spec 07 translates it), so
    // both languages currently answer the same string. The property under
    // test, that a second call for a DIFFERENT language never reads back the
    // first call's cached answer, is still exercised below with `meta.diary`,
    // which the two languages do say differently.
    const first = metaTitle('de', 'meta.trends');
    const second = metaTitle('en', 'meta.trends');
    assert.strictEqual(first, 'Insights · openplate');
    assert.strictEqual(second, 'Insights · openplate');
    assert.strictEqual(metaTitle('de', 'meta.trends'), first);

    const firstDiary = metaTitle('de', 'meta.diary');
    const secondDiary = metaTitle('en', 'meta.diary');
    assert.strictEqual(firstDiary, 'Tagebuch · openplate');
    assert.strictEqual(secondDiary, 'Diary · openplate');
    assert.strictEqual(metaTitle('de', 'meta.diary'), firstDiary);
  });

  it('falls back to English for an unsupported or tampered language', () => {
    assert.strictEqual(metaTitle('pt', 'meta.settings'), 'Settings · openplate');
    assert.strictEqual(metaTitle(null, 'meta.settings'), 'Settings · openplate');
    assert.strictEqual(metaTitle(undefined, 'meta.settings'), 'Settings · openplate');
  });

  it('titles the two pages the goals page split into, in both languages', () => {
    // M215 spec 03. `meta.goals` went with the page, so a route that still
    // asked for it would render the key itself, which the test below shows is
    // what an unknown key does here.
    assert.strictEqual(metaTitle('en', 'meta.profile'), 'About you · openplate');
    assert.strictEqual(metaTitle('de', 'meta.profile'), 'Über dich · openplate');
    assert.strictEqual(metaTitle('en', 'meta.nutrition'), 'Eating and targets · openplate');
    assert.strictEqual(metaTitle('de', 'meta.nutrition'), 'Ernährung und Ziele · openplate');
    // CONTROL: the retired key is gone from both catalogs, so nothing can go
    // on rendering the old title while claiming to be one of these pages.
    assert.strictEqual(metaTitle('en', 'meta.goals'), 'meta.goals');
    assert.strictEqual(metaTitle('de', 'meta.goals'), 'meta.goals');
  });

  it('returns the key itself for an unknown key rather than throwing', () => {
    assert.strictEqual(metaTitle('de', 'meta.nope'), 'meta.nope');
    assert.strictEqual(metaTitle('de', ''), '');
  });

  it('never returns a nested object as a title', () => {
    // `meta` is a branch, not a leaf — resolving it must miss, not stringify.
    assert.strictEqual(metaTitle('en', 'meta'), 'meta');
  });
});

describe('metaLanguage', () => {
  it("reads the language off the root match's loader data", () => {
    assert.strictEqual(metaLanguage(matches('de')), 'de');
    assert.strictEqual(metaLanguage(matches('en')), 'en');
  });

  it('falls back to English when the root match is missing, empty, or sparse', () => {
    assert.strictEqual(metaLanguage(matches('de', { withRoot: false })), 'en');
    assert.strictEqual(metaLanguage([]), 'en');
    assert.strictEqual(metaLanguage(undefined), 'en');
    assert.strictEqual(metaLanguage([undefined]), 'en');
  });

  it('falls back to English when the root loader never ran (error boundary)', () => {
    assert.strictEqual(metaLanguage([{ id: 'root', loaderData: undefined }]), 'en');
    assert.strictEqual(metaLanguage([{ id: 'root' }]), 'en');
  });

  it('falls back to English for a junk language — the cookie is not httpOnly', () => {
    assert.strictEqual(metaLanguage(matches('pt')), 'en');
    assert.strictEqual(metaLanguage(matches(42)), 'en');
    assert.strictEqual(metaLanguage(matches(null)), 'en');
  });

  it('composes with metaTitle the way a route uses it', () => {
    assert.strictEqual(metaTitle(metaLanguage(matches('de')), 'meta.scan'), 'Teller scannen · openplate');
    assert.strictEqual(metaTitle(metaLanguage(matches('xx')), 'meta.scan'), 'Scan your plate · openplate');
  });
});
