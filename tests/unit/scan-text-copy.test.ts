/**
 * The scan screen's shared sentences, said about the right subject.
 *
 * Three ways in reach this screen and only one of them has a photograph. Every
 * sentence that names one is false for the other two: "Couldn't identify any
 * foods in that photo. Try a clearer shot." is advice nobody can act on about
 * a meal they typed, and it is the message a typed intake got.
 *
 * TWO KINDS OF FIX, and both are checked here:
 *
 *  - A TWIN, where each subject needs its own sentence. `noFoodsErrorKey` and
 *    `identifyFailedErrorKey` pick it, so the choice is a pure function rather
 *    than a branch buried in a render.
 *  - A NEUTRAL REWRITE, where one sentence is true of both. Those keys are
 *    asserted to have stopped naming a photograph at all, which is a claim
 *    about the shipped catalog and cannot be made by reading code.
 *
 * Every assertion has its control: the photo subject must still get the photo
 * sentence, or a helper that returned the text key for everything would pass.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { identifyFailedErrorKey, intakeSubjectOf, noFoodsErrorKey } from '../../app/routes/scan';

type Catalog = { [key: string]: string | Catalog };
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const EN = catalogSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

/** The English string at a dotted key, asserted to exist. */
function copy(key: string): string {
  let node: string | Catalog | undefined = EN;
  for (const part of key.split('.')) {
    const group = catalogSchema.safeParse(node);
    if (!group.success) break;
    node = group.data[part];
  }
  const leaf = z.string().safeParse(node);
  assert.ok(leaf.success, `the English catalog is missing ${key}`);
  return leaf.data;
}

const SCAN_ROUTE = readFileSync(new URL('../../app/routes/scan.tsx', import.meta.url), 'utf8');

/** Words that can only be true of a photograph. */
const NAMES_A_PHOTOGRAPH = /\b(photo|photos|photograph|picture|plate|shot)\b/i;

describe('the subject of a message', () => {
  it('is the photograph only for a photo intake', () => {
    assert.equal(intakeSubjectOf('photo'), 'photo');
    assert.equal(intakeSubjectOf('text'), 'text');
    // A spoken meal is a sentence by the time any of this renders.
    assert.equal(intakeSubjectOf('speech'), 'text');
  });
});

describe('the two twinned failures', () => {
  it('tells a typed meal it could not be identified, without mentioning a photo', () => {
    assert.equal(identifyFailedErrorKey('text'), 'scan.errors.identifyFailedText');
    assert.doesNotMatch(copy('scan.errors.identifyFailedText'), NAMES_A_PHOTOGRAPH);
  });

  it('still tells a photograph the same thing about the photo', () => {
    // The control: a helper that returned the text key for both subjects, or a
    // catalog that neutered the photo sentence, fails here.
    assert.equal(identifyFailedErrorKey('photo'), 'scan.errors.identifyFailed');
    assert.match(copy('scan.errors.identifyFailed'), NAMES_A_PHOTOGRAPH);
  });

  it('tells a typed meal nothing was found in the DESCRIPTION, and says what to try', () => {
    assert.equal(noFoodsErrorKey('text'), 'scan.errors.noFoodsText');
    const message = copy('scan.errors.noFoodsText');
    assert.doesNotMatch(message, NAMES_A_PHOTOGRAPH, 'a typed meal is still told to take a clearer shot');
    assert.match(message, /descri/i, 'the message no longer names what was actually read');
  });

  it('still tells a photograph to try a clearer shot', () => {
    assert.equal(noFoodsErrorKey('photo'), 'scan.errors.noFoods');
    assert.match(copy('scan.errors.noFoods'), NAMES_A_PHOTOGRAPH);
  });

  it('is wired at every place the two messages are produced', () => {
    // The action's empty-result arm, its generic failure arm, and the
    // component's "came back with nothing at all" arm. A twin that exists in
    // the catalog and is never chosen is worse than no twin.
    assert.match(SCAN_ROUTE, /error: translate\(noFoodsErrorKey\(intakeSubjectOf\(intakeSource\)\)\)/);
    assert.match(SCAN_ROUTE, /translate\(identifyFailedErrorKey\(intakeKind\)\)/);
    assert.match(SCAN_ROUTE, /didSettleWithNothing \? t\(identifyFailedErrorKey\(/);
    // And the failure UI resolves the SAME key it compares against, or a typed
    // meal would show its friendly headline with the sentence repeated below.
    assert.match(SCAN_ROUTE, /error !== t\(noFoodsErrorKey\(isTextIntake \? 'text' : 'photo'\)\)/);
  });
});

describe('the in-flight stages', () => {
  it('gives the typed intake its own middle stage', () => {
    assert.doesNotMatch(copy('scan.analyzing.analyzingText'), NAMES_A_PHOTOGRAPH);
    // The control: the photo path keeps the sentence about the plate.
    assert.match(copy('scan.analyzing.analyzing'), NAMES_A_PHOTOGRAPH);
    assert.match(
      SCAN_ROUTE,
      /kind === 'text' \? t\('scan\.analyzing\.analyzingText'\) : t\('scan\.analyzing\.analyzing'\)/,
    );
  });

  it('keeps the last stage shared, because it names neither', () => {
    assert.doesNotMatch(copy('scan.analyzing.stillWorking'), NAMES_A_PHOTOGRAPH);
  });
});

describe('the sentences that were rewritten instead of twinned', () => {
  // Each of these is true of a typed meal and a photograph alike, so it says
  // neither. A twin would have been two strings to keep in step for no gain.
  for (const key of [
    'scan.errors.connectProvider',
    'scan.errors.provider.aiNotAllowed',
    'scan.errors.provider.rateLimitMinute',
    'scan.errors.provider.allowanceSpent',
    'scan.errors.titles.aiNotAllowed',
  ]) {
    it(`${key} no longer names a photograph`, () => {
      assert.doesNotMatch(copy(key), NAMES_A_PHOTOGRAPH);
    });
  }

  it('leaves the genuinely photo-only messages alone', () => {
    // The control over the loop above: this file must not read as "no scan
    // string may say photo". A photo that is too large for the server is about
    // a photo, and a typed meal can never reach it.
    assert.match(copy('scan.errors.provider.photoTooLarge'), NAMES_A_PHOTOGRAPH);
    assert.match(copy('scan.errors.photo.unreadable'), NAMES_A_PHOTOGRAPH);
  });
});
