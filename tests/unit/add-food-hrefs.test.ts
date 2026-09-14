/**
 * Unit tests for `#app/lib/add-food-hrefs`, the one builder behind every
 * add-food destination: the composer, the scan screen and the diary day.
 *
 * It replaced three copies of the same two rules (`speakHref`,
 * `diaryHrefForDate`, `describeScanHref`), so the cases those three carried are
 * kept here, including the `/diary` today-versus-other-day pair that
 * `tests/unit/diary-href.test.ts` used to own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildAddHref } from '../../app/lib/add-food-hrefs';

describe('buildAddHref', () => {
  it('leaves the path bare when nothing is passed', () => {
    assert.strictEqual(buildAddHref('/describe'), '/describe');
    assert.strictEqual(buildAddHref('/scan', {}), '/scan');
  });

  it('leaves the path bare when the day is today, on either spelling of today', () => {
    // `null` is "the screen carries no day", and an explicit day equal to
    // today is the diary's spelling of the same thing.
    assert.strictEqual(buildAddHref('/scan', { date: null }), '/scan');
    assert.strictEqual(buildAddHref('/diary', { date: '2026-07-14', today: '2026-07-14' }), '/diary');
  });

  it('carries a back-dated day as ?date=', () => {
    assert.strictEqual(buildAddHref('/scan', { date: '2026-09-07' }), '/scan?date=2026-09-07');
    assert.strictEqual(buildAddHref('/describe', { date: '2026-09-07' }), '/describe?date=2026-09-07');
    assert.strictEqual(buildAddHref('/diary', { date: '2026-07-10', today: '2026-07-14' }), '/diary?date=2026-07-10');
  });

  it('carries a future day the same way as a past one', () => {
    assert.strictEqual(buildAddHref('/diary', { date: '2026-07-20', today: '2026-07-14' }), '/diary?date=2026-07-20');
  });

  it('adds speak=1 to a bare destination', () => {
    assert.strictEqual(buildAddHref('/describe', { speak: true }), '/describe?speak=1');
  });

  it('omits speak entirely when it was not asked for', () => {
    assert.strictEqual(buildAddHref('/describe', { speak: false }), '/describe');
  });

  it('keeps a query the path already carries', () => {
    assert.strictEqual(
      buildAddHref('/describe?date=2026-09-07', { speak: true }),
      '/describe?date=2026-09-07&speak=1',
    );
  });

  it('does not add a second speak=1', () => {
    assert.strictEqual(buildAddHref('/describe?speak=1', { speak: true }), '/describe?speak=1');
  });

  it('carries the day and the speak flag together', () => {
    assert.strictEqual(buildAddHref('/describe', { date: '2026-09-07', speak: true }), '/describe?date=2026-09-07&speak=1');
  });

  it('writes a slot as meal=, and only when one is given', () => {
    assert.strictEqual(buildAddHref('/describe', { date: '2026-09-07', slot: 'lunch' }), '/describe?date=2026-09-07&meal=lunch');
    assert.strictEqual(buildAddHref('/describe', { slot: 'lunch' }), '/describe?meal=lunch');
    assert.doesNotMatch(buildAddHref('/describe', { date: '2026-09-07' }), /meal=/);
  });
});
