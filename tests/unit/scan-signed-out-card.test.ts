/**
 * THE DECISION M204 SPEC 07 ASKED FOR, WRITTEN AS A TEST.
 *
 * ── The contradiction ────────────────────────────────────────────────────
 *
 * `/scan` carried a `managed-signed-out` card for a signed-out visitor on a
 * managed instance, with a link back to `/sign-in`. A browser walk of
 * production 0.26.0 today proved nobody could ever read it: signing out of a
 * managed instance writes the device lock, and `_personal.tsx`'s gate turns
 * every personal route, `/scan` included, into a redirect to `/welcome`
 * before the route body renders. Commit 5d1940c removed the identical dead
 * state from `/describe` and `/add` in M204 spec 01; this is the same
 * decision for the one screen it had not reached yet.
 *
 * ── What was decided ─────────────────────────────────────────────────────
 *
 * The card was REMOVED and the gate was left alone, for the same reason the
 * M204 spec 01 worklog gives: the alternative was an exception to the lock
 * for `/scan`, and that would hand the next person on a shared device the
 * last account holder's diary. `ConnectCardVariant` lost its
 * `managed-signed-out` member, `resolveConnectCardVariant` stops branching on
 * a signed-out session, and both locales lost the sentence.
 *
 * EVERY ASSERTION HAS A CONTROL. A source grep that always passes, or a
 * catalog check against an empty object, proves nothing, so each check here
 * is paired with one that fails if the grep or the key list stops meaning
 * anything.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SCAN_ROUTE_PATH = fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url));
const SCAN_SOURCE = readFileSync(SCAN_ROUTE_PATH, 'utf8');

/** The one namespace this file reads, parsed at the file boundary rather than asserted. */
const catalogSchema = z.object({
  scan: z.object({
    setup: z.record(z.string(), z.unknown()),
  }),
});

/** Every locale the app ships, read as shipped. */
const CATALOGS = ['en', 'de'].map((locale) => ({
  locale,
  setup: catalogSchema.parse(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url)), 'utf8'),
    ),
  ).scan.setup,
}));

describe('scan.tsx carries no managed-signed-out card', () => {
  it('has no managed-signed-out marker left in the route source', () => {
    assert.ok(
      !SCAN_SOURCE.includes('managed-signed-out'),
      'the managed-signed-out variant, or a branch selecting it, is still in scan.tsx',
    );
  });

  it('still carries the door variant that IS reachable, as the control', () => {
    // THE CONTROL. Without it, the assertion above passes against a file that
    // was emptied, truncated, or never read at all, and a grep with no positive
    // match proves nothing about the file it ran against.
    assert.ok(SCAN_SOURCE.includes('managed-missing'), 'scan.tsx lost the managed-missing door too');
    assert.ok(SCAN_SOURCE.includes('_personal'), 'scan.tsx lost its reference to the layout that makes the card dead');
  });
});

describe('the strings that card used are gone from every locale', () => {
  it('carries no managedSignedOut key under scan.setup', () => {
    for (const { locale, setup } of CATALOGS) {
      assert.equal(
        'managedSignedOut' in setup,
        false,
        `${locale} still carries scan.setup.managedSignedOut, for a card that cannot be reached`,
      );
    }
  });

  it('still carries the managedMissing keys that ARE reachable', () => {
    // THE CONTROL. Without it the assertion above passes against a catalog
    // that failed to parse, an emptied `scan.setup` object, or a renamed
    // namespace, none of which say anything about the key this test is for.
    for (const { locale, setup } of CATALOGS) {
      assert.ok('managedMissing' in setup, `${locale} lost scan.setup.managedMissing`);
    }
  });
});
