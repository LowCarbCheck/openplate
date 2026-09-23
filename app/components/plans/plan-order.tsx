/**
 * THE ORDER PAGE, drawn from the biller's offer (M245/04).
 *
 * The contract is concluded here, and Stripe only takes the payment after. So
 * everything § 312j BGB wants a person to read before they are bound stands
 * above one button: the plan choice with each price and term, the summary
 * lines, the withdrawal notice, two consents, the payment note, and the
 * button whose label names the obligation to pay.
 *
 * ── EVERY ORDER SENTENCE IS THE BILLER'S ─────────────────────────────────
 *
 * The heading, the summary, the withdrawal notice, both consent sentences,
 * the button label and the payment or switch note are drawn verbatim from
 * `offer.texts`. This file writes no price, no plan name and no sentence about
 * the order. What it does write is chrome: the label of a link to the terms,
 * the label of a link to the withdrawal page, and the one line above the
 * button that says why it is held or what went wrong.
 *
 * ── NOTHING IS TICKED FOR THE PERSON ─────────────────────────────────────
 *
 * Both boxes start unticked, always; the caller owns them and resets them
 * when the page the person read changes. The button is held until a plan is
 * picked and both are ticked, and the held state is the `disabled` ATTRIBUTE.
 *
 * ── THE BUTTON IS LAST ───────────────────────────────────────────────────
 *
 * Nothing in the order block follows the button, so nothing a person must
 * read can sit below the press that binds them.
 *
 * ── THE LINE ABOVE THE BUTTON HAS ITS BOX FROM THE FIRST PAINT ───────────
 *
 * Two lines high, whether it says anything or not, so a failed order, a
 * stale page or a ticked box changes words and never moves the button
 * (DESIGN.md section 7).
 *
 * Props only, apart from `t`, so every state renders in a unit test.
 */
import { useId, type ReactNode } from 'react';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { PlanChoice } from '#app/components/plans/plan-choice';
import { SettingsSection } from '#app/components/settings/settings-section';
import { Button } from '#app/components/ui/button';
import { DATE_SLOT, TERMS_SLOT, type PlanKey, type PlanOffer } from '#app/lib/sync/engine/client/plans-wire';
import { cn } from '#app/lib/utils';

/** The two boxes, as the page holds them. */
export interface ConsentState {
  terms: boolean;
  earlyStart: boolean;
}

/** Which box a change is about. */
export type ConsentKey = keyof ConsentState;

/** Both boxes unticked, which is where every order starts. */
export const NO_CONSENTS: ConsentState = { terms: false, earlyStart: false };

/**
 * What the line above the button says after a press.
 *
 * - `failed`: the order did not go through; the button works again.
 * - `stale`: the offer changed under the page; it was read again and both
 *   boxes were cleared, and the line says so.
 * - `already-subscribed`: the biller says the account already pays.
 */
export type OrderNotice = 'none' | 'failed' | 'stale' | 'already-subscribed';

/**
 * What kind of order this page places.
 *
 * `first` is an account with no live plan: both plans, and the payment note.
 * `switch` is a monthly subscriber moving to the yearly plan (M245/07): the
 * yearly plan alone, and the switch note with the day the year starts.
 */
export type OrderMode = { kind: 'first' } | { kind: 'switch'; startsAt: string };

/** The catalog key of each notice. A `Record`, so a fifth notice fails to compile here. */
const NOTICE_KEY = {
  none: null,
  failed: 'plan.order.failed',
  stale: 'plan.order.stale',
  'already-subscribed': 'plan.order.alreadySubscribed',
} satisfies Record<OrderNotice, string | null>;

/** A link to a legal page, opened beside the order so neither the pick nor a tick is lost. */
function LegalLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} target="_blank" rel="noopener" className="text-primary underline underline-offset-4">
      {children}
    </Link>
  );
}

/**
 * A served sentence with its slot replaced by a node.
 *
 * Sliced, never `replace`d into a string, so the node stays a node and the
 * served text is never parsed as markup. The offer's schema guarantees the
 * slot is there; the first one is the link.
 */
function withSlot(text: string, slot: string, node: ReactNode): ReactNode {
  const at = text.indexOf(slot);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      {node}
      {text.slice(at + slot.length)}
    </>
  );
}

