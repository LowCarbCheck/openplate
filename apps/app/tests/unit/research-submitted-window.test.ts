/**
 * THE WINDOW A CONTRIBUTOR ACTUALLY SENT (M163/01).
 *
 * `LocalStudyEnrolment.lastSubmission` is the one fact on a pin that is not
 * recomputable and that the server cannot supply — `PROTOCOL.md` §5.18's
 * contribution row deliberately carries no window, because a window there
 * would tell the server the date range of a person's diary contribution. So
 * the device records it, and the whole correctness of the record is an
 * ORDERING: it is written only after the service accepted.
 *
 * That makes the interesting tests the NEGATIVE ones. Each rejection shape
 * gets its own assertion with its own message, so a defect that records on one
 * of them is distinguishable from a defect that records on all of them — an
 * "it recorded nothing" test with a single assertion would report the same
 * failure for both and diagnose neither.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { ResearchWindowLine } from '../../app/components/research-window-line';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup } from '../../app/lib/local-store/backup';
import { putLocalFood, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import type { LocalStoreSnapshot, LocalStudyEnrolment } from '../../app/lib/local-store/schema';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateEciesKeyPair } from '../../app/lib/sync/engine/crypto/ecies';
import { generatePseudonymRoot } from '../../app/lib/sync/research/pseudonym';
import {
  submitContribution,
  type ContributionCompartment,
  type ContributionSubmitResult,
  type ContributorTransport,
} from '../../app/lib/sync/research/contribute';

const STUDY_ACCOUNT_ID = 7;
const FROM_DAY = '2026-08-24';
const TO_DAY = '2026-08-26';
const ACCEPTED_AT = 1_756_400_000_000;

/** A window recorded by an EARLIER submission. Every rejection below must leave this exact object in place. */
const PREVIOUS_WINDOW = { fromDayKey: '2026-07-01', toDayKey: '2026-07-31', at: 1_754_000_000_000 };

async function buildSnapshot(): Promise<LocalStoreSnapshot> {
  const store = createPrimaryStore();
  await putLocalFood(
    {
      id: 'food-1',
      name: 'Acerola',
      brand: null,
      macrosPer100g: { carbs: 11, fiber: 1, sugars: null, polyols: null, protein: 0.4, fat: 0.3, kcal: 32 },
      source: 'user',
      createdAt: 1_000,
    },
    { store },
  );
  await putLocalFoodLog(
    {
      id: 'log-1',
      name: 'Acerola',
      quantityGrams: 250,
      macros: { carbs: 27.5, fiber: 2.5, sugars: null, polyols: null, protein: 0.1, fat: 0.75, kcal: 80 },
      mealType: 'snack',
      source: 'manual',
      aiEstimated: false,
      curatedSource: 'lowcarbcheck:acerola',
      foodId: 'food-1',
      dayKey: FROM_DAY,
      loggedAt: 1_756_000_000_000,
      createdAt: 1_756_000_000_000,
      logBatchId: null,
    },
    { store },
  );
  return (await exportBackup({ store })).data;
}

/** The owner-private compartment, in memory — and it COUNTS its writes, so "nothing was written" is a claim about the object rather than about a value. */
function recordingCompartment(enrolment: LocalStudyEnrolment): ContributionCompartment & {
  writes: LocalStudyEnrolment[];
  current: () => LocalStudyEnrolment;
} {
  const writes: LocalStudyEnrolment[] = [];
  let pinned = enrolment;
  return {
    writes,
    getEnrolment: async () => pinned,
    writeEnrolment: async (next) => {
      writes.push(next);
      pinned = next;
    },
    current: () => pinned,
  };
}

/** The transport, answering exactly one scripted outcome to the push. */
function transportAnswering(push: () => Promise<never> | ReturnType<ContributorTransport['putContribution']>) {
  const transport: ContributorTransport = {
    listMyContributions: async () => ({ status: 'available', value: [] }),
    putContribution: async () => push(),
  };
  return transport;
}

/** A dark deployment: the read itself is unavailable, so nothing is reduced, sealed or sent. */
const darkTransport: ContributorTransport = {
  listMyContributions: async () => ({ status: 'unavailable' }),
  putContribution: async () => {
    throw new Error('a dark lane must never be pushed to');
  },
};

