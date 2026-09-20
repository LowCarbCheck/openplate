/**
 * THE LEGAL TEXT NAMES EVERY KIND OF THING THAT SYNCS (M240 counsel item 5).
 *
 * ── The failure this makes impossible ────────────────────────────────────
 *
 * The privacy policy and the terms enumerate what lives on the device and what
 * the account holds an encrypted copy of. For most of this app's life those
 * lists said "foods, food logs, weight entries and goals" while the blob also
 * carried saved meals, activity marks, awards and the sealed sharing and
 * research keys. M240 added fasts and the pantry beside them and the omission
 * was finally fixed by hand, which is exactly the fix that rots: the next kind
 * somebody merges will be merged in `snapshot-sync.ts`, and nobody editing
 * that file has any reason to open a locale catalog.
 *
 * So the mapping is a TABLE here, and the table is checked against the code:
 *
 *  1. every tag in `SYNC_ENTITY_TYPES`, every pass-through collection and
 *     every owner-private row has an entry, so a new synced kind fails this
 *     test until somebody decides what to call it for a reader; and
 *  2. every term the table names appears in `privacy.s2Body1`, which is the
 *     paragraph that enumerates what is stored on the device.
 *
 * Claim 1 is the one with teeth. It cannot be satisfied by editing the
 * catalog, only by editing this table, and editing this table is where a
 * person is asked the question the code cannot answer: what do you call this
 * to somebody reading a privacy policy?
 *
 * ── Why `privacy.s2Body1` and not all eight ─────────────────────────────
 *
 * The eight enumerations differ in scope. The managed pair speaks about a
 * server copy, `terms.s2Body` mentions an AI key the managed one does not
 * have, and `s3Outro` is a sentence about what is NOT stored in readable form.
 * Pinning every term into every one of them would pin the sentences, which is
 * wordsmith's to rewrite. One paragraph, the one whose whole job is the list,
 * is the claim that survives a rewrite of the other seven.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import enLegal from '../../app/i18n/locales/en/legal.json';
import { SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';
import { EMPTY_OWNER_PRIVATE_REGION, SNAPSHOT_KEY_REGIONS } from '../../app/lib/sync/snapshot-partition';

/**
 * EVERY COLLECTION THAT TRAVELS, paired with the English words the policy uses
 * for it.
 *
 * The key is the sync entity tag for a merged kind, the snapshot key for a
 * pass-through one, and `privateStore` for the sealed compartment. The value
 * is a phrase that must appear in `privacy.s2Body1`, lower-cased before the
 * search so a term at the start of a sentence still matches.
 *
 * `profile` and `fastingSettings` share "goals" and "fasting routine" with
 * nothing else; `activityMark` and `award` share one phrase, "streaks and
 * awards", because that is what the app itself calls them on the record
 * screen and splitting them for a policy would name a distinction no reader
 * has.
 */
const LEGAL_TERM_BY_KIND = {
  // The merged entities, by their `SYNC_ENTITY_TYPES` tag.
  personalFood: 'foods',
  foodLog: 'food logs',
  weightEntry: 'weight entries',
  profile: 'profile/goals',
  fast: 'fasts',
  pantryItem: 'pantry',
  fastingSettings: 'fasting routine',
  activityMark: 'streaks and awards',
  award: 'streaks and awards',
  privateStore: 'sharing and research keys',
  // The pass-through collection, by its snapshot key. It is not in
  // `SYNC_ENTITY_TYPES` and it travels all the same.
  savedMeals: 'saved meals',
} satisfies Record<string, string>;

/** The table's own keys, as plain strings, so a tag the code has and the table lacks can be found. */
const NAMED_KINDS: readonly string[] = Object.keys(LEGAL_TERM_BY_KIND);

/** The paragraph whose whole job is to list what the device holds. */
const S2_BODY1 = enLegal.privacy.s2Body1.toLowerCase();

/**
 * The snapshot keys that travel but own no `SYNC_ENTITY_TYPES` tag.
 *
 * `savedMeals` is the last pass-through collection. The four owner-private
 * keys travel INSIDE the sealed compartment rather than as entities of their
 * own, so they are covered by the `privateStore` entry above and are listed
 * here only so a fifth one added to that region fails this test.
 */
const UNTAGGED_TRAVELLERS: readonly string[] = [
  'savedMeals',
  ...Object.keys(EMPTY_OWNER_PRIVATE_REGION),
];

describe('the legal enumerations name everything that syncs', () => {
  it('has a term for every MERGED entity kind the engine carries', () => {
    const missing: string[] = Object.values(SYNC_ENTITY_TYPES).filter((tag) => !NAMED_KINDS.includes(tag));

    assert.deepEqual(
      missing,
      [],
      'a new synced kind reached the blob without anybody deciding what to call it in the privacy policy',
    );
  });

  it('has a term for the pass-through collection and for the sealed compartment', () => {
    // The owner-private rows are covered by the one `privateStore` entry, so
    // the assertion is that the region is the shape that entry describes.
    assert.ok(NAMED_KINDS.includes('privateStore'));
    assert.ok(NAMED_KINDS.includes('savedMeals'));
    assert.deepEqual(
      UNTAGGED_TRAVELLERS.toSorted(),
      ['researchIdentity', 'savedMeals', 'shareIdentity', 'sharePeers', 'studyEnrolments'],
      'a fifth owner-private row would ride in the sealed compartment with nothing said about it',
    );
  });

  it('names every term in privacy.s2Body1', () => {
    const absent = [...new Set(Object.values(LEGAL_TERM_BY_KIND))].filter((term) => !S2_BODY1.includes(term));

    assert.deepEqual(absent, [], 'the paragraph that lists what is on the device does not list all of it');
  });

  it('THE CONTROL: the probe really would notice a missing term', () => {
    // Without this, "every term appears" would pass just as happily against a
    // search that matched anything, or against a paragraph this test was not
    // actually reading.
    assert.equal(S2_BODY1.includes('fasting routine'), true, 'the probe cannot see the paragraph at all');
    assert.equal(
      S2_BODY1.includes('a kind nobody has written yet'),
      false,
      'the probe says yes to anything, so it proves nothing',
    );
  });

  it('THE CONTROL: the table is read from the CODE, not from a copy of it', () => {
    // `SYNC_ENTITY_TYPES` is the map `flattenSnapshot` and `toCandidateMap`
    // read, so a kind that is in it is a kind that travels. This pins that the
    // test is looking at that map rather than at a literal list of tags a
    // future edit would leave behind.
    assert.equal(SYNC_ENTITY_TYPES.pantryItem, 'pantryItem');
    assert.equal(
      SNAPSHOT_KEY_REGIONS.savedMeals,
      'shared',
      'saved meals are in the shareable region, which is what makes them travel',
    );
  });
});