/** Why the button is held, or `null` when it is not. */
function holdReason(input: { selectedPlan: PlanKey | null; consents: ConsentState }): string | null {
  if (input.selectedPlan === null) return 'plan.choice.pickFirst';
  if (!input.consents.terms || !input.consents.earlyStart) return 'plan.order.confirmFirst';
  return null;
}

export interface PlanOrderProps {
  offer: PlanOffer;
  mode: OrderMode;
  /** The picked plan, `null` until the person picks one or a link named one. */
  selectedPlan: PlanKey | null;
  consents: ConsentState;
  notice: OrderNotice;
  /** `true` while the order is in flight, and after it answered an address, until the browser leaves. */
  isOrdering: boolean;
  onSelectPlan: (key: PlanKey) => void;
  onConsentChange: (key: ConsentKey, isTicked: boolean) => void;
  onOrder: () => void;
}

export function PlanOrder({
  offer,
  mode,
  selectedPlan,
  consents,
  notice,
  isOrdering,
  onSelectPlan,
  onConsentChange,
  onOrder,
}: PlanOrderProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const plans = mode.kind === 'switch' ? offer.plans.filter((plan) => plan.key === 'yearly') : offer.plans;
  const held = holdReason({ selectedPlan, consents });
  const noticeKey = NOTICE_KEY[notice];
  const line = noticeKey ?? held;
  const isAlert = noticeKey !== null;
  const note =
    mode.kind === 'switch' ?
      offer.texts.switchNote.split(DATE_SLOT).join(
        new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'long' }).format(
          new Date(mode.startsAt),
        ),
      )
    : offer.texts.paymentNote;

  return (
    <div data-slot="plan-order" data-order-mode={mode.kind}>
      <SettingsSection label={offer.texts.heading} contentClassName="space-y-4">
        {/* THE PRICES ARE DATA. Every figure on the cards is the biller's
            `grossCents`, or arithmetic on it (`plan-prices.ts`), and the term
            under each is the biller's own sentence. */}
        <PlanChoice plans={plans} selectedKey={selectedPlan} onSelect={onSelectPlan} placement="plan-page" />

        <ul data-slot="plan-order-summary" className="list-disc space-y-1 pl-5 text-sm">
          {offer.texts.summary.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>

        <p data-slot="plan-order-withdrawal" className="text-sm">
          {offer.texts.withdrawal}{' '}
          <LegalLink to={offer.links.withdrawal}>{t('plan.order.withdrawalLink')}</LegalLink>
        </p>

        <div className="space-y-3">
          <div className="flex items-start gap-2.5">
            <input
              id={`${baseId}-terms`}
              type="checkbox"
              data-slot="plan-consent-terms"
              checked={consents.terms}
              onChange={(event) => onConsentChange('terms', event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor={`${baseId}-terms`} className="text-sm leading-relaxed">
              {withSlot(
                offer.texts.termsConsent,
                TERMS_SLOT,
                <LegalLink to={offer.links.terms}>{t('chrome.terms')}</LegalLink>,
              )}
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input
              id={`${baseId}-early-start`}
              type="checkbox"
              data-slot="plan-consent-early-start"
              checked={consents.earlyStart}
              onChange={(event) => onConsentChange('earlyStart', event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor={`${baseId}-early-start`} className="text-sm leading-relaxed">
              {offer.texts.earlyStartConsent}
            </label>
          </div>
        </div>

        <p data-slot="plan-order-note" className="text-sm text-muted-foreground">
          {note}
        </p>

        <p
          data-slot="plan-action-line"
          role={isAlert ? 'alert' : undefined}
          className={cn(
            'min-h-10 text-sm',
            isAlert ? 'text-destructive' : 'text-muted-foreground',
            line === null && 'invisible',
          )}
        >
          {line === null ? '\u00a0' : t(line)}
        </p>

        {/* LAST, and the only button in the block. Its label is the biller's. */}
        <Button
          type="button"
          data-slot="plan-order-button"
          className="w-full"
          onClick={onOrder}
          disabled={held !== null || isOrdering}
        >
          {isOrdering && <Loader2 className="h-4 w-4 animate-spin" />}
          {offer.texts.button}
        </Button>
      </SettingsSection>
    </div>
  );
}
