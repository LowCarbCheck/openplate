/**
 * reproductive-status-line.ts: the one short line that says where a person is
 * in their life phase today (M215 spec 01).
 *
 * The settings hub shows a "Lebensphase" / "Life phase" row for EVERY account,
 * and a row has one line of live status under its title. That line is derived,
 * never stored: a due date turns into a gestation week and a birth date turns
 * into a month count, both against the person's own calendar day.
 *
 * ── Why the arithmetic is not here ─────────────────────────────────────────
 *
 * `resolveGestation` and `resolveLactationMonths` (`#app/lib/reproductive-stage`)
 * own it, exactly as they do for the fieldset's own derived line and for every
 * reference-intake caller. This module only chooses which sentence to render.
 *
 * ── Why it is not the fieldset's sentence ──────────────────────────────────
 *
 * The fieldset stands under a date field and can afford a full sentence
 * ("Second trimester, week 20."). A hub row has one clamped line beside a
 * title, so it names the phase and the number and stops. The two are different
 * jobs, so they get different copy; what they share is the derivation.
 *
 * Pure: no clock, no store, no i18next singleton. `today` and the translator
 * both arrive from the caller, which is what lets a unit test render every
 * state without a browser.
 */
import { resolveGestation, resolveLactationMonths } from '#app/lib/reproductive-stage';
import type { ReproductiveStatus } from '#app/lib/local-store/schema';

/** Translation lookup, threaded in so this module stays free of the i18next singleton. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** Everything the line is derived from: the stored status, its date, the person's day, and a translator. */
export interface ReproductiveStatusLineInput {
  /** The stored status, `null` for an account that never answered. */
  reproductiveStatus: ReproductiveStatus | null;
  /** The stored due date as `YYYY-MM-DD`, or `null`. */
  pregnancyDueDate: string | null;
  /** The stored birth date as `YYYY-MM-DD`, or `null`. */
  lactationStartDate: string | null;
  /** The caller's calendar day as `YYYY-MM-DD`; never read from a clock here. */
  today: string;
  t: Translate;
}

/**
 * The hub row's status line.
 *
 * Four answers, in this order:
 *  1. pregnant with a readable due date: the phase and the gestation week.
 *  2. breastfeeding with a readable birth date: the phase and the month count.
 *  3. a status set but no date yet: the phase alone, in the fieldset's own
 *     words, rather than a fabricated week 1.
 *  4. no status: "Not active".
 *
 * @param input - the stored status, its dates, the person's day and a translator.
 * @returns the translated line, ready to render.
 */
export function reproductiveStatusLine({
  reproductiveStatus,
  pregnancyDueDate,
  lactationStartDate,
  today,
  t,
}: ReproductiveStatusLineInput): string {
  if (reproductiveStatus === 'pregnant') {
    const gestation = resolveGestation({ dueDate: pregnancyDueDate, today });
    if (gestation === null) return t('bodyMetrics.reproductive.pregnant');
    return t('lifePhase.summary.pregnant', { week: gestation.week });
  }

  if (reproductiveStatus === 'lactating') {
    const months = resolveLactationMonths({ startDate: lactationStartDate, today });
    if (months === null) return t('bodyMetrics.reproductive.lactating');
    return t('lifePhase.summary.lactating', { count: months });
  }

  return t('lifePhase.inactive');
}