async function submitWith({
  transport,
  compartment,
}: {
  transport: ContributorTransport;
  compartment: ContributionCompartment;
}): Promise<ContributionSubmitResult> {
  const study = await generateEciesKeyPair();
  return submitContribution({
    transport,
    compartment,
    enrolment: await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW),
    pseudonymRoot: generatePseudonymRoot(),
    snapshot: await buildSnapshot(),
    fromDayKey: FROM_DAY,
    toDayKey: TO_DAY,
    now: ACCEPTED_AT,
  });
}

async function pinnedStudy(
  publicKeyRaw: Uint8Array,
  lastSubmission: LocalStudyEnrolment['lastSubmission'],
): Promise<LocalStudyEnrolment> {
  return {
    id: String(STUDY_ACCOUNT_ID),
    studyAccountId: STUDY_ACCOUNT_ID,
    publicKeyRaw: bytesToBase64(publicKeyRaw),
    label: 'Charité sleep trial',
    createdAt: 1_756_000_000_000,
    lastSubmission,
  };
}

describe('an accepted submission', () => {
  it('records the window it sent, on the pin, and only after the service accepted', async () => {
    const study = await generateEciesKeyPair();
    const compartment = recordingCompartment(await pinnedStudy(study.publicKeyRaw, null));
    const seen: string[] = [];

    const transport: ContributorTransport = {
      listMyContributions: async () => ({ status: 'available', value: [] }),
      putContribution: async (input) => {
        // The ORDER is the guarantee, so it is observed rather than assumed:
        // at the moment the service is asked, nothing has been written.
        seen.push('push');
        assert.equal(compartment.writes.length, 0, 'the window was recorded BEFORE the service accepted');
        return {
          status: 'accepted',
          enrolment: {
            studyAccountId: input.studyAccountId,
            pseudonym: input.pseudonym,
            schemaTier: input.schemaTier,
            contributionVersion: input.contributionVersion,
            createdAt: '2026-08-28T09:00:00.000Z',
            updatedAt: '2026-08-28T09:00:00.000Z',
          },
        };
      },
    };

    const result = await submitContribution({
      transport,
      compartment,
      enrolment: compartment.current(),
      pseudonymRoot: generatePseudonymRoot(),
      snapshot: await buildSnapshot(),
      fromDayKey: FROM_DAY,
      toDayKey: TO_DAY,
      now: ACCEPTED_AT,
    });

    // POSITIVE first: without this every "nothing was written" claim below
    // would also pass on a submission path that never runs at all.
    assert.deepEqual(seen, ['push']);
    assert.equal(result.status, 'submitted');
    assert.equal(compartment.writes.length, 1);
    assert.deepEqual(compartment.current().lastSubmission, {
      fromDayKey: FROM_DAY,
      toDayKey: TO_DAY,
      at: ACCEPTED_AT,
    });
    // And nothing else on the pin moved: this is a record of a submission, not
    // a re-enrolment.
    assert.equal(compartment.current().createdAt, 1_756_000_000_000);
    assert.equal(compartment.current().label, 'Charité sleep trial');
  });

  it('records nothing when the pin is gone — a submission must not resurrect a study the person just left', async () => {
    const study = await generateEciesKeyPair();
    const compartment = recordingCompartment(await pinnedStudy(study.publicKeyRaw, null));
    // The withdrawal landed while the push was in flight.
    const raced: ContributionCompartment = { ...compartment, getEnrolment: async () => null };

    const result = await submitContribution({
      transport: transportAnswering(async () => ({
        status: 'accepted',
        enrolment: {
          studyAccountId: STUDY_ACCOUNT_ID,
          pseudonym: 'x',
          schemaTier: 'daily-intake-v1',
          contributionVersion: 1,
          createdAt: '2026-08-28T09:00:00.000Z',
          updatedAt: '2026-08-28T09:00:00.000Z',
        },
      })),
      compartment: raced,
      enrolment: compartment.current(),
      pseudonymRoot: generatePseudonymRoot(),
      snapshot: await buildSnapshot(),
      fromDayKey: FROM_DAY,
      toDayKey: TO_DAY,
      now: ACCEPTED_AT,
    });

    assert.equal(result.status, 'submitted');
    assert.equal(compartment.writes.length, 0, 'a submission re-created a pin the person had withdrawn');
  });
});

