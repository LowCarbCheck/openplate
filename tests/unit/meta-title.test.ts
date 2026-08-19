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
    // language and request B rendering its title in it.
    const first = metaTitle('de', 'meta.trends');
    const second = metaTitle('en', 'meta.trends');
    assert.strictEqual(first, 'Fortschritt · openplate');
    assert.strictEqual(second, 'Progress · openplate');
    assert.strictEqual(metaTitle('de', 'meta.trends'), first);
  });

  it('falls back to English for an unsupported or tampered language', () => {
    assert.strictEqual(metaTitle('fr', 'meta.settings'), 'Settings · openplate');
    assert.strictEqual(metaTitle(null, 'meta.settings'), 'Settings · openplate');
    assert.strictEqual(metaTitle(undefined, 'meta.settings'), 'Settings · openplate');
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
    assert.strictEqual(metaLanguage(matches('fr')), 'en');
    assert.strictEqual(metaLanguage(matches(42)), 'en');
    assert.strictEqual(metaLanguage(matches(null)), 'en');
  });

  it('composes with metaTitle the way a route uses it', () => {
    assert.strictEqual(metaTitle(metaLanguage(matches('de')), 'meta.scan'), 'Teller scannen · openplate');
    assert.strictEqual(metaTitle(metaLanguage(matches('xx')), 'meta.scan'), 'Scan your plate · openplate');
  });
});
