/**
 * Unit tests for `#app/lib/shared-photo` — the pure query-string helpers behind
 * the Web Share Target flow (flag detection + URL cleaning). The cache reader
 * (`readSharedPhoto`) is browser-shaped and exercised in device testing, not
 * here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildUrlWithoutSharedParam, hasSharedPhotoFlag } from '../../app/lib/shared-photo';

describe('hasSharedPhotoFlag', () => {
  it('is true for ?shared=1', () => {
    assert.equal(hasSharedPhotoFlag('?shared=1'), true);
  });

  it('is true when other params are present alongside shared=1', () => {
    assert.equal(hasSharedPhotoFlag('?date=2026-07-14&shared=1'), true);
  });

  it('is false when shared has any other value', () => {
    assert.equal(hasSharedPhotoFlag('?shared=0'), false);
    assert.equal(hasSharedPhotoFlag('?shared=true'), false);
  });

  it('is false when the flag is absent', () => {
    assert.equal(hasSharedPhotoFlag(''), false);
    assert.equal(hasSharedPhotoFlag('?date=2026-07-14'), false);
  });
});

describe('buildUrlWithoutSharedParam', () => {
  it('drops the only param and returns a bare pathname', () => {
    assert.equal(buildUrlWithoutSharedParam('/scan', '?shared=1'), '/scan');
  });

  it('preserves other params while removing shared', () => {
    assert.equal(buildUrlWithoutSharedParam('/scan', '?date=2026-07-14&shared=1'), '/scan?date=2026-07-14');
  });

  it('returns the bare pathname when there was no query string', () => {
    assert.equal(buildUrlWithoutSharedParam('/scan', ''), '/scan');
  });

  it('leaves a query string with no shared flag untouched in content', () => {
    assert.equal(buildUrlWithoutSharedParam('/scan', '?date=2026-07-14'), '/scan?date=2026-07-14');
  });
});
