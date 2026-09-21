/**
 * Unit tests for `#app/lib/intake-hrefs`, the one builder behind every
 * add-food destination: the composer, the photo screen and the diary day.
 *
 * It replaced three copies of the same two rules (`speakHref`,
 * `diaryHrefForDate`, `describeScanHref`), so the cases those three carried are
 * kept here, including the `/diary` today-versus-other-day pair that
 * `tests/unit/diary-href.test.ts` used to own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, buildIntakeHref } from '../../app/lib/intake-hrefs';
import { INTAKE_CONSUMERS } from '../../app/lib/intake-consumers';

/** The `to` parameter a built href carries, decoded, or `null` when it carries none. */
function consumerParam(href: string): string | null {
  const [, query = ''] = href.split('?');
  return new URLSearchParams(query).get('to');
}

describe('buildIntakeHref', () => {
  it('leaves the path bare when nothing is passed', () => {
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH), ADD_DESCRIBE_PATH);
    assert.strictEqual(buildIntakeHref(ADD_PHOTO_PATH, {}), ADD_PHOTO_PATH);
  });

  it('leaves the path bare when the day is today, on either spelling of today', () => {
    // `null` is "the screen carries no day", and an explicit day equal to
    // today is the diary's spelling of the same thing.
    assert.strictEqual(buildIntakeHref(ADD_PHOTO_PATH, { date: null }), ADD_PHOTO_PATH);
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-14', today: '2026-07-14' }), '/diary');
  });

  it('carries a back-dated day as ?date=', () => {
    assert.strictEqual(buildIntakeHref(ADD_PHOTO_PATH, { date: '2026-09-07' }), `${ADD_PHOTO_PATH}?date=2026-09-07`);
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH, { date: '2026-09-07' }), `${ADD_DESCRIBE_PATH}?date=2026-09-07`);
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-10', today: '2026-07-14' }), '/diary?date=2026-07-10');
  });

  it('carries a future day the same way as a past one', () => {
    assert.strictEqual(buildIntakeHref('/diary', { date: '2026-07-20', today: '2026-07-14' }), '/diary?date=2026-07-20');
  });

  it('adds speak=1 to a bare destination', () => {
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH, { speak: true }), `${ADD_DESCRIBE_PATH}?speak=1`);
  });

  it('omits speak entirely when it was not asked for', () => {
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH, { speak: false }), ADD_DESCRIBE_PATH);
  });

  it('keeps a query the path already carries', () => {
    assert.strictEqual(
      buildIntakeHref(`${ADD_DESCRIBE_PATH}?date=2026-09-07`, { speak: true }),
      `${ADD_DESCRIBE_PATH}?date=2026-09-07&speak=1`,
    );
  });

  it('does not add a second speak=1', () => {
    assert.strictEqual(buildIntakeHref(`${ADD_DESCRIBE_PATH}?speak=1`, { speak: true }), `${ADD_DESCRIBE_PATH}?speak=1`);
  });

  it('carries the day and the speak flag together', () => {
    assert.strictEqual(
      buildIntakeHref(ADD_DESCRIBE_PATH, { date: '2026-09-07', speak: true }),
      `${ADD_DESCRIBE_PATH}?date=2026-09-07&speak=1`,
    );
  });

  it('writes a slot as meal=, and only when one is given', () => {
    assert.strictEqual(
      buildIntakeHref(ADD_DESCRIBE_PATH, { date: '2026-09-07', slot: 'lunch' }),
      `${ADD_DESCRIBE_PATH}?date=2026-09-07&meal=lunch`,
    );
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH, { slot: 'lunch' }), `${ADD_DESCRIBE_PATH}?meal=lunch`);
    assert.doesNotMatch(buildIntakeHref(ADD_DESCRIBE_PATH, { date: '2026-09-07' }), /meal=/);
  });

  it('names a non-default consumer as to=, and a URL-encoded one is read back whole', () => {
    // M233/01. `URLSearchParams` percent-encodes the slash, so the literal in
    // the href is `to=%2Fpantry`; what matters is the value a browser parses
    // back out of it, which is the path the composer will navigate to.
    const href = buildIntakeHref(ADD_DESCRIBE_PATH, { to: '/pantry' });
    assert.strictEqual(href, `${ADD_DESCRIBE_PATH}?to=%2Fpantry`);
    assert.strictEqual(consumerParam(href), '/pantry');
    assert.strictEqual(consumerParam(buildIntakeHref(ADD_DESCRIBE_PATH, { date: '2026-09-07', to: '/pantry' })), '/pantry');
  });

  it('writes nothing for the diary, whose bare URL already means /add/photo', () => {
    // The control for the pair above: with an unconditional `params.set`, the
    // first assertion below would read `/add/describe?to=%2Fadd%2Fphoto` and
    // every diary link in the app would grow a parameter that says what it
    // already said.
    assert.strictEqual(buildIntakeHref(ADD_DESCRIBE_PATH, { to: ADD_PHOTO_PATH }), ADD_DESCRIBE_PATH);
    assert.strictEqual(consumerParam(buildIntakeHref(ADD_DESCRIBE_PATH, { to: ADD_PHOTO_PATH })), null);
    assert.strictEqual(consumerParam(buildIntakeHref(ADD_DESCRIBE_PATH, { speak: true })), null);
    // And the list itself is the two the app owns, so a third consumer has to
    // be added here as well as in the allowlist.
    assert.deepStrictEqual([...INTAKE_CONSUMERS], [ADD_PHOTO_PATH, '/pantry']);
  });
});