describe('a rejected submission', () => {
  it('a rejected submission records nothing, and each refusal is checked on its own', async () => {
    const study = await generateEciesKeyPair();

    // A DARK LANE. Nothing is even reduced here, so a record on this path
    // means the write sits above the transport entirely.
    const dark = recordingCompartment(await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW));
    assert.equal((await submitWith({ transport: darkTransport, compartment: dark })).status, 'unavailable');
    assert.equal(dark.writes.length, 0, 'a dark lane recorded a window nothing was sent through');
    assert.deepEqual(dark.current().lastSubmission, PREVIOUS_WINDOW);

    // A CONFLICT. Another of this person's own devices pushed first, so the
    // days in this call reached nobody.
    const conflicted = recordingCompartment(await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW));
    const conflictResult = await submitWith({
      transport: transportAnswering(async () => ({ status: 'conflict', currentVersion: 4 })),
      compartment: conflicted,
    });
    assert.equal(conflictResult.status, 'conflict');
    assert.equal(conflicted.writes.length, 0, 'a conflict recorded a window that was refused');
    assert.deepEqual(conflicted.current().lastSubmission, PREVIOUS_WINDOW);

    // TOO LARGE. This is advice — narrow the window — and advice that had
    // already recorded the wide window would be advice about a lie.
    const tooLarge = recordingCompartment(await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW));
    const tooLargeResult = await submitWith({
      transport: transportAnswering(async () => ({ status: 'too-large' })),
      compartment: tooLarge,
    });
    assert.equal(tooLargeResult.status, 'too-large');
    assert.equal(tooLarge.writes.length, 0, 'a too-large refusal recorded the window it refused');
    assert.deepEqual(tooLarge.current().lastSubmission, PREVIOUS_WINDOW);

    // UNKNOWN STUDY — or a dark deployment answering the same 404.
    const unknown = recordingCompartment(await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW));
    const unknownResult = await submitWith({
      transport: transportAnswering(async () => ({ status: 'not-found' })),
      compartment: unknown,
    });
    assert.equal(unknownResult.status, 'unknown-study');
    assert.equal(unknown.writes.length, 0, 'an unknown study recorded a window');
    assert.deepEqual(unknown.current().lastSubmission, PREVIOUS_WINDOW);

    // A THROWN TRANSPORT ERROR — an offline device, a 401, a 5xx.
    const threw = recordingCompartment(await pinnedStudy(study.publicKeyRaw, PREVIOUS_WINDOW));
    await assert.rejects(
      submitWith({
        transport: transportAnswering(async () => {
          throw new Error('offline');
        }),
        compartment: threw,
      }),
      /offline/,
    );
    assert.equal(threw.writes.length, 0, 'a thrown transport error recorded a window');
    assert.deepEqual(threw.current().lastSubmission, PREVIOUS_WINDOW);
  });
});

describe('the enrolments screen', () => {
  it('states nothing sent yet when the window is null, never an empty range', () => {
    const html = renderToStaticMarkup(withI18n(createElement(ResearchWindowLine, { lastSubmission: null })));

    // The granularity sentence M161/05 shipped — the honest thing to say when
    // there are no days to name.
    assert.match(html, /Whole calendar days inside the window you send/);
    // And NOT the sent-window sentence with holes in it. Both halves matter:
    // the negative alone would pass on an empty render.
    assert.ok(!html.includes('Sent '), 'a null window rendered as a sent range');
    assert.ok(!html.includes(' to  '), 'a null window rendered as an empty range');
  });

  it('names the days once some have been sent', () => {
    const html = renderToStaticMarkup(
      withI18n(
        createElement(ResearchWindowLine, {
          lastSubmission: { fromDayKey: FROM_DAY, toDayKey: TO_DAY, at: ACCEPTED_AT },
        }),
      ),
    );

    // The raw day keys, exactly as the researcher's own export prints them: a
    // day key is a calendar day, and re-reading it as an instant renders the
    // previous day west of UTC.
    assert.match(html, /Sent 2026-08-24 to 2026-08-26/);
  });
});
