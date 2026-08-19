/**
 * Unit tests for `#app/lib/settings-return` — the pure `?next=` token→path
 * allowlist behind the AI settings page's post-save return. No DB, no React,
 * so these run under the no-database convention (mirrors `onboarding.test.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSettingsReturnPath } from '../../app/lib/settings-return';

describe('resolveSettingsReturnPath', () => {
  it('maps each known token to its in-app path', () => {
    assert.equal(resolveSettingsReturnPath('diary'), '/diary');
    assert.equal(resolveSettingsReturnPath('scan'), '/scan');
    assert.equal(resolveSettingsReturnPath('add'), '/add');
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
