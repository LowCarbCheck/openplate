/**
 * EVERYTHING `INSTANCE_MODE=managed` CHANGES, frozen, M201 spec 07.
 *
 * M201 exists because three correct decisions taken for an accountless app
 * were never revisited when the flag arrived: the header's deleted account
 * menu, the device-only avatar menu, and the deliberate non-wipe on sign-out.
 * Each was recorded in a comment, each was load-bearing, and each was found to
 * be wrong on beta.openplate.de by a person hitting it. Nothing connected the
 * flag to the decisions it invalidated, so nothing could have caught them.
 *
 * This is that connection. `app/config/instance-policy.ts` states the
 * consequences as named questions, and the table below is the record of what
 * each one answers in each mode, with the reason beside it. Adding a question
 * without a row here fails the push, which is the gate that was missing.
 *
 * ── WHY IT IS SHAPED LIKE `brand-colors.test.ts` ─────────────────────────
 *
 * Same argument, in the same words the workspace CLAUDE.md uses for that one:
 * FREEZE THE KNOWN SET, do not assert a count. "Exactly seven questions" is a
 * sentence that passes today and says nothing, because it neither names a
 * question nor explains one. A row that names the question, both answers and
 * what it governs is reviewable, and its absence is what fails.
 *
 * The set is read from the policy object at runtime rather than typed out
 * twice, so the table cannot quietly drift from the code it describes.
 *
 * ── DO NOT "FIX" A FAILURE BY ADDING A ROW ───────────────────────────────
 *
 * A new row is a new claim about what a managed instance does differently. The
 * question belongs in `InstancePolicy` with its reason written next to it, the
 * call sites that ask it belong in the same change, and whether it should
 * exist at all is a person's decision before either.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTANCE_POLICIES,
  getInstancePolicy,
  instancePolicyForMode,
  type InstancePolicy,
} from '../../app/config/instance-policy';
import type { PublicConfig } from '../../app/config/public-config';

/** One question, both answers, and what it governs. */
interface FrozenAnswer {
  /** The field name on `InstancePolicy`. */
  question: string;
  /** The answer on an open instance, which is the self-host default. */
  open: boolean;
  /** The answer on `INSTANCE_MODE=managed`. */
  managed: boolean;
  /** What turns on this question, in enough words to review the row. */
  governs: string;
}

/**
 * The policy openplate shipped on 2026-09-07.
 *
 * Six of the seven answer `false` on an open instance and `true` on a managed
 * one. `homeCookieProvesSession` is the exception, and it is worth noticing
 * rather than smoothing over: managed does not simply switch things ON, it
 * withdraws a piece of trust the open app is right to extend.
 */
const FROZEN: FrozenAnswer[] = [
  {
    question: 'requiresAccount',
    open: false,
    managed: true,
    governs:
      'Whether a person may use this instance without an account at all. It gates the anonymous ' +
      '`/onboarding` start (`isAnonymousStartAllowed`), which of the two doors `/welcome` leads with ' +
      '(`resolveWelcomeHint`), and where the landing page mid-page call to action points.',
  },
  {
    question: 'homeCookieProvesSession',
    open: true,
    managed: false,
    governs:
      'Whether the `openplate-home` cookie is enough on its own to send a browser to `/dashboard`. THE ONE ' +
      'question whose managed answer is `false`: the cookie records that this DEVICE has been in the app, ' +
      'and on a shared device that is not proof the person holding it now may read that account diary.',
  },
  {
    question: 'headerOffersSignIn',
    open: false,
    managed: true,
    governs:
      'Whether the chrome names a sign-in door. `public-wrapper.tsx` deleted the account menu in M128 ' +
      'because nothing was behind it, which is still right where nobody has an account, and wrong on an ' +
      'instance whose only button is a silent redirect to `/welcome`.',
  },
  {
    question: 'signOutErasesDevice',
    open: false,
    managed: true,
    governs:
      'Whether signing out must take the diary off the device. `sync-actions.ts` keeps it on purpose where ' +
      'the diary belongs to the DEVICE and a wipe would be a terrifying button. Where it belongs to an ' +
      'ACCOUNT, leaving it readable hands the diary of one person to whoever opens the app next.',
  },
  {
    question: 'operatorSeesActivity',
    open: false,
    managed: true,
    governs:
      'Whether an operator can see per-person last sign-in and usage over time. An open instance has no ' +
      'operator and no such record; on a managed one it is the job, since whoever runs a study has to ' +
      'answer "did these people use it". It also decides what the privacy copy must disclose.',
  },
  {
    question: 'aiComesFromTheInstance',
    open: false,
    managed: true,
    governs:
      'Whether photo estimates come from this instance on the account allowance rather than from a ' +
      'provider key the person brings. It changes WHO RECEIVES A PHOTOGRAPH, so it drives the scan capture ' +
      'copy and connect card, the allowance card, the absent `/settings/ai` row, the onboarding key note, ' +
      'the landing AI sentences, and which settings `useEffectiveAiSettings` resolves.',
  },
  {
    question: 'serverHoldsTheDiary',
    open: false,
    managed: true,
    governs:
      'Whether a copy of the diary reaches a server the operator runs. `false` on an open instance EVEN ' +
      'WITH `SYNC_SERVER_URL` set, because sync there is an opt-in somebody may never touch. It selects ' +
      'the managed terms and privacy documents, the promise on the first onboarding screen, and the ' +
      'landing sync card. It also owns every remaining sentence that names the device as the diary\u2019s ' +
      'only address: the landing page title, the footer tagline on every public page, the trust card body ' +
      'at each of the three analytics levels, and the recovery screen, which on a managed instance says ' +
      'the copy exists and offers the sign-in door that fetches it.',
  },
];

