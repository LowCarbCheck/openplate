/**
 * Unit tests for `#app/lib/settings-return` — the pure `?next=` token→path
 * allowlist behind the AI settings page's post-save return. No DB, no React,
 * so these run under the no-database convention (mirrors `onboarding.test.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSettingsReturnPath } from '../../app/lib/settings-return';
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, ADD_SEARCH_PATH } from '../../app/lib/intake-hrefs';

describe('resolveSettingsReturnPath', () => {
  it('maps each known token to its in-app path', () => {
    assert.equal(resolveSettingsReturnPath('diary'), '/diary');
    // The tokens are unchanged by ADR-0019's `/add` hub nesting, only the
    // paths they resolve to.
    assert.equal(resolveSettingsReturnPath('scan'), ADD_PHOTO_PATH);
    assert.equal(resolveSettingsReturnPath('add'), ADD_SEARCH_PATH);
    // The composer, so connecting a provider from there returns there rather
    // than dropping the person on the diary with their meal unwritten.
    assert.equal(resolveSettingsReturnPath('describe'), ADD_DESCRIBE_PATH);
  });

  it('returns null for an unknown, empty, or missing token (no fabricated redirect)', () => {
    assert.equal(resolveSettingsReturnPath('bogus'), null);
    assert.equal(resolveSettingsReturnPath(''), null);
    assert.equal(resolveSettingsReturnPath(null), null);
  });

  it('returns null for a raw path — tokens only, never an open redirect', () => {
    assert.equal(resolveSettingsReturnPath('/diary'), null);
    assert.equal(resolveSettingsReturnPath('/settings/ai'), null);
    assert.equal(resolveSettingsReturnPath('https://evil.example'), null);
  });
});
