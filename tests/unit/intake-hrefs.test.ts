/**
 * Unit tests for `#app/lib/intake-hrefs`, the one builder behind every
 * add-food destination: the composer, the scan screen and the diary day.
 *
 * It replaced three copies of the same two rules (`speakHref`,
 * `diaryHrefForDate`, `describeScanHref`), so the cases those three carried are
 * kept here, including the `/diary` today-versus-other-day pair that
 * `tests/unit/diary-href.test.ts` used to own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildIntakeHref } from '../../app/lib/intake-hrefs';
import { INTAKE_CONSUMERS } from '../../app/lib/intake-consumers';

/** The `to` parameter a built href carries, decoded, or `null` when it carries none. */
function consumerParam(href: string): string | null {
  const [, query = ''] = href.split('?');
  return new URLSearchParams(query).get('to');
}

describe('buildIntakeHref', () => {
  it('leaves the path bare when nothing is passed', () => {
    assert.strictEqual(buildIntakeHref('/describe'), '/describe');
    assert.strictEqual(buildIntakeHref('/scan', {}), '/scan');
  });

  it('leaves the path bare when the day is today, on either spelling of today', () => {
    // `null` is "the screen carries no day", and an explicit day equal to
    // today is the diary's spelling of the same thing.
    assert.strictEqual(buildIntakeHref('/scan', { date: null }), '/scan');
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-14', today: '2026-07-14' }), '/diary');
  });

  it('carries a back-dated day as ?date=', () => {
    assert.strictEqual(buildIntakeHref('/scan', { date: '2026-09-07' }), '/scan?date=2026-09-07');
    assert.strictEqual(buildIntakeHref('/describe', { date: '2026-09-07' }), '/describe?date=2026-09-07');
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-10', today: '2026-07-14' }), '/diary?date=2026-07-10');
  });

  it('carries a future day the same way as a past one', () => {
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-20', today: '2026-07-14' }), '/diary?date=2026-07-20');
  });

  it('adds speak=1 to a bare destination', () => {
    assert.strictEqual(buildIntakeHref('/describe', { speak: true }), '/describe?speak=1');
  });

  it('omits speak entirely when it was not asked for', () => {
    assert.strictEqual(buildIntakeHref('/describe', { speak: false }), '/describe');
  });

  it('keeps a query the path already carries', () => {
    assert.strictEqual(
      buildIntakeHref('/describe?date=2026-09-07', { speak: true }),
      '/describe?date=2026-09-07&speak=1',
    );
  });

  it('does not add a second speak=1', () => {
    assert.strictEqual(buildIntakeHref('/describe?speak=1', { speak: true }), '/describe?speak=1');
  });

  it('carries the day and the speak flag together', () => {
    assert.strictEqual(buildIntakeHref('/describe', { date: '2026-09-07', speak: true }), '/describe?date=2026-09-07&speak=1');
  });

  it('writes a slot as meal=, and only when one is given', () => {
    assert.strictEqual(buildIntakeHref('/describe', { date: '2026-09-07', slot: 'lunch' }), '/describe?date=2026-09-07&meal=lunch');
    assert.strictEqual(buildIntakeHref('/describe', { slot: 'lunch' }), '/describe?meal=lunch');
    assert.doesNotMatch(buildIntakeHref('/describe', { date: '2026-09-07' }), /meal=/);
  });

  it('names a non-default consumer as to=, and a URL-encoded one is read back whole', () => {
    // M233/01. `URLSearchParams` percent-encodes the slash, so the literal in
    // the href is `to=%2Fpantry`; what matters is the value a browser parses
    // back out of it, which is the path the composer will navigate to.
    const href = buildIntakeHref('/describe', { to: '/pantry' });
    assert.strictEqual(href, '/describe?to=%2Fpantry');
    assert.strictEqual(consumerParam(href), '/pantry');
    assert.strictEqual(consumerParam(buildIntakeHref('/describe', { date: '2026-09-07', to: '/pantry' })), '/pantry');
  });

  it('writes nothing for the diary, whose bare URL already means /scan', () => {
    // The control for the pair above: with an unconditional `params.set`, the
    // first assertion below would read `/describe?to=%2Fscan` and every diary
    // link in the app would grow a parameter that says what it already said.
    assert.strictEqual(buildIntakeHref('/describe', { to: '/scan' }), '/describe');
    assert.strictEqual(consumerParam(buildIntakeHref('/describe', { to: '/scan' })), null);
    assert.strictEqual(consumerParam(buildIntakeHref('/describe', { speak: true })), null);
    // And the list itself is the two the app owns, so a third consumer has to
    // be added here as well as in the allowlist.
    assert.deepStrictEqual([...INTAKE_CONSUMERS], ['/scan', '/pantry']);
  });
});
