/**
 * Whether a person has agreed to activity reminder mails, as one pure rule.
 *
 * TWO INSTANTS, NEVER ONE FLAG. `accounts.activity_mail_opt_in_at` says when
 * the person last agreed and `accounts.activity_mail_opt_out_at` says when
 * they last withdrew. Neither is ever cleared, because the pair is the record
 * that a mail already sent had consent behind it, and a withdrawal must not
 * erase that record.
 *
 * ACTIVE means an opt-in exists and no opt-out came after it. An opt-out at
 * the very same instant as the opt-in is not "after", and it is not active
 * either: the rule is `optOutAt < optInAt`, strictly, so a tie reads as
 * withdrawn, which is the safe side.
 *
 * THE SAME RULE IN SQL lives in `db/activity-mail-store.ts`
 * (`activeConsentSql`), and every reader uses one of the two: the due rules,
 * the stats count and the account view. `tests/unit/activity-mail-due.test.ts`
 * holds this function to its cases, and the integration tier holds the SQL to
 * the same ones.
 */

/** The two consent columns, as the rule reads them. */
export interface ActivityMailConsent {
  optInAt: Date | null;
  optOutAt: Date | null;
}

/** No consent at all: what every account has until a person ticks the box. */
export const NO_ACTIVITY_MAIL_CONSENT: ActivityMailConsent = { optInAt: null, optOutAt: null };

export function isActivityMailConsentActive(consent: ActivityMailConsent): boolean {
  if (consent.optInAt === null) return false;
  if (consent.optOutAt === null) return true;
  return consent.optOutAt.getTime() < consent.optInAt.getTime();
}
