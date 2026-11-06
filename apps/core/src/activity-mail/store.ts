/**
 * What the activity reminder sender and the admin stats need from the
 * database, and nothing more. The Drizzle implementation is
 * `db/activity-mail-store.ts`.
 *
 * SELECT, THEN CLAIM, THEN SEND. A selected row is only a candidate. The send
 * happens after a CLAIM, one conditional UPDATE that stamps the kind's
 * `*_mail_sent_at` only while the row still meets the due rule. Two replicas,
 * or a tick that overlaps the last one, select the same row and only one of
 * them claims it, so nobody gets the same mail twice.
 */
import type { AiLimitWindow } from '../accounts/ai-allowance.js';
import type { InstanceLanguage } from '../protocol.js';
import type { FirstScanCandidate, QuietCandidate } from './due-rules.js';

/** Who a reminder goes to, beside the facts its rule read. */
export interface ActivityMailRecipient {
  accountId: number;
  email: string;
  /** The reminders' language, or `null` for the instance's own. */
  language: InstanceLanguage | null;
}

export type DueFirstScanRow = ActivityMailRecipient & FirstScanCandidate;
export type DueQuietRow = ActivityMailRecipient & QuietCandidate;

export interface FirstScanQuery {
  now: Date;
  days: number;
  /** The instance's standing free default, which gives an account with none of its own an allowance. */
  instanceDefaultFreeAiLimit: AiLimitWindow;
}

export interface QuietQuery {
  now: Date;
  days: number;
}

/** `claimed`: this caller stamped the row and sends. `taken`: the row is no longer due, somebody else claimed it. */
export type ClaimResult = 'claimed' | 'taken';

/** What `GET /v1/admin/activity-mail/stats` answers with. */
export interface ActivityMailStats {
  /** Accounts whose consent is active right now. */
  optedIn: number;
  firstScan: ActivityMailKindStats;
  quiet: ActivityMailKindStats;
}

export interface ActivityMailKindStats {
  /** Accounts the kind was claimed for, failed sends included: the claim stays. */
  sent: number;
  /** Of those, the accounts seen after the claim. */
  cameBack: number;
}

export interface ActivityMailStore {
  /** Up to `limit` accounts the first-scan rule makes due, oldest sign-up first. */
  findDueFirstScan(input: FirstScanQuery & { limit: number }): Promise<DueFirstScanRow[]>;
  /** Up to `limit` accounts the quiet rule makes due, longest quiet first. */
  findDueQuiet(input: QuietQuery & { limit: number }): Promise<DueQuietRow[]>;
  claimFirstScan(input: FirstScanQuery & { accountId: number }): Promise<ClaimResult>;
  claimQuiet(input: QuietQuery & { accountId: number }): Promise<ClaimResult>;
  stats(): Promise<ActivityMailStats>;
}