/** Both mode objects, as the freeze reads them. Deliberately loose so a fixture with an extra question fits. */
interface PolicyPair {
  open: InstancePolicy;
  managed: InstancePolicy;
}

/**
 * Every question either object answers, as `question open=X managed=Y`, sorted.
 *
 * Reads the OBJECT, never a list of names, which is what makes an undeclared
 * question impossible to hide: a field added to `InstancePolicy` has to be
 * answered in both mode objects for the file to compile, and the moment it is,
 * it appears here.
 */
function answeredQuestions(policies: PolicyPair): string[] {
  const open = new Map(Object.entries(policies.open));
  const managed = new Map(Object.entries(policies.managed));
  const questions = [...new Set([...open.keys(), ...managed.keys()])].toSorted();
  return questions.map((question) => `${question} open=${open.get(question)} managed=${managed.get(question)}`);
}

/** The same rows, written out from the table above. */
function frozenQuestions(frozen: FrozenAnswer[]): string[] {
  return frozen.map((row) => `${row.question} open=${row.open} managed=${row.managed}`).toSorted();
}

/** Questions the policy answers that no row accounts for. The freeze itself. */
function unfrozenQuestions(policies: PolicyPair, frozen: FrozenAnswer[]): string[] {
  const declared = new Set(frozen.map((row) => row.question));
  return [...new Set([...Object.keys(policies.open), ...Object.keys(policies.managed)])]
    .filter((question) => !declared.has(question))
    .toSorted();
}

describe('the instance policy', () => {
  it('answers exactly the questions frozen on 2026-09-07, with the same value in each mode', () => {
    assert.deepEqual(
      answeredQuestions(INSTANCE_POLICIES),
      frozenQuestions(FROZEN),
      'a policy question appeared, changed its answer or vanished. If you added one, add its row above and ' +
        'say what it governs. If you changed an answer, that is a change to what a managed instance DOES.',
    );
  });

  it('gives every frozen question a note long enough to review', () => {
    assert.deepEqual(
      FROZEN.filter((row) => row.governs.length < 80).map((row) => row.question),
      [],
      'a row was added without saying what it governs, which is the only part of it a reviewer can judge.',
    );
  });

  it('fails on an unfrozen question, proven against a fixture policy', () => {
    // The freeze is only worth having if it FAILS. Proving that needs a policy
    // with a question nobody declared, which the real one can never have, so
    // the fixture supplies one. Spread from the real objects rather than typed
    // out, so this keeps testing the mechanism and not a stale copy.
    const fixture = {
      open: { ...INSTANCE_POLICIES.open, operatorCanReadTheDiary: false },
      managed: { ...INSTANCE_POLICIES.managed, operatorCanReadTheDiary: true },
    };
    assert.deepEqual(unfrozenQuestions(fixture, FROZEN), ['operatorCanReadTheDiary']);
    assert.notDeepEqual(answeredQuestions(fixture), frozenQuestions(FROZEN));
  });

  it('accounts for every question the real policy answers', () => {
    assert.deepEqual(unfrozenQuestions(INSTANCE_POLICIES, FROZEN), []);
  });
});

/** An open instance's public config: the self-host default, and the baseline each case moves off. */
const OPEN_CONFIG: PublicConfig = {
  syncServerUrl: null,
  instancePreset: null,
  analytics: null,
  managed: false,
};

describe('reading the instance policy', () => {
  it('hands an error boundary the open policy rather than guessing', () => {
    // `undefined` is a render where the root loader never ran. Answering
    // "managed" there would lock somebody out of the app on a guess.
    assert.deepEqual(getInstancePolicy(undefined), INSTANCE_POLICIES.open);
  });

  it('reads the flag the root loader sent, and nothing else', () => {
    assert.deepEqual(getInstancePolicy(OPEN_CONFIG), INSTANCE_POLICIES.open);
    assert.deepEqual(getInstancePolicy({ ...OPEN_CONFIG, managed: true }), INSTANCE_POLICIES.managed);
  });

  it('does not confuse a configured sync server with a managed instance', () => {
    // A self-hoster may set `SYNC_SERVER_URL` on an OPEN instance. That
    // instance has sync AND the anonymous diary, so every answer stays open.
    // "Is sync configured" is a different question, and `isSyncConfigured` is
    // where it is asked.
    const openWithSync = { ...OPEN_CONFIG, syncServerUrl: 'https://sync.example.org' };
    assert.deepEqual(getInstancePolicy(openWithSync), INSTANCE_POLICIES.open);
    assert.equal(getInstancePolicy(openWithSync).serverHoldsTheDiary, false);
    assert.equal(getInstancePolicy(openWithSync).requiresAccount, false);
  });

  it('answers the same for a mode as it does for a config carrying that mode', () => {
    assert.deepEqual(instancePolicyForMode('open'), getInstancePolicy(OPEN_CONFIG));
    assert.deepEqual(instancePolicyForMode('managed'), getInstancePolicy({ ...OPEN_CONFIG, managed: true }));
  });
});
