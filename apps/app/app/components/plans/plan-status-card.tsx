/**
 * WHAT A SUBSCRIBER HOLDS, as its own card (M250/07).
 *
 * The plan page draws this for a person the biller holds a live subscription
 * for, and M245/04's order page composes the same card, which is why it is a
 * component of its own rather than a branch of `settings.plan.tsx`.
 *
 * It says four things and no more: which plan (monthly or yearly), where the
 * subscription stands (paid, or a payment Stripe is retrying), the one date
 * that matters next, and the button to the customer portal, which is where
 * cancelling, changing a card and downloading an invoice live.
 *
 * ── ONE DATE, THREE MEANINGS ─────────────────────────────────────────────
 *
 * The period end is the next payment for a monthly plan that renews, the end
 * of the paid year for a yearly plan (which then continues monthly, the owner's
 * M245 decision and § 309 Nr. 9 BGB), and the day access stops for a plan that
 * was cancelled. Saying "renews" for the last one would contradict the
 * cancellation the person just made.
 *
 * ── NO PRICE HERE ────────────────────────────────────────────────────────
 *
 * What the plan costs is in the portal and on the invoice. This card names the
 * plan by its interval and never repeats an amount it did not read.
 *
 * Props only, apart from `t`, so every state renders in a unit test.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { SettingsSection } from '#app/components/settings/settings-section';
import type { PlanStanding } from '#app/lib/plans/plan-standing';
import type { PlanInterval } from '#app/lib/sync/engine/client/plans-wire';

/** The standing this card is drawn for. */
export type SubscribedStanding = Extract<PlanStanding, { kind: 'subscribed' }>;

/** The card heading per interval. A `Record`, so a third interval fails to compile here. */
const PLAN_NAME_KEY = {
  month: 'plan.card.name.month',
  year: 'plan.card.name.year',
} satisfies Record<PlanInterval, string>;

export interface PlanStatusCardProps {
  standing: SubscribedStanding;
  /** Whether the biller holds a customer to open the portal onto. */
  portalAvailable: boolean;
  /** `true` while the portal address is being fetched. */
  isOpeningPortal: boolean;
  /** `true` while any plan action is in flight, so the button cannot be pressed twice. */
  isBusy: boolean;
  onManage: () => void;
  /**
   * Where a monthly subscriber orders the yearly plan (M245/07), or `null`
   * when this person cannot move: a yearly plan, a payment being retried, a
   * move already booked. Plan changes happen on the order page and nowhere
   * else (owner, 2026-09-23), so this is a link to it and not a button.
   */
  orderYearlyHref?: string | null;
  /** The ISO day a booked move to the yearly plan starts, or `null` when none was booked on this page. */
  switchStartsAt?: string | null;
}

/** The date line, one sentence for each of the three meanings of the period end. */
function PeriodLine({ standing }: { standing: SubscribedStanding }) {
  const { t, i18n } = useTranslation();
  if (standing.periodEnd === null) return null;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'long' }).format(
    new Date(standing.periodEnd),
  );
  if (!standing.renews) return <p className="text-sm">{t('plan.endsOn', { date })}</p>;
  if (standing.interval === 'year') {
    return (
      <p data-slot="plan-year-turns-monthly" className="text-sm">
        {t('plan.card.yearThenMonthly', { date })}
      </p>
    );
  }
  return <p className="text-sm">{t('plan.renewsOn', { date })}</p>;
}

/**
 * The status line under the heading.
 *
 * A PLAN SET TO STOP IS NOT "PAID AND RUNNING". Beside "You cancelled", that
 * sentence read as a contradiction (operator, 2026-09-23). It says what is
 * true of both halves: paid up to the end date, and no renewal after it.
 */
function statusLine({
  standing,
  t,
  longDate,
}: {
  standing: SubscribedStanding;
  t: (key: string, options?: Record<string, string>) => string;
  longDate: (iso: string) => string;
}): string {
  if (standing.isPastDue) return t('plan.status.pastDue');
  if (standing.renews) return t('plan.status.active');
  if (standing.periodEnd === null) return t('plan.status.doesNotRenew');
  return t('plan.status.paidUntil', { date: longDate(standing.periodEnd) });
}

/** A date the way this reader writes one. */
function useLongDate(): (iso: string) => string {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'long' });
  return (iso) => format.format(new Date(iso));
}

export function PlanStatusCard({
  standing,
  portalAvailable,
  isOpeningPortal,
  isBusy,
  onManage,
  orderYearlyHref = null,
  switchStartsAt = null,
}: PlanStatusCardProps) {
  const { t } = useTranslation();
  const longDate = useLongDate();
  const heading = standing.interval === null ? t('plan.title') : t(PLAN_NAME_KEY[standing.interval]);
  const status = statusLine({ standing, t, longDate });

  return (
    <div data-slot="plan-status-card" data-plan-key={standing.planKey ?? 'unnamed'}>
      <SettingsSection label={heading} description={status} contentClassName="space-y-3">
        <PeriodLine standing={standing} />
        {switchStartsAt !== null && (
          <p data-slot="plan-switch-booked" className="text-sm">
            {t('plan.card.switchBooked', { date: longDate(switchStartsAt) })}
          </p>
        )}
        {orderYearlyHref !== null && switchStartsAt === null && (
          <p>
            <Link
              to={orderYearlyHref}
              data-slot="plan-order-yearly"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {t('plan.card.orderYearly')}
            </Link>
          </p>
        )}
        {/* MANAGE IS DRAWN ONLY WHERE THERE IS SOMETHING TO MANAGE. The
            biller answers a 404 for an account with no customer, and a
            button whose only outcome is that 404 is a button that lies. */}
        {portalAvailable && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onManage} disabled={isBusy}>
              {isOpeningPortal ?
                <Loader2 className="h-4 w-4 animate-spin" />
              : <ExternalLink className="h-4 w-4" />}
              {t('plan.manage')}
            </Button>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
