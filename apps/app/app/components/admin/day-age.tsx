/**
 * "Today", "Yesterday", "3 days ago", or a short date: an instant as an
 * operator reads it in the admin lists.
 *
 * The decision of WHICH phrase lives in `people-age.ts` and is pure; this
 * component only picks the words for it in the reader's language. Both the
 * "Joined" column and the "Last seen" column use it, with different horizons
 * (`relativeUntilDays`), and the invitation rows use the same phrases in a
 * sentence (`SentWhen`, below).
 */
import { useTranslation } from 'react-i18next';

import { describeDayAge, formatShortDate } from '#app/lib/admin/people-age';

export interface DayAgeProps {
  iso: string;
  now: Date;
  /** From this age in days on, a date replaces "N days ago". */
  relativeUntilDays: number;
}

export function DayAge({ iso, now, relativeUntilDays }: DayAgeProps) {
  const { t, i18n } = useTranslation();
  const age = describeDayAge({ iso, now, relativeUntilDays });
  if (age.kind === 'today') return <>{t('admin.dayAge.today')}</>;
  if (age.kind === 'yesterday') return <>{t('admin.dayAge.yesterday')}</>;
  if (age.kind === 'days-ago') return <>{t('admin.dayAge.daysAgo', { days: age.days })}</>;
  return <>{formatShortDate({ iso: age.iso, now, language: i18n.language })}</>;
}

/**
 * When an invitation was sent, as the start of a sentence: "Sent today",
 * "Sent 3 days ago", "Sent 2 Oct".
 *
 * Whole sentences per case rather than "Sent " plus a phrase, because a phrase
 * glued to a verb is a calque in most of the languages this app ships in.
 */
export function SentWhen({ iso, now }: { iso: string; now: Date }) {
  const { t, i18n } = useTranslation();
  const age = describeDayAge({ iso, now, relativeUntilDays: SENT_RELATIVE_UNTIL_DAYS });
  if (age.kind === 'today') return <>{t('admin.invites.sentToday')}</>;
  if (age.kind === 'yesterday') return <>{t('admin.invites.sentYesterday')}</>;
  if (age.kind === 'days-ago') return <>{t('admin.invites.sentDaysAgo', { days: age.days })}</>;
  return <>{t('admin.invites.sentOn', { date: formatShortDate({ iso: age.iso, now, language: i18n.language }) })}</>;
}

/** An invitation is "sent N days ago" for a week, then it carries its date. */
const SENT_RELATIVE_UNTIL_DAYS = 7;
