/**
 * What a person agrees to before a photograph of their food leaves this
 * device, and the record of that agreement.
 *
 * A DEVICE-LOCAL FLAG PROVES NOTHING. Whoever looks at a reported photograph
 * later needs to know what the person was actually shown, and "the app set a
 * boolean" is not that. So the agreement is a RECORD: the instant the person
 * agreed, by their own clock, and the version of the wording they read. Both
 * travel with the report (`feedback-report.ts`) and are stored on the row by
 * `openplate-sync`'s `feedback_reports` table.
 *
 * THE VERSION IS PINNED BY A TEST, not by a promise. `tests/unit/feedback-consent.test.ts`
 * hashes the English consent strings and compares the digest against
 * {@link FEEDBACK_CONSENT_WORDING_VERSION}. Change the wording without bumping
 * the version and the gate fails, which is the only thing that stops a stored
 * report claiming agreement to a sentence nobody ever saw.
 */
import { z } from 'zod';

/**
 * The version identifier stored with every report, naming WHICH wording the
 * person read.
 *
 * Dated rather than numbered so a reviewer holding a two-year-old report can
 * find the copy in the repository's history without a lookup table.
 */
export const FEEDBACK_CONSENT_WORDING_VERSION = '2026-09-07';

/**
 * WHAT USED TO BE HERE: `FEEDBACK_RETENTION_DAYS = 30`.
 *
 * IT WAS THE SECOND COPY OF A PROMISE ANOTHER REPOSITORY KEEPS. The number of
 * days a reported photograph survives is decided by `openplate-sync`, whose
 * retention sweep deletes on its own constant. This app held a matching
 * literal and printed it in the consent step and in the privacy policy, with
 * nothing whatsoever stopping the two drifting: an operator who moved their
 * server's window to sixty left this app promising thirty to somebody at the
 * exact moment they were deciding to hand over a photograph of their food.
 *
 * THE SERVER NOW ADVERTISES ITS OWN WINDOW on `GET /health`
 * (`instance.feedback.retentionDays`, PROTOCOL.md §5.6), published from the
 * same binding the sweep deletes on, and the app READS it —
 * `useFeedbackRetentionDays` in `#app/hooks/use-server-instance`.
 *
 * A SERVER THAT ADVERTISES NOTHING GETS NO SENTENCE. Reports are not offered
 * at all in that case (see `#app/components/report-estimate`) and the policy
 * names no period. Restoring a default here would restore the defect.
 */

/**
 * The agreement, as it is queued and as it goes on the wire.
 *
 * PARSED, NOT CAST, wherever it comes back off durable storage: a record read
 * out of the outbox has been through `JSON.parse`, and a row written by an
 * older build is exactly the shape that would otherwise reach the wire with an
 * empty `wordingVersion` and be refused with a 400 for ever.
 */
export const feedbackConsentRecordSchema = z.object({
  /** ISO-8601, and a real instant: `Date.parse` on a stored string is the only thing that proves it. */
  agreedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'agreedAt is not a parseable instant',
  }),
  wordingVersion: z.string().trim().min(1),
});

export type FeedbackConsentRecord = z.infer<typeof feedbackConsentRecordSchema>;

/**
 * Mints the record for an agreement that has just been given.
 *
 * The clock is injected, like every clock in this repo, so a test does not
 * assert against `Date.now()`. The instant is the DEVICE's, deliberately: the
 * server records its own arrival time beside it and the pair is more honest
 * than either value silently overwriting the other.
 */
export function recordFeedbackConsent({ nowMs = Date.now() }: { nowMs?: number } = {}): FeedbackConsentRecord {
  return { agreedAt: new Date(nowMs).toISOString(), wordingVersion: FEEDBACK_CONSENT_WORDING_VERSION };
}

/**
 * The translation keys for the consent step, chosen by whether this entry
 * actually HAS a photograph on this device.
 *
 * TWO SETS, NOT ONE WITH A CONDITIONAL CLAUSE. An entry typed by hand or added
 * from search never had an image, and asking somebody to agree that "your
 * photograph will be kept for thirty days" when there is no photograph is
 * asking for consent to something that will not happen. The figures-only
 * wording says what is actually being sent.
 */
export interface FeedbackConsentCopyKeys {
  title: string;
  /** What is sent, and to whom. */
  whatIsSent: string;
  /** How long it is kept, and that it is then deleted. Takes `{{days}}`. */
  retention: string;
  /** That this one item leaves the device unencrypted. */
  unencrypted: string;
  agree: string;
  decline: string;
}

export function feedbackConsentCopyKeys({ hasPhoto }: { hasPhoto: boolean }): FeedbackConsentCopyKeys {
  return {
    title: 'entry.report.consent.title',
    whatIsSent: hasPhoto ? 'entry.report.consent.whatIsSentWithPhoto' : 'entry.report.consent.whatIsSentFiguresOnly',
    retention: hasPhoto ? 'entry.report.consent.retentionWithPhoto' : 'entry.report.consent.retentionFiguresOnly',
    unencrypted: 'entry.report.consent.unencrypted',
    agree: 'entry.report.consent.agree',
    decline: 'entry.report.consent.decline',
  };
}

/** The rendered consent step. A plain object so a test can read the copy without a DOM. */
export interface FeedbackConsentLines {
  title: string;
  /** In order: what is sent and who can see it, how long it is kept, that it is unencrypted. */
  points: readonly string[];
  agree: string;
  decline: string;
}

/**
 * The consent step's copy, resolved.
 *
 * A PURE FUNCTION RATHER THAN JSX so the thing under test is the WORDING. The
 * requirement on this step is about what it says, and a test that rendered a
 * dialog would be asserting that Radix opens rather than that the sentence
 * about an administrator is on screen.
 */
export function feedbackConsentLines({
  t,
  hasPhoto,
  retentionDays,
}: {
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string;
  hasPhoto: boolean;
  /**
   * The window the SERVER advertised, in days. Required, and deliberately
   * without a default: a caller that does not know the window must not render
   * this step at all, and a default here is how it would render one anyway.
   */
  retentionDays: number;
}): FeedbackConsentLines {
  const keys = feedbackConsentCopyKeys({ hasPhoto });
  return {
    title: t(keys.title),
    points: [t(keys.whatIsSent), t(keys.retention, { days: retentionDays }), t(keys.unencrypted)],
    agree: t(keys.agree),
    decline: t(keys.decline),
  };
}
