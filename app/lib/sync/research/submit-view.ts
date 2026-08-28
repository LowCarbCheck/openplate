/**
 * The two decisions the "send a window" surface makes, kept out of the
 * component that shows them (M163/02).
 *
 * ── The picker has NO DEFAULT, and that is a consent rule ────────────────
 *
 * A pre-filled "last 90 days" is a pre-filled consent. The person choosing to
 * contribute is choosing WHICH DAYS of their own diary leave the device, and a
 * range somebody else picked, sitting in the boxes, converts that choice into
 * a confirmation. {@link EMPTY_WINDOW_DRAFT} is therefore empty, and it is a
 * constant here rather than a `useState('')` in the component so the rule is
 * one assertion instead of a reading of JSX.
 *
 * ── Every outcome the submission can have owns a sentence ────────────────
 *
 * {@link SUBMIT_OUTCOME_KEYS} is `satisfies Record<ContributionSubmitResult['status'], string>`,
 * so a new member of that union is a TYPE ERROR here rather than a screen that
 * silently says nothing. `tests/unit/research-wording.test.ts` walks this table
 * against both shipped catalogs, which is what stops the key from existing
 * while the copy does not.
 *
 * `too-large` is ADVICE, not an error: the window was too wide, so narrow it.
 * Nothing failed and nothing was lost, and copy that apologised would push a
 * person into sending less than they meant to next time.
 */
import type { ContributionSubmitResult } from './contribute';

/** The window the person is choosing, as the two text fields hold it. `''` means "not chosen yet". */
export interface ResearchWindowDraft {
  fromDayKey: string;
  toDayKey: string;
}

/**
 * What the picker starts with: NOTHING.
 *
 * See this module's header. Changing either value to a computed date — today,
 * ninety days ago, the first day this device has data for — makes the screen
 * propose a range instead of asking for one.
 */
export const EMPTY_WINDOW_DRAFT: ResearchWindowDraft = { fromDayKey: '', toDayKey: '' };

/** A `YYYY-MM-DD` day key, which is what `<input type="date">` produces and what the reduction takes. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether this draft is a window that can be sent.
 *
 * Both ends chosen, both real day keys, and the end not before the start. The
 * comparison is a plain string comparison, exact for zero-padded `YYYY-MM-DD`
 * and involving no `Date`, no zone and no instant — the same rule
 * `research/reduce.ts` follows.
 */
export function isSendableWindow(draft: ResearchWindowDraft): boolean {
  if (!DAY_KEY_PATTERN.test(draft.fromDayKey) || !DAY_KEY_PATTERN.test(draft.toDayKey)) return false;
  return draft.fromDayKey <= draft.toDayKey;
}

/**
 * One copy key per submission outcome.
 *
 * `satisfies` and not an annotation: the object stays exactly this shape, so
 * adding a status to `ContributionSubmitResult` fails to compile until it has
 * a sentence.
 */
export const SUBMIT_OUTCOME_KEYS = {
  submitted: 'research.submit.outcome.submitted',
  conflict: 'research.submit.outcome.conflict',
  'too-large': 'research.submit.outcome.tooLarge',
  'unknown-study': 'research.submit.outcome.unknownStudy',
  unavailable: 'research.submit.outcome.unavailable',
} as const satisfies Record<ContributionSubmitResult['status'], string>;

/** A translated line, as the panel renders it: a key and the values it interpolates. */
export interface SubmitOutcomeCopy {
  key: string;
  params: Record<string, string | number>;
}

/**
 * The sentence one outcome earns.
 *
 * Only `submitted` names days, and it names the ones that were ACCEPTED —
 * the same window `research/contribute.ts` recorded on the pin. Day keys are
 * passed through RAW: a day key is a calendar day, and
 * `new Date('2026-08-24').toLocaleDateString()` renders the previous day west
 * of UTC.
 *
 * No parameter is called `count`: that name is i18next's plural selector, and
 * a key without `_one`/`_other` forms silently falls back.
 */
export function submitOutcomeCopy({
  result,
  window,
}: {
  result: ContributionSubmitResult;
  /** The window that was sent. Read only for the accepted case. */
  window: ResearchWindowDraft;
}): SubmitOutcomeCopy {
  const key = SUBMIT_OUTCOME_KEYS[result.status];
  if (result.status !== 'submitted') return { key, params: {} };
  return {
    key,
    params: { from: window.fromDayKey, to: window.toDayKey, version: result.contributionVersion },
  };
}
